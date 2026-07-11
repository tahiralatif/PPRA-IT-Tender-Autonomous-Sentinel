// ─────────────────────────────────────────────────────────────────
// OLLAMA LOCAL AI
// Uses locally installed Ollama for AI classification and summarization.
// Fallback when Groq API is unavailable or rate-limited.
// ─────────────────────────────────────────────────────────────────

const config = require('./config');

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3';

/**
 * Check if Ollama is available and the model is loaded
 */
async function isAvailable() {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.models?.some(m => m.name?.startsWith(OLLAMA_MODEL)) || false;
  } catch {
    return false;
  }
}

/**
 * Generate a response from Ollama
 * @param {string} prompt - The prompt to send
 * @param {object} options - { temperature, numPredict }
 * @returns {string} The generated text
 */
async function generate(prompt, options = {}) {
  const { temperature = 0.1, numPredict = 500 } = options;

  const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature,
        num_predict: numPredict,
      },
    }),
    signal: AbortSignal.timeout(30000), // 30s timeout
  });

  if (!resp.ok) {
    throw new Error(`Ollama API error: ${resp.status}`);
  }

  const data = await resp.json();
  return data.response?.trim() || '';
}

/**
 * Classify a tender as IT-relevant using Ollama
 * @param {string} title - Tender title
 * @param {string} description - Tender description (optional)
 * @returns {{ relevant: boolean, reason: string }}
 */
async function classifyTender(title, description = '') {
  const prompt = `You are a strict tender classifier for an IT/software company in Pakistan.

Tender Title: ${title}
${description ? `Description: ${description.substring(0, 300)}` : ''}

Classify this tender. Is it relevant to an IT/software company?
Reply with ONLY: YES <reason> or NO <reason>

Examples:
YES - Cloud infrastructure procurement for AI workload
NO - Road construction and civil works
YES - Software development and maintenance services
NO - Medical equipment procurement
YES - Cybersecurity consulting services
NO - Furniture and fixtures supply`;

  const response = await generate(prompt, { temperature: 0.1, numPredict: 100 });

  const upper = response.toUpperCase().trim();
  if (upper.startsWith('YES')) {
    return { relevant: true, reason: response.replace(/^YES\s*[-:]?\s*/i, '').trim() };
  } else {
    return { relevant: false, reason: response.replace(/^NO\s*[-:]?\s*/i, '').trim() };
  }
}

/**
 * Summarize a tender using Ollama
 * @param {string} title - Tender title
 * @param {string} detailText - Full tender detail text
 * @returns {{ scope: string, eligibility: string, budget: string, closingDate: string }}
 */
async function summarizeTender(title, detailText) {
  const truncated = detailText.substring(0, 2000);

  const prompt = `You are analyzing a government IT tender. Extract the following from the tender details.

Tender: ${title}

Details:
${truncated}

Extract and return in this EXACT format (no extra text):
SCOPE: <one sentence describing what the tender is for>
ELIGIBILITY: <who can apply, any certifications or requirements>
BUDGET: <estimated cost if mentioned, or "Not specified">
CLOSING_DATE: <deadline date if mentioned, or "Not specified">`;

  const response = await generate(prompt, { temperature: 0.1, numPredict: 300 });

  const result = { scope: '', eligibility: '', budget: 'Not specified', closingDate: 'Not specified' };

  const scopeMatch = response.match(/SCOPE:\s*(.+)/i);
  const eligMatch = response.match(/ELIGIBILITY:\s*(.+)/i);
  const budgetMatch = response.match(/BUDGET:\s*(.+)/i);
  const dateMatch = response.match(/CLOSING_DATE:\s*(.+)/i);

  if (scopeMatch) result.scope = scopeMatch[1].trim();
  if (eligMatch) result.eligibility = eligMatch[1].trim();
  if (budgetMatch) result.budget = budgetMatch[1].trim();
  if (dateMatch) result.closingDate = dateMatch[1].trim();

  return result;
}

module.exports = { isAvailable, generate, classifyTender, summarizeTender };
