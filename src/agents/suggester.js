/**
 * Suggester Agent — the Executor equivalent.
 *
 * Job: generate rewrite suggestions for risky clauses and persist every clause
 * review. Mirrors the Executor's discipline exactly:
 *   - ALWAYS calls validate_clause BEFORE saving (mirror: always check_risk_limits).
 *   - Generates rewrites only for HIGH/CRITICAL clauses.
 *   - If validation fails -> log the rejection reason and continue.
 *   - Safety principle: a clause that cannot be validated is never saved.
 */

import { textDiffRatio } from '../../mcp-servers/shared/index.js';

/** Produce a rewrite for a risky clause — LLM if available, else the template. */
async function generateRewrite(knowledge, llm, clause) {
  const tpl = await knowledge.call('get_clause_templates', { clauseType: clause.type });
  const template = tpl.status === 'success' ? tpl.template : '';

  if (llm) {
    const system =
      'You are a contracts attorney redlining a one-sided clause. Rewrite the '
      + 'clause so obligations are mutual, liability is bounded, and scope is '
      + 'reasonable — while preserving the clause\'s commercial intent. Respond '
      + 'with ONLY the rewritten clause text, no preamble.';
    const user =
      `Clause type: ${clause.type}\n`
      + `Risk level: ${clause.riskLevel}\n`
      + `Detected issues: ${clause.reasoning}\n\n`
      + `Original clause:\n"""${clause.text}"""\n\n`
      + `A market-standard reference for this clause type:\n"""${template}"""`;
    const rewrite = await llm.complete(system, user, 700);
    // Accept the LLM rewrite only if it is materially different from the original.
    if (rewrite && textDiffRatio(clause.text, rewrite) >= 0.2) {
      return { rewrite, source: 'llm' };
    }
  }
  return { rewrite: template, source: 'template' };
}

export const suggester = {
  /**
   * @param {object} db         review-db-mcp client
   * @param {object} knowledge  legal-knowledge-mcp client
   * @param {Array}  clauses    classified clauses from the Classifier
   * @param {string} contractId
   * @param {object|null} llm   LLM handle (optional)
   * @returns {Promise<{clauses:Array, saved:number, rejected:number}>}
   */
  async run(db, knowledge, clauses, contractId, llm) {
    const out = [];
    let saved = 0;
    let rejected = 0;

    for (const clause of clauses) {
      const needsRewrite = clause.riskLevel === 'HIGH' || clause.riskLevel === 'CRITICAL';

      let rewriteSuggestion = null;
      let rewriteSource = null;
      if (needsRewrite) {
        const r = await generateRewrite(knowledge, llm, clause);
        rewriteSuggestion = r.rewrite;
        rewriteSource = r.source;
      }

      // ── ALWAYS validate before saving (mirror: always check_risk_limits) ──
      const validation = await db.call('validate_clause', {
        contractId,
        clauseText: clause.text,
        riskScore: clause.riskScore,
        riskLevel: clause.riskLevel,
        rewriteSuggestion,
      });

      let savedOk = false;
      if (validation.approved) {
        const result = await db.call('save_clause_review', {
          contractId,
          clauseText: clause.text,
          clauseType: clause.type,
          position: clause.position,
          riskScore: clause.riskScore,
          riskLevel: clause.riskLevel,
          riskyTermsFound: clause.riskyTermsFound,
          vetoActive: clause.vetoActive,
          rewriteSuggestion,
          reasoning: clause.reasoning,
          confidence: clause.confidence,
        });
        savedOk = result.status === 'success';
        if (savedOk) saved++;
        else rejected++;
      } else {
        rejected++;
        const failed = (validation.checks || [])
          .filter((c) => !c.passed)
          .map((c) => c.check)
          .join(', ');
        console.error(
          `[suggester] clause #${clause.position} rejected — failed checks: ${failed}`,
        );
      }

      out.push({
        ...clause,
        rewriteSuggestion,
        rewriteSource,
        saved: savedOk,
        validationApproved: Boolean(validation.approved),
      });
    }

    return { clauses: out, saved, rejected };
  },
};
