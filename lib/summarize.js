/**
 * AI Tender Summarizer — Groq + Llama-3
 *
 * Takes the full text of a tender (extracted from detail page/PDF)
 * and produces a structured summary:
 *   - Scope of Work
 *   - Eligibility Criteria
 *   - Estimated Budget
 *   - Closing Date
 *
 * Falls back to short description if AI call fails.
 */

const config = require('./config');

// ─── Prompt Builder ─────────────────────────────────────────────

function buildSummarizePrompt(tenderText, title) {
  return `You are a government procurement analyst. Extract key details from this tender.

Tender Title: ${title || 'Not provided'}

Tender Text:
${tenderText}

Extract and summarize the following in a clear, concise format. Use "Not specified" if the information is not available in the text.

**Scope of Work:** (2-3 sentences describing what the tender requires)
**Eligibility Criteria:** (who can apply — experience, certifications, registration requirements)
**Estimated Budget:** (amount if mentioned, otherwise note it's not disclosed)
**Closing Date:** (submission deadline)

Format your reply exactly like this:
SCOPE: <text>
ELIGIBILITY: <text>
BUDGET: <text>
CLOSING: <text>`;
}

// ─── Response Parser ────────────────────────────────────────────

function parseSummaryResponse(content) {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const summary = {
    scope: '',
    eligibility: '',
    budget: '',
    closingDate: '',
  };

  for (const line of lines) {
    if (line.startsWith('SCOPE:')) {
      summary.scope = line.replace(/^SCOPE:\s*/i, '').trim();
    } else if (line.startsWith('ELIGIBILITY:')) {
      summary.eligibility = line.replace(/^ELIGIBILITY:\s*/i, '').trim();
    } else if (line.startsWith('BUDGET:')) {
      summary.budget = line.replace(/^BUDGET:\s*/i, '').trim();
    } else if (line.startsWith('CLOSING:')) {
      summary.closingDate = line.replace(/^CLOSING:\s*/i, '').trim();
    }
  }

  return summary;
}

// ─── AI Summarization ──────────────────────────────────────────

/**
 * Call Groq API to summarize tender text.
 * Rate-limits to respect free tier (30 RPM).
 */
async function summarizeWithAI(tenderText, title) {
  // Try local Ollama first
  if (config.ollama?.enabled) {
    try {
      const ollama = require('./ollama');
      if (await ollama.isAvailable()) {
        console.log(`[summarize] Using local Ollama (${config.ollama.model})`);
        return await ollama.summarizeTender(title, tenderText);
      }
    } catch (err) {
      console.warn(`[summarize] Ollama failed, trying Groq:`, err.message);
    }
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }

  const prompt = buildSummarizePrompt(tenderText, title);

  // Rate limit: wait between calls
  await new Promise((r) => setTimeout(r, 2500));

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
        temperature: 0.2,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const body = await res.text();
      // Rate limit retry
      if (res.status === 429) {
        console.log(`  [summarize] Rate limited, waiting 5s and retrying...`);
        await new Promise((r) => setTimeout(r, 5000));
        const retry = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            max_tokens: 500,
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (!retry.ok) throw new Error(`Groq API ${retry.status} (after retry)`);
        const data = await retry.json();
        return parseSummaryResponse(data.choices?.[0]?.message?.content || '');
      }
      throw new Error(`Groq API ${res.status}: ${body}`);
    }

    const data = await res.json();
    return parseSummaryResponse(data.choices?.[0]?.message?.content || '');
  } catch (err) {
    console.error(`  [summarize] AI call failed: ${err.message}`);
    return null;
  }
}

// ─── Main Export ────────────────────────────────────────────────

/**
 * Summarize a tender using AI.
 *
 * @param {Object} tender - tender object with title, description, and fetched detail text
 * @param {string} detailText - full text extracted from detail page/PDF
 * @returns {Object|null} - { scope, eligibility, budget, closingDate } or null on failure
 */
async function summarizeTender(tender, detailText) {
  const textToSummarize = detailText || tender.description || '';

  if (!textToSummarize || textToSummarize.length < 30) {
    console.log(`  [summarize] Insufficient text for "${(tender.title || '').substring(0, 50)}..." — skipping`);
    return null;
  }

  const title = tender.title || '';
  const summary = await summarizeWithAI(textToSummarize, title);

  if (summary) {
    console.log(`  [summarize] ✅ Summarized: "${title.substring(0, 50)}..."`);
  } else {
    console.log(`  [summarize] ⚠️ AI failed for "${title.substring(0, 50)}..." — will use fallback`);
  }

  return summary;
}

module.exports = {
  summarizeTender,
  summarizeWithAI,
  buildSummarizePrompt,
  parseSummaryResponse,
};
