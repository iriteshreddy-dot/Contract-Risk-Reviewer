/**
 * Structural risk-pattern detection for contract clauses.
 *
 * Catches risk that keyword matching misses — clauses risky because of
 * their STRUCTURE rather than any single term: unilateral change rights,
 * sole-discretion grants, no-notice action, perpetual obligations,
 * open-ended "any and all" scope, no-cure-period terminations.
 */

const PATTERNS = [
  {
    name: 'unilateral_change',
    test: /\b(may|can|reserves the right to)\b[^.]*\b(modify|amend|change|update)\b[^.]*\b(at any time|at its discretion)\b/i,
    penalty: 12,
    detail: 'One party may unilaterally change the agreement.',
  },
  {
    name: 'sole_discretion',
    test: /\bsole(?:\s+and\s+absolute)?\s+discretion\b/i,
    penalty: 10,
    detail: 'Decision left to one party’s unreviewable discretion.',
  },
  {
    name: 'no_notice',
    test: /\bwithout\s+(?:prior\s+|any\s+)?(?:written\s+)?notice\b/i,
    penalty: 9,
    detail: 'Adverse action permitted with no notice period.',
  },
  {
    name: 'catch_all_scope',
    test: /\bany and all\b/i,
    penalty: 6,
    detail: 'Open-ended "any and all" scope with no carve-outs.',
  },
  {
    name: 'perpetual_obligation',
    test: /\b(perpetual|perpetuity|indefinitely|never expires?)\b/i,
    penalty: 8,
    detail: 'Obligation or grant has no time limit.',
  },
  {
    name: 'no_cure_period',
    test: /\b(immediately|forthwith)\b[^.]*\bterminat/i,
    penalty: 7,
    detail: 'Termination with no opportunity to cure a breach.',
  },
  {
    name: 'one_sided_obligation',
    // "shall" obligations with no reciprocal "each party" / "both parties".
    test: /\bshall\b/i,
    counterTest: /\b(each party|both parties|mutual|reciprocal)\b/i,
    penalty: 5,
    detail: 'Obligations appear one-sided (no mutuality language).',
  },
];

/**
 * @param {string} clauseText
 * @returns {{patterns:string[], details:string[], patternBonus:number}}
 *          patternBonus is a risk PENALTY (0-20), added to the composite score.
 */
export function detectPatterns(clauseText) {
  const text = String(clauseText || '');
  const patterns = [];
  const details = [];
  let penalty = 0;

  for (const p of PATTERNS) {
    if (!p.test.test(text)) continue;
    if (p.counterTest && p.counterTest.test(text)) continue;
    patterns.push(p.name);
    details.push(p.detail);
    penalty += p.penalty;
  }

  return { patterns, details, patternBonus: Math.min(penalty, 20) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const example =
    'The Company may modify these terms at any time at its sole discretion, ' +
    'and may terminate immediately without notice.';
  console.log(JSON.stringify(detectPatterns(example), null, 2));
}
