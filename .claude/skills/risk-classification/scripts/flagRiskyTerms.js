/**
 * Risky-term keyword scanning for contract clauses.
 * Mirrors score_sentiment.py from the trading agent.
 *
 *   RISKY_TERMS    ↔ BEARISH_KEYWORDS  (push risk score up)
 *   STANDARD_TERMS ↔ BULLISH_KEYWORDS  (fair/balanced language, pull risk down)
 *   VETO_TERMS     ↔ RED_FLAGS         (automatic HIGH RISK override)
 *
 * Keyword matching runs FIRST — it is fast and free. The LLM is only consulted
 * for clauses the keyword scan leaves ambiguous (mirrors batch-first design).
 */

import { VETO_TERMS } from '../../../../mcp-servers/shared/index.js';

// term: substring to match (lowercase) · weight: 1-10 · category · why_risky
export const RISKY_TERMS = [
  // ── liability ────────────────────────────────────────────
  { term: 'unlimited liability', weight: 10, category: 'liability', why_risky: 'Exposes a party to uncapped financial damages.' },
  { term: 'no limitation of liability', weight: 10, category: 'liability', why_risky: 'Removes the standard damages cap entirely.' },
  { term: 'liable for all', weight: 7, category: 'liability', why_risky: 'Sweeping liability with no carve-outs.' },
  { term: 'consequential damages', weight: 4, category: 'liability', why_risky: 'Indirect/consequential damages should normally be excluded.' },
  { term: 'without limitation', weight: 3, category: 'liability', why_risky: 'Open-ended language broadens exposure.' },

  // ── indemnity ────────────────────────────────────────────
  { term: 'indemnify and hold harmless from any and all', weight: 10, category: 'indemnity', why_risky: 'Unbounded, one-sided indemnification obligation.' },
  { term: 'defend, indemnify', weight: 6, category: 'indemnity', why_risky: 'Adds a duty-to-defend on top of indemnity costs.' },
  { term: 'indemnify', weight: 4, category: 'indemnity', why_risky: 'Indemnity present — confirm it is mutual and capped.' },
  { term: 'against any claims', weight: 4, category: 'indemnity', why_risky: 'Broad claim scope with no materiality threshold.' },

  // ── ip_rights ────────────────────────────────────────────
  { term: 'perpetual irrevocable', weight: 10, category: 'ip_rights', why_risky: 'Grant can never be revoked or time-limited.' },
  { term: 'perpetual, irrevocable', weight: 9, category: 'ip_rights', why_risky: 'Grant can never be revoked or time-limited.' },
  { term: 'assigns all right, title and interest', weight: 7, category: 'ip_rights', why_risky: 'Full IP assignment with no retained licence.' },
  { term: 'work made for hire', weight: 5, category: 'ip_rights', why_risky: 'Default ownership shifts to the other party.' },
  { term: 'all intellectual property', weight: 5, category: 'ip_rights', why_risky: 'Sweeping IP scope — confirm pre-existing IP is excluded.' },
  { term: 'waives any moral rights', weight: 6, category: 'ip_rights', why_risky: 'Permanent waiver of attribution/integrity rights.' },
  { term: 'perpetual confidentiality', weight: 5, category: 'ip_rights', why_risky: 'Confidentiality with no time limit is hard to comply with.' },

  // ── termination ──────────────────────────────────────────
  { term: 'sole discretion to modify', weight: 9, category: 'termination', why_risky: 'One party can unilaterally change the deal.' },
  { term: 'unilateral amendment', weight: 9, category: 'termination', why_risky: 'One party can amend terms without consent.' },
  { term: 'terminate at any time without cause', weight: 7, category: 'termination', why_risky: 'No-cause termination with no protection for the counterparty.' },
  { term: 'without cause', weight: 6, category: 'termination', why_risky: 'Termination permitted with no reason given.' },
  { term: 'without notice', weight: 6, category: 'termination', why_risky: 'No notice period before an adverse action.' },
  { term: 'at any time', weight: 3, category: 'termination', why_risky: 'Open-ended timing gives one party unchecked latitude.' },
  { term: 'suspend', weight: 3, category: 'termination', why_risky: 'Service/access suspension — confirm it is not unilateral.' },
  { term: 'sole discretion', weight: 5, category: 'termination', why_risky: 'Unreviewable discretionary power.' },
  { term: 'survive termination indefinitely', weight: 5, category: 'termination', why_risky: 'Obligations never expire after the contract ends.' },

  // ── payment ──────────────────────────────────────────────
  { term: 'non-refundable', weight: 4, category: 'payment', why_risky: 'Fees retained even if performance fails.' },
  { term: 'payable immediately', weight: 3, category: 'payment', why_risky: 'No payment runway / net-terms.' },
  { term: 'interest on overdue', weight: 3, category: 'payment', why_risky: 'Penalty interest — confirm the rate is reasonable.' },

  // ── governing_law ────────────────────────────────────────
  { term: 'waives all rights', weight: 8, category: 'governing_law', why_risky: 'Blanket waiver of legal rights.' },
  { term: 'waive any right to a jury trial', weight: 6, category: 'governing_law', why_risky: 'Removes the right to a jury trial.' },
  { term: 'exclusive jurisdiction', weight: 3, category: 'governing_law', why_risky: 'Disputes locked to one (possibly inconvenient) forum.' },
];

// Fair / market-standard language — presence pulls the risk score DOWN.
// NOTE: terms must be unambiguous — "limitation of liability" is deliberately
// excluded because it is a substring of the RISKY term "no limitation of
// liability" and would cancel it out.
export const STANDARD_TERMS = [
  { term: 'liability shall not exceed', weight: 7, category: 'liability' },
  { term: 'aggregate liability', weight: 5, category: 'liability' },
  { term: 'capped at', weight: 6, category: 'liability' },
  { term: 'mutual indemnification', weight: 7, category: 'indemnity' },
  { term: 'each party shall indemnify', weight: 6, category: 'indemnity' },
  { term: 'for cause', weight: 4, category: 'termination' },
  { term: 'written notice', weight: 4, category: 'termination' },
  { term: 'cure period', weight: 5, category: 'termination' },
  { term: 'days notice', weight: 3, category: 'termination' },
  { term: 'retains ownership', weight: 6, category: 'ip_rights' },
  { term: 'pre-existing intellectual property', weight: 5, category: 'ip_rights' },
  { term: 'net 30', weight: 2, category: 'payment' },
  { term: 'reasonable', weight: 1, category: 'governing_law' },
];

/**
 * Scan a clause for risky / standard / veto terms.
 * Pure keyword matching — no LLM call.
 *
 * @returns {{score:number, matchedRisky:Array, matchedStandard:Array,
 *            vetoActive:boolean, vetoReason:string}}
 */
export function flagRiskyTerms(clauseText) {
  const text = String(clauseText || '').toLowerCase();

  const matchedRisky = RISKY_TERMS.filter((t) => text.includes(t.term));
  const matchedStandard = STANDARD_TERMS.filter((t) => text.includes(t.term));

  // Collect EVERY veto term — a clause that stacks two or more veto terms is
  // catastrophic, and the classifier escalates it from HIGH to CRITICAL.
  const vetoTerms = VETO_TERMS.filter((veto) => text.includes(veto));
  const vetoActive = vetoTerms.length > 0;
  const vetoReason = vetoActive
    ? `Veto term${vetoTerms.length > 1 ? 's' : ''} present: ${vetoTerms.map((v) => `"${v}"`).join(', ')}`
    : '';

  const riskySum = matchedRisky.reduce((s, t) => s + t.weight, 0);
  const standardSum = matchedStandard.reduce((s, t) => s + t.weight, 0);

  return {
    score: riskySum - standardSum,
    matchedRisky,
    matchedStandard,
    vetoActive,
    vetoReason,
    vetoTerms,
  };
}

/**
 * Slightly discount the risk of clauses buried late in a contract's
 * boilerplate tail — they are statistically less negotiated.
 * Mirrors apply_time_decay() from score_sentiment.py.
 *
 * Returns a multiplier in [0.9, 1.0]; never increases score.
 */
export function applyTimeDecay(score, clausePosition, totalClauses) {
  if (!totalClauses || totalClauses < 4) return score;
  const positionRatio = clausePosition / totalClauses;
  // Last 25% of the document = boilerplate tail.
  const multiplier = positionRatio > 0.75 ? 0.9 : 1.0;
  return Math.round(score * multiplier);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const examples = [
    'The Contractor shall indemnify and hold harmless from any and all claims the Company.',
    'Either party may terminate this Agreement for cause upon thirty (30) days written notice.',
    'All intellectual property created shall be assigned to the Company on a perpetual, irrevocable basis.',
  ];
  for (const ex of examples) {
    console.log(`"${ex.slice(0, 55)}..." →`, JSON.stringify(flagRiskyTerms(ex)));
  }
}
