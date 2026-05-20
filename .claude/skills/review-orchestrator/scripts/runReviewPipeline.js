/**
 * Reference outline of the 7-phase review pipeline.
 *
 * The production path is src/agents/orchestrator.js (`runReviewPipeline`),
 * which wires the real Splitter / Classifier / Suggester agents to live
 * MCP clients. This file is a readable, dependency-light walkthrough of
 * the same 7 phases for documentation purposes.
 */

export const REVIEW_PHASES = [
  {
    phase: 1,
    name: 'Pre-check',
    owner: 'Orchestrator',
    does: 'Validate the contract text is non-empty and the database is ready.',
  },
  {
    phase: 2,
    name: 'Splitting',
    owner: 'Splitter',
    does: 'Parse the contract and split it into typed clauses (heuristics first).',
  },
  {
    phase: 3,
    name: 'Classification',
    owner: 'Classifier',
    does: 'Score each clause 0-100; keyword-scan first, LLM only for ambiguity; apply VETO.',
  },
  {
    phase: 4,
    name: 'Decision',
    owner: 'Orchestrator',
    does: 'Decide which clauses need a rewrite (risk score >= 65 or veto active).',
  },
  {
    phase: 5,
    name: 'Suggestion',
    owner: 'Suggester',
    does: 'Generate rewrite suggestions for every HIGH / CRITICAL clause.',
  },
  {
    phase: 6,
    name: 'Validation',
    owner: 'Suggester',
    does: 'Run validate_clause on every clause; only validated reviews are saved.',
  },
  {
    phase: 7,
    name: 'Report',
    owner: 'Orchestrator',
    does: 'Assemble the structured JSON report and finalize the review run.',
  },
];

/** Print the pipeline outline. */
export function describePipeline() {
  console.log('Contract Review Pipeline — 7 phases\n');
  for (const p of REVIEW_PHASES) {
    console.log(`  Phase ${p.phase}: ${p.name}  [${p.owner}]`);
    console.log(`    ${p.does}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  describePipeline();
}
