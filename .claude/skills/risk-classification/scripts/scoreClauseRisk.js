/**
 * Composite clause risk scoring.
 * Mirrors compute_composite_score() / score_signal_strength.py.
 *
 * Trading agent: indicator sub-scores (RSI/MACD/EMA/BB/Volume) → 0-100 signal.
 * Here:          legal-risk sub-scores per category            → 0-100 risk.
 *
 * Each category contributes up to a capped maximum. The caps sum to 100, so the
 * raw category total is already on a 0-100 scale.
 */

import { riskLevelFromScore } from '../../../../mcp-servers/shared/index.js';

// Per-category contribution caps. Mirrors the +/- ranges of RSI/MACD/EMA/BB/Volume.
export const RISK_WEIGHTS = {
  liability: { max: 25 }, // mirrors MACD (widest band — most damaging)
  indemnity: { max: 20 }, // mirrors RSI
  ip_rights: { max: 20 }, // mirrors EMA trend
  termination: { max: 15 }, // mirrors Bollinger
  governing_law: { max: 10 }, // mirrors volume
  payment: { max: 10 },
};

// Raw category points at which a clause is treated as unambiguously high-risk.
// A real clause only touches 1-2 categories, so we normalize against this
// realistic single-clause ceiling rather than the sum of every category cap.
const NORMALIZATION_BASE = 30;

/**
 * @param {object} clauseAnalysis
 * @param {object} clauseAnalysis.categoryScores  raw per-category risk points
 * @param {boolean} clauseAnalysis.vetoActive     veto term detected
 * @param {number} [clauseAnalysis.vetoCount]     number of distinct veto terms
 * @param {number} [clauseAnalysis.patternBonus]  structural-pattern penalty (0-20)
 * @param {number} [clauseAnalysis.llmAdjustment] LLM nuance adjustment (-25..+25)
 * @returns {{rawScore:number, riskScore:number, riskLevel:string, confidence:string}}
 */
export function scoreClauseRisk(clauseAnalysis) {
  const categoryScores = clauseAnalysis.categoryScores || {};
  const vetoActive = Boolean(clauseAnalysis.vetoActive);
  const vetoCount = clauseAnalysis.vetoCount || (vetoActive ? 1 : 0);
  const patternBonus = clauseAnalysis.patternBonus || 0;
  const llmAdjustment = clauseAnalysis.llmAdjustment || 0;

  // Sum each category, clamped to its cap.
  let rawScore = 0;
  for (const [cat, weight] of Object.entries(RISK_WEIGHTS)) {
    const points = Math.max(0, Math.min(categoryScores[cat] || 0, weight.max));
    rawScore += points;
  }

  // Normalize to 0-100, then apply structural + LLM adjustments.
  let riskScore = (rawScore / NORMALIZATION_BASE) * 100;
  riskScore += patternBonus;
  riskScore += llmAdjustment;

  // VETO override: one veto term forces at least HIGH; stacking two or more
  // veto terms forces CRITICAL — such a clause is catastrophic on its own.
  if (vetoActive) {
    riskScore = Math.max(riskScore, vetoCount >= 2 ? 85 : 75);
  }

  riskScore = Math.round(Math.max(0, Math.min(100, riskScore)));
  const riskLevel = riskLevelFromScore(riskScore);

  // Confidence: high at the extremes or on a veto, low in the murky middle.
  let confidence;
  if (vetoActive || riskScore <= 25 || riskScore >= 80) {
    confidence = 'HIGH';
  } else if (riskScore >= 45 && riskScore <= 64) {
    confidence = 'LOW'; // ambiguous band — flag for LLM review
  } else {
    confidence = 'MODERATE';
  }

  return { rawScore: Math.round(rawScore), riskScore, riskLevel, confidence };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const example = {
    categoryScores: { indemnity: 20, liability: 14 },
    vetoActive: false,
    patternBonus: 8,
  };
  console.log(JSON.stringify(scoreClauseRisk(example), null, 2));
}
