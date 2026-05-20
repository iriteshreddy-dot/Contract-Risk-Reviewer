/**
 * Orchestrator — the Team Lead.
 *
 * Runs the 7-phase review pipeline. The Orchestrator coordinates and
 * synthesizes only — it NEVER classifies a clause or writes a rewrite
 * itself. All real work is delegated to the Splitter, Classifier, and
 * Suggester.
 *
 *   Phase 1  Pre-check       — validate input, ensure the DB is ready
 *   Phase 2  Splitting       — Splitter breaks the contract into clauses
 *   Phase 3  Classification  — Classifier scores each clause for risk
 *   Phase 4  Decision        — Lead decides which clauses need a rewrite
 *   Phase 5  Suggestion      — Suggester generates rewrites for risky clauses
 *   Phase 6  Validation      — every output validated before it is saved
 *   Phase 7  Report          — structured report assembled + persisted
 */

import { splitter } from './splitter.js';
import { classifier } from './classifier.js';
import { suggester } from './suggester.js';
import { RISKY_SCORE_FLOOR } from '../../mcp-servers/shared/index.js';

/**
 * @param {object} opts
 * @param {string} opts.text            raw contract text
 * @param {string} [opts.contractName]
 * @param {object} opts.clients         { db, knowledge, parser } MCP clients
 * @param {object|null} [opts.llm]      LLM handle (optional)
 * @returns {Promise<object>} the structured review report
 */
export async function runReviewPipeline({ text, contractName, clients, llm }) {
  const started = Date.now();
  const { db, knowledge, parser } = clients;
  const phases = [];
  const note = (phase, detail) => phases.push({ phase, detail });

  // ── Phase 1: Pre-check ──
  if (!text || !String(text).trim()) {
    throw new Error('Pre-check failed: contract text is empty.');
  }
  const init = await db.call('initialize_db');
  if (init.status !== 'success') {
    throw new Error(`Pre-check failed: database not ready — ${init.message}`);
  }
  note('pre_check', 'Input validated, database ready.');

  // ── Phase 2: Splitting (delegated to Splitter) ──
  const split = await splitter.run(parser, { text, contractName });
  note('splitting', `Contract split into ${split.clauses.length} clauses.`);

  await db.call('save_contract', {
    contractId: split.contractId,
    name: split.contractName,
    rawText: split.rawText,
    clauseCount: split.clauses.length,
  });

  if (split.clauses.length === 0) {
    throw new Error('Splitting produced no clauses — contract text may be malformed.');
  }

  // ── Phase 3: Classification (delegated to Classifier) ──
  const classified = await classifier.run(knowledge, split.clauses, llm);
  const llmClassifications = classified.filter((c) => c.llmUsed).length;
  note(
    'classification',
    `Scored ${classified.length} clauses (${llmClassifications} escalated to the LLM).`,
  );

  // ── Phase 4: Decision (Lead — synthesis only, no rewriting) ──
  const needRewrite = classified.filter(
    (c) => c.riskScore >= RISKY_SCORE_FLOOR || c.vetoActive,
  );
  note(
    'decision',
    `${needRewrite.length} clause(s) at or above the risk floor (${RISKY_SCORE_FLOOR}) `
      + 'flagged for rewrite.',
  );

  // ── Phase 5 + 6: Suggestion + Validation (delegated to Suggester) ──
  const suggestion = await suggester.run(
    db,
    knowledge,
    classified,
    split.contractId,
    llm,
  );
  note(
    'suggestion_validation',
    `${suggestion.saved} clause review(s) validated and saved, `
      + `${suggestion.rejected} rejected.`,
  );

  // ── Phase 7: Report ──
  const final = await db.call('finalize_review', { contractId: split.contractId });
  if (final.status !== 'success') {
    throw new Error(`Report failed: finalize_review — ${final.message}`);
  }
  note('report', `Review finalized (run ${final.runId}).`);

  return {
    contractId: split.contractId,
    contractName: split.contractName,
    wordCount: split.wordCount,
    totalClauses: final.totalClauses,
    overallRiskScore: final.overallRiskScore,
    summary: final.summary,
    clauses: suggestion.clauses.map((c) => ({
      position: c.position,
      type: c.type,
      text: c.text,
      riskScore: c.riskScore,
      riskLevel: c.riskLevel,
      riskyTermsFound: c.riskyTermsFound,
      vetoActive: c.vetoActive,
      rewriteSuggestion: c.rewriteSuggestion,
      reasoning: c.reasoning,
      confidence: c.confidence,
    })),
    pipeline: {
      phases,
      llmEnabled: Boolean(llm),
      clausesSaved: suggestion.saved,
      clausesRejected: suggestion.rejected,
    },
    processingTimeMs: Date.now() - started,
  };
}
