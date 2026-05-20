/**
 * Fastify HTTP server — the entry point that wires the whole pipeline together.
 *
 * Endpoints:
 *   POST /review              run a full clause-by-clause review
 *   GET  /reviews             list past review runs
 *   GET  /reviews/:contractId full stored review for one contract
 *   GET  /health              server + MCP health check
 *
 * The three MCP servers are spawned once at boot and shared across requests.
 */

import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { createClients } from './mcp-client.js';
import { getLLM } from './llm.js';
import { runReviewPipeline } from './agents/orchestrator.js';
import { PROJECT_ROOT } from '../mcp-servers/shared/index.js';

const PORT = Number(process.env.PORT || 3000);

/** Extract plain text from an uploaded contract file (PDF or text). */
async function fileToText(filename, buffer) {
  if (filename && filename.toLowerCase().endsWith('.pdf')) {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  return buffer.toString('utf-8');
}

async function main() {
  const app = Fastify({ logger: true });
  await app.register(multipart);
  await app.register(fastifyStatic, {
    root: path.join(PROJECT_ROOT, 'public'),
    prefix: '/',
    index: ['index.html'],
  });

  // ── Spawn MCP servers + LLM once, reuse for every request ──
  app.log.info('Starting MCP servers...');
  const clients = await createClients();
  const llm = getLLM();
  app.log.info(`MCP servers ready. LLM ${llm ? 'ENABLED' : 'disabled (keyword-only mode)'}.`);

  // ── POST /review ──
  app.post('/review', async (request, reply) => {
    let text = '';
    let contractName = 'Untitled Contract';

    try {
      if (request.isMultipart()) {
        // multipart/form-data: a PDF/text file plus optional contractName field.
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer();
            text = await fileToText(part.filename, buffer);
            if (contractName === 'Untitled Contract' && part.filename) {
              contractName = part.filename;
            }
          } else if (part.fieldname === 'contractName') {
            contractName = String(part.value);
          }
        }
      } else {
        const body = request.body || {};
        text = body.text || '';
        contractName = body.contractName || contractName;
      }
    } catch (e) {
      return reply.code(400).send({ status: 'error', message: `Bad request: ${e.message}` });
    }

    if (!text || !text.trim()) {
      return reply
        .code(400)
        .send({ status: 'error', message: 'Provide contract text via JSON {text} or a file upload.' });
    }

    try {
      const report = await runReviewPipeline({ text, contractName, clients, llm });
      return reply.send({ status: 'success', ...report });
    } catch (e) {
      request.log.error(e);
      return reply.code(500).send({ status: 'error', message: String(e.message || e) });
    }
  });

  // ── GET /reviews ──
  app.get('/reviews', async (_request, reply) => {
    const runs = await clients.db.call('get_recent_runs', { limit: 50 });
    return reply.send(runs);
  });

  // ── GET /reviews/:contractId ──
  app.get('/reviews/:contractId', async (request, reply) => {
    const { contractId } = request.params;
    const stats = await clients.db.call('get_contract_stats', { contractId });
    if (stats.status !== 'success') {
      return reply.code(404).send(stats);
    }
    const history = await clients.db.call('get_review_history', { contractId });
    return reply.send({ status: 'success', ...stats, clauses: history.reviews });
  });

  // ── GET /health ──
  app.get('/health', async (_request, reply) => {
    const dbOk = await clients.db.call('initialize_db');
    return reply.send({
      status: 'ok',
      mcpServers: {
        'review-db-mcp': dbOk.status === 'success' ? 'up' : 'down',
        'legal-knowledge-mcp': 'up',
        'contract-parser-mcp': 'up',
      },
      llm: llm ? 'enabled' : 'disabled',
      timestamp: new Date().toISOString(),
    });
  });

  // ── Graceful shutdown ──
  const shutdown = async () => {
    app.log.info('Shutting down — closing MCP servers...');
    await clients.closeAll();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`Contract Clause Risk Reviewer listening on http://localhost:${PORT}`);
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
