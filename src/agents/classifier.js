/**
 * Classifier Agent — the Analyst equivalent.
 *
 * Job: score each clause for legal risk (0-100). Mirrors the Analyst:
 *   1. Keyword scan first  — legal-knowledge-mcp score_clause_sentiment (free).
 *   2. Composite scoring   — scoreClauseRisk (mirrors compute_composite_score).
 *   3. Structural patterns — detectPatterns (mirrors detect_patterns).
 *   4. LLM ONLY for the ambiguous middle band (confidence === 'LOW').
 *   5. VETO logic          — a veto term forces at least HIGH risk.
 *
 * The Classifier NEVER writes rewrites or touches the database.
 */

import { scoreClauseRisk } from '../../.claude/skills/risk-classification/scripts/scoreClauseRisk.js';
import { detectPatterns } from '../../.claude/skills/risk-classification/scripts/detectPatterns.js';
import { applyTimeDecay } from '../../.claude/skills/risk-classification/scripts/flagRiskyTerms.js';
import { riskLevelFromScore } from '../../mcp-servers/shared/index.js';
import { parseJsonLoose } from '../llm.js';

/** Build per-category risk points from matched risky/standard terms. */
function buildCategoryScores(matchedRisky, matchedStandard) {
  const risky = {};
  const standard = {};
  for (const t of matchedRisky) risky[t.category] = (risky[t.category] || 0) + t.weight;
  for (const t of matchedStandard) standard[t.category] = (standard[t.category] || 0) + t.weight;

  const scores = {};
  for (const cat of new Set([...Object.keys(risky), ...Object.keys(standard)])) {
    const r = risky[cat] || 0;
    const s = standard[cat] || 0;
    // Balancing terms can offset at most 60% of a category's risk — a genuinely
    // risky clause stays risky even when it also contains fair language.
    scores[cat] = r - Math.min(s, r * 0.6);
  }
  return scores;
}

/** Ask the LLM for a nuance adjustment on a clause the keyword scan found ambiguous. */
async function llmNuance(llm, clause, baseScore) {
  const system =
    'You are a contract risk analyst. You receive one contract clause and a '
    + 'preliminary keyword-based risk score (0-100). Judge whether the clause is '
    + 'genuinely riskier or safer than the keyword score suggests. Respond ONLY '
    + 'with JSON: {"adjustment": <integer -25..25>, "note": "<one sentence>"}.';
  const user =
    `Clause type: ${clause.estimatedType}\n`
    + `Preliminary risk score: ${baseScore}\n\n`
    + `Clause text:\n"""${clause.text}"""`;
  const raw = await llm.complete(system, user, 300);
  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed.adjustment !== 'number') return null;
  return {
    adjustment: Math.max(-25, Math.min(25, Math.round(parsed.adjustment))),
    note: String(parsed.note || '').slice(0, 240),
  };
}

export const classifier = {
  /**
   * @param {object} knowledge  legal-knowledge-mcp client
   * @param {Array}  clauses    clause objects from the Splitter
   * @param {object|null} llm   LLM handle (optional)
   * @returns {Promise<Array>}  classified clause objects
   */
  async run(knowledge, clauses, llm) {
    const total = clauses.length;
    const classified = [];

    for (const clause of clauses) {
      // ── 1. Keyword scan (free, runs first) ──
      const scan = await knowledge.call('score_clause_sentiment', {
        clauseText: clause.text,
      });
      const matchedRisky = scan.matchedRisky || [];
      const matchedStandard = scan.matchedStandard || [];
      const vetoTerms = scan.vetoTerms || [];
      const vetoActive = Boolean(scan.vetoActive);
      const vetoCount = vetoTerms.length;

      // ── 2 + 3. Composite score + structural patterns ──
      const categoryScores = buildCategoryScores(matchedRisky, matchedStandard);
      const patterns = detectPatterns(clause.text);
      let scored = scoreClauseRisk({
        categoryScores,
        vetoActive,
        vetoCount,
        patternBonus: patterns.patternBonus,
      });

      // ── 4. LLM only for the ambiguous middle band ──
      let llmNote = '';
      let llmUsed = false;
      if (scored.confidence === 'LOW' && llm) {
        const nuance = await llmNuance(llm, clause, scored.riskScore);
        if (nuance) {
          llmUsed = true;
          llmNote = nuance.note;
          scored = scoreClauseRisk({
            categoryScores,
            vetoActive,
            vetoCount,
            patternBonus: patterns.patternBonus,
            llmAdjustment: nuance.adjustment,
          });
        }
      }

      // ── Boilerplate-tail decay (mirrors apply_time_decay) ──
      const decayed = applyTimeDecay(scored.riskScore, clause.position, total);
      const vetoFloor = vetoCount >= 2 ? 85 : 75;
      const finalScore = vetoActive ? Math.max(decayed, vetoFloor) : decayed;
      const finalLevel = riskLevelFromScore(finalScore);

      // ── Reasoning trail ──
      const reasonParts = [];
      if (vetoActive) reasonParts.push(`VETO: ${scan.vetoReason}`);
      if (matchedRisky.length) {
        reasonParts.push(`Risky terms: ${matchedRisky.map((t) => t.term).join(', ')}`);
      }
      if (matchedStandard.length) {
        reasonParts.push(`Balancing terms: ${matchedStandard.map((t) => t.term).join(', ')}`);
      }
      if (patterns.patterns.length) {
        reasonParts.push(`Structural flags: ${patterns.details.join('; ')}`);
      }
      if (llmNote) reasonParts.push(`LLM judgement: ${llmNote}`);
      if (!reasonParts.length) reasonParts.push('No risky terms or patterns detected.');

      classified.push({
        clauseId: clause.clauseId,
        position: clause.position,
        type: clause.estimatedType,
        text: clause.text,
        riskScore: finalScore,
        riskLevel: finalLevel,
        riskyTermsFound: matchedRisky.map((t) => t.term),
        vetoActive,
        reasoning: reasonParts.join(' | '),
        confidence: scored.confidence,
        llmUsed,
      });
    }

    return classified;
  },
};
