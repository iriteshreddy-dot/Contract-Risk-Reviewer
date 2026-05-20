/**
 * Anthropic LLM wrapper.
 *
 * The system is designed to run WITHOUT an API key — keyword scanning and
 * clause templates cover the whole pipeline. When ANTHROPIC_API_KEY is set the
 * LLM is consulted only for the expensive-judgement cases: clauses the keyword
 * scan leaves ambiguous, and bespoke rewrites. This mirrors the trading agent's
 * "batch first, individual only when needed" cost discipline.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } from '../mcp-servers/shared/index.js';

/**
 * @returns {object|null} an LLM handle, or null when no key is configured.
 */
export function getLLM() {
  if (!ANTHROPIC_API_KEY) return null;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  return {
    model: ANTHROPIC_MODEL,

    /** Single-turn completion. Returns concatenated text, or '' on failure. */
    async complete(system, user, maxTokens = 1024) {
      try {
        const res = await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        });
        return res.content
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('')
          .trim();
      } catch (e) {
        console.error('[llm] completion failed:', String(e.message || e));
        return '';
      }
    },
  };
}

/** Best-effort extraction of the first JSON object from an LLM response. */
export function parseJsonLoose(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
