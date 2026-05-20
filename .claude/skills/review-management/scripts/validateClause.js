/**
 * Clause validation — all 6 immutable checks must pass.
 * Mirrors check_risk_limits.py: this script DOCUMENTS the validation logic.
 *
 * In production the authoritative implementation is the review-db-mcp
 * `validate_clause` tool — enforced in server CODE so the LLM cannot bypass it.
 * Keeping a readable reference copy here mirrors the trading agent exactly.
 */

import {
  VALIDATION_RULES,
  RISK_LEVELS,
  textDiffRatio,
} from '../../../../mcp-servers/shared/index.js';

/**
 * Run all 6 immutable clause checks.
 *
 * @param {object} clause
 * @param {string} clause.contractId
 * @param {string} clause.clauseText
 * @param {number} clause.riskScore
 * @param {string} clause.riskLevel
 * @param {string|null} clause.rewriteSuggestion
 * @returns {{approved:boolean, checks:Array, checksPassed:number, checksTotal:number}}
 */
export function validateClause(clause) {
  const checks = [];
  let allPassed = true;

  const add = (name, passed, detail) => {
    checks.push({ check: name, passed, detail });
    if (!passed) allPassed = false;
  };

  const text = String(clause.clauseText || '');
  const level = clause.riskLevel;
  const rewrite = clause.rewriteSuggestion;

  // ── CHECK 1: clause text present and within length bounds ──
  const lenOk =
    text.trim().length >= VALIDATION_RULES.MIN_CLAUSE_LENGTH &&
    text.length <= VALIDATION_RULES.MAX_CLAUSE_LENGTH;
  add('clause_text_present', lenOk,
    `Length ${text.length} (allowed ${VALIDATION_RULES.MIN_CLAUSE_LENGTH}-${VALIDATION_RULES.MAX_CLAUSE_LENGTH})`);

  // ── CHECK 2: risk score within 0-100 ──
  const scoreOk =
    typeof clause.riskScore === 'number' &&
    clause.riskScore >= 0 &&
    clause.riskScore <= 100;
  add('risk_score_range', scoreOk, `Score: ${clause.riskScore}`);

  // ── CHECK 3: risk level is a recognised level ──
  const levelOk = RISK_LEVELS.includes(level);
  add('risk_level_valid', levelOk, `Level: ${level}`);

  // ── CHECK 4: every HIGH/CRITICAL clause has a rewrite ──
  const needsRewrite = level === 'HIGH' || level === 'CRITICAL';
  const rewritePresent = Boolean(rewrite && String(rewrite).trim());
  add('rewrite_required', !needsRewrite || rewritePresent,
    needsRewrite
      ? (rewritePresent ? 'Rewrite supplied' : 'HIGH/CRITICAL clause missing rewrite')
      : 'Rewrite not required for this level');

  // ── CHECK 5: every review has a contract id ──
  const contractOk = Boolean(clause.contractId && String(clause.contractId).trim());
  add('contract_id_present', contractOk, clause.contractId || '(missing)');

  // ── CHECK 6: a supplied rewrite must actually differ (>=20%) ──
  if (rewritePresent) {
    const diff = textDiffRatio(text, rewrite);
    const diffOk = diff >= VALIDATION_RULES.MIN_REWRITE_DIFF_PCT;
    add('rewrite_differs', diffOk,
      `Rewrite differs ${(diff * 100).toFixed(0)}% (min ${VALIDATION_RULES.MIN_REWRITE_DIFF_PCT * 100}%)`);
  } else {
    add('rewrite_differs', true, 'No rewrite to compare');
  }

  return {
    approved: allPassed,
    checks,
    checksPassed: checks.filter((c) => c.passed).length,
    checksTotal: checks.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(validateClause({
    contractId: 'C1',
    clauseText: 'The Contractor accepts unlimited liability for any and all damages.',
    riskScore: 92,
    riskLevel: 'CRITICAL',
    rewriteSuggestion: null,
  }), null, 2));
}
