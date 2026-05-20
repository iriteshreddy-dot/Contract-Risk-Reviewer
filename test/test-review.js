/**
 * End-to-end test: run the sample NDA through the full pipeline, print a
 * formatted report, and explicitly prove the safety-critical validation layer
 * blocks invalid clause reviews.
 *
 * Run with:  npm test
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClients } from '../src/mcp-client.js';
import { getLLM } from '../src/llm.js';
import { runReviewPipeline } from '../src/agents/orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEVEL_TAG = { LOW: '[ LOW  ]', MEDIUM: '[MEDIUM]', HIGH: '[ HIGH ]', CRITICAL: '[ CRIT ]' };

function printReport(report) {
  console.log('\n' + '='.repeat(72));
  console.log(`  REVIEW: ${report.contractName}`);
  console.log(`  Contract ID: ${report.contractId}`);
  console.log('='.repeat(72));
  console.log(
    `  Clauses: ${report.totalClauses}   `
      + `Overall risk score: ${report.overallRiskScore}/100`,
  );
  const s = report.summary;
  console.log(
    `  LOW ${s.low}  |  MEDIUM ${s.medium}  |  HIGH ${s.high}  |  CRITICAL ${s.critical}`,
  );
  console.log(
    `  LLM: ${report.pipeline.llmEnabled ? 'enabled' : 'keyword-only'}   `
      + `Saved: ${report.pipeline.clausesSaved}   `
      + `Rejected: ${report.pipeline.clausesRejected}   `
      + `Time: ${report.processingTimeMs}ms`,
  );
  console.log('-'.repeat(72));

  for (const c of report.clauses) {
    const tag = LEVEL_TAG[c.riskLevel] || '[  ??  ]';
    const veto = c.vetoActive ? ' VETO' : '';
    console.log(`\n  ${tag} #${c.position} ${c.type}  score ${c.riskScore}/100${veto}`);
    console.log(`  ${c.text.replace(/\s+/g, ' ').slice(0, 100)}...`);
    console.log(`  reasoning: ${c.reasoning}`);
    if (c.rewriteSuggestion) {
      console.log(`  >> rewrite: ${c.rewriteSuggestion.replace(/\s+/g, ' ').slice(0, 110)}...`);
    }
  }
  console.log('\n' + '='.repeat(72));
}

async function testValidationBlocks(clients) {
  console.log('\n--- Safety check: validate_clause must REJECT invalid reviews ---');
  let failures = 0;

  // Case A: a CRITICAL clause with no rewrite suggestion -> must be rejected.
  const a = await clients.db.call('validate_clause', {
    contractId: 'TEST',
    clauseText: 'The Receiving Party accepts unlimited liability for all damages.',
    riskScore: 95,
    riskLevel: 'CRITICAL',
    rewriteSuggestion: null,
  });
  console.log(`  A) CRITICAL clause, no rewrite       -> approved=${a.approved} (expect false)`);
  if (a.approved !== false) failures++;

  // Case B: an out-of-range risk score -> must be rejected.
  const b = await clients.db.call('validate_clause', {
    contractId: 'TEST',
    clauseText: 'A perfectly ordinary clause of sufficient length to pass.',
    riskScore: 150,
    riskLevel: 'LOW',
    rewriteSuggestion: null,
  });
  console.log(`  B) risk score 150 (out of range)     -> approved=${b.approved} (expect false)`);
  if (b.approved !== false) failures++;

  // Case C: a rewrite that barely differs from the original -> must be rejected.
  const original = 'The Receiving Party shall accept unlimited liability for any disclosure.';
  const c = await clients.db.call('validate_clause', {
    contractId: 'TEST',
    clauseText: original,
    riskScore: 90,
    riskLevel: 'HIGH',
    rewriteSuggestion: original + ' Thanks.',
  });
  console.log(`  C) rewrite nearly identical          -> approved=${c.approved} (expect false)`);
  if (c.approved !== false) failures++;

  // Case D: a valid LOW clause with no rewrite -> must be approved.
  const d = await clients.db.call('validate_clause', {
    contractId: 'TEST',
    clauseText: 'This Agreement is governed by the laws of the State of Delaware.',
    riskScore: 15,
    riskLevel: 'LOW',
    rewriteSuggestion: null,
  });
  console.log(`  D) valid LOW clause, no rewrite      -> approved=${d.approved} (expect true)`);
  if (d.approved !== true) failures++;

  if (failures > 0) {
    console.error(`\n  SAFETY TEST FAILED: ${failures} case(s) behaved incorrectly.`);
    return false;
  }
  console.log('\n  Safety test PASSED — validation layer blocks invalid reviews.');
  return true;
}

async function main() {
  const clients = await createClients();
  const llm = getLLM();

  try {
    const ndaPath = path.join(__dirname, 'sample-contracts', 'simple-nda.txt');
    const text = fs.readFileSync(ndaPath, 'utf-8');

    const report = await runReviewPipeline({
      text,
      contractName: 'Sample Mutual NDA',
      clients,
      llm,
    });
    printReport(report);

    const safetyOk = await testValidationBlocks(clients);
    process.exitCode = safetyOk ? 0 : 1;
  } catch (e) {
    console.error('TEST FAILED:', e);
    process.exitCode = 1;
  } finally {
    await clients.closeAll();
  }
}

main();
