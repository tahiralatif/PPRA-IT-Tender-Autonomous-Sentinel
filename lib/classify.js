const config = require('./config');

/**
 * Three-tier tender classification:
 *   1. Hard-include: clear IT keywords → mark as relevant, skip AI
 *   2. Hard-exclude: clear non-IT keywords → mark as not relevant, skip AI
 *   3. Ambiguous: neither matched → call Groq/Llama-3 for classification
 *
 * Returns: { relevant: boolean, reason: string, method: 'include'|'exclude'|'ai' }
 */

// ─── Tier 1 & 2: Keyword Classification ────────────────────────

/**
 * Build a single regex from a keyword list.
 * Uses substring matching (case-insensitive) — keywords like "digital" match "Digitalized".
 */
function buildKeywordRegex(keywords) {
  const escaped = keywords.map((kw) =>
    kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  return new RegExp(escaped.join('|'), 'i');
}

const includeRegex = buildKeywordRegex(config.keywords.include);
const excludeRegex = buildKeywordRegex(config.keywords.exclude);

/**
 * Keyword-only classification (no AI)
 * Returns: { relevant: boolean, reason: string, method: 'include'|'exclude' }
 */
function classifyByKeywords(tender) {
  const text = `${tender.title || ''} ${tender.description || ''}`;

  // Check hard-exclude first (dominant non-IT terms win)
  const excludeMatch = text.match(excludeRegex);
  if (excludeMatch) {
    return {
      relevant: false,
      reason: `Hard-exclude: matched "${excludeMatch[0]}" (non-IT category)`,
      method: 'exclude',
    };
  }

  // Check hard-include
  const includeMatch = text.match(includeRegex);
  if (includeMatch) {
    return {
      relevant: true,
      reason: `Hard-include: matched "${includeMatch[0]}" (IT keyword)`,
      method: 'include',
    };
  }

  // No match — needs AI
  return null;
}

// ─── Tier 3: AI Classification ─────────────────────────────────

function parseAiResponse(data) {
  const reply = (data.choices?.[0]?.message?.content || '').trim();
  const isYes = /^yes\b/i.test(reply);
  const reason = reply.replace(/^(YES|NO)\s*[-—:]*\s*/i, '').trim();
  return {
    relevant: isYes,
    reason: reason || (isYes ? 'AI classified as IT-relevant' : 'AI classified as not IT-relevant'),
    method: 'ai',
  };
}

/**
 * Build the prompt for Groq/Llama-3 classification
 */
function buildAIPrompt(tender) {
  const descSnippet = (tender.description || '').substring(0, 500);
  return `You are classifying a government procurement tender as IT-relevant or not.

Tender title: ${tender.title}
Department: ${tender.organization || 'Unknown'}
Sector/Type: ${tender.sector || 'Not specified'}
Description snippet: ${descSnippet || 'No description available'}

Is this tender relevant to an IT/software/hardware/networking company?

Reply with ONLY: YES or NO, followed by a one-line reason.
Example: YES — This tender involves procurement of cloud infrastructure services.`;
}

/**
 * Call Groq API for AI classification
 * Uses Llama-3 model on free tier
 */
async function classifyWithAI(tender) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[classify] No GROQ_API_KEY set — defaulting ambiguous tender to NOT relevant');
    return {
      relevant: false,
      reason: 'No AI API key configured — defaulting to not relevant',
      method: 'ai-fallback',
    };
  }

  const prompt = buildAIPrompt(tender);

  // Rate limit: wait 2.5s between AI calls (Groq free tier = 30 RPM)
  await new Promise(r => setTimeout(r, 2500));

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text();
      // Retry once on rate limit
      if (res.status === 429) {
        console.log(`[classify] Rate limited, waiting 5s and retrying...`);
        await new Promise(r => setTimeout(r, 5000));
        const retry = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1, max_tokens: 100,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!retry.ok) throw new Error(`Groq API ${retry.status} (after retry)`);
        const retryData = await retry.json();
        return parseAiResponse(retryData);
      }
      throw new Error(`Groq API ${res.status}: ${body}`);
    }

    const data = await res.json();
    return parseAiResponse(data);
  } catch (err) {
    console.error(`[classify] AI call failed: ${err.message}`);
    return {
      relevant: false,
      reason: `AI call failed: ${err.message}`,
      method: 'ai-error',
    };
  }
}

// ─── Main Classification Function ───────────────────────────────

/**
 * Classify a single tender through the three-tier pipeline
 * Returns: { relevant: boolean, reason: string, method: string }
 */
async function classify(tender) {
  // Tier 1 & 2: Keyword classification
  const keywordResult = classifyByKeywords(tender);
  if (keywordResult) {
    return keywordResult;
  }

  // Tier 3: AI classification for ambiguous cases
  console.log(`  [classify] Ambiguous: "${(tender.title || '').substring(0, 60)}..." — calling AI`);
  return await classifyWithAI(tender);
}

/**
 * Classify a batch of tenders
 * Returns: { relevant: [], excluded: [], stats: { include, exclude, ai } }
 */
async function classifyBatch(tenders) {
  const results = {
    relevant: [],
    excluded: [],
    stats: { include: 0, exclude: 0, ai: 0, 'ai-fallback': 0, 'ai-error': 0 },
  };

  for (const tender of tenders) {
    const result = await classify(tender);

    const classified = {
      ...tender,
      classification: result,
    };

    if (result.relevant) {
      results.relevant.push(classified);
    } else {
      results.excluded.push(classified);
    }

    results.stats[result.method] = (results.stats[result.method] || 0) + 1;
  }

  console.log(`\n[classify] Batch complete:`);
  console.log(`  Relevant:  ${results.relevant.length}`);
  console.log(`  Excluded:  ${results.excluded.length}`);
  console.log(`  By method: include=${results.stats.include} exclude=${results.stats.exclude} ai=${results.stats.ai}`);

  return results;
}

module.exports = {
  classify,
  classifyBatch,
  classifyByKeywords,
  classifyWithAI,
  buildKeywordRegex,
  includeRegex,
  excludeRegex,
};
