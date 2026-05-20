/**
 * Review Database MCP Server
 * ==========================
 * SQLite-backed clause-review storage with HARD-CODED validation enforcement.
 * Transport: stdio (launched by Claude Code or the Fastify pipeline).
 *
 * This is the SAFETY-CRITICAL layer. The 6 immutable validation rules live
 * in server CODE (validate_clause), not in prompts — the LLM cannot talk
 * its way past them.
 *
 * Tools:
 *   - initialize_db        : create tables (run once, idempotent)
 *   - save_contract        : store a contract record
 *   - validate_clause      : SAFETY-CRITICAL — 6 hard checks, returns approved:bool
 *   - save_clause_review   : store one clause review (runs validate_clause first)
 *   - get_review_history   : past clause reviews
 *   - get_recent_runs      : list recent finalized review runs
 *   - get_contract_stats   : aggregate stats for a contract
 *   - finalize_review      : mark complete, compute overall risk score
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { DB_PATH, nowISO, genId } from '../shared/index.js';
import { validateClause } from '../../.claude/skills/review-management/scripts/validateClause.js';

// ── Logging — stderr only (stdout is reserved for MCP JSON-RPC) ──
const log = (...args) => console.error('[review-db-mcp]', ...args);

const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

// ── Database helpers ───────────────────────────────────────
let _db;
function getDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

const server = new McpServer({ name: 'review-db-mcp', version: '1.0.0' });

// ══════════════════════════════════════════════════════════
// TOOLS
// ══════════════════════════════════════════════════════════

server.tool(
  'initialize_db',
  'Create all review tables. Run once at project start. Idempotent — safe to re-run.',
  {},
  async () => {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS contracts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          raw_text TEXT NOT NULL,
          clause_count INTEGER,
          created_at TEXT NOT NULL,
          status TEXT DEFAULT 'PENDING'
            CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETE','FAILED'))
        );

        CREATE TABLE IF NOT EXISTS clause_reviews (
          id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL REFERENCES contracts(id),
          clause_text TEXT NOT NULL,
          clause_type TEXT NOT NULL,
          position INTEGER NOT NULL,
          risk_score REAL CHECK (risk_score >= 0 AND risk_score <= 100),
          risk_level TEXT CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
          risky_terms_found TEXT,
          veto_active INTEGER DEFAULT 0,
          rewrite_suggestion TEXT,
          reasoning TEXT,
          confidence TEXT CHECK (confidence IN ('HIGH','MODERATE','LOW')),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS review_runs (
          id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL,
          total_clauses INTEGER,
          low_risk_count INTEGER DEFAULT 0,
          medium_risk_count INTEGER DEFAULT 0,
          high_risk_count INTEGER DEFAULT 0,
          critical_count INTEGER DEFAULT 0,
          overall_risk_score REAL,
          completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_clause_contract ON clause_reviews(contract_id);
        CREATE INDEX IF NOT EXISTS idx_runs_contract ON review_runs(contract_id);
      `);
      log('Database initialized at', DB_PATH);
      return ok({ status: 'success', message: 'Database initialized', dbPath: DB_PATH });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'save_contract',
  'Store a contract record. Call once per contract before saving its clause reviews.',
  {
    contractId: z.string(),
    name: z.string(),
    rawText: z.string(),
    clauseCount: z.number().int().optional(),
  },
  async ({ contractId, name, rawText, clauseCount }) => {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO contracts (id, name, raw_text, clause_count, created_at, status)
        VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS')
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          raw_text = excluded.raw_text,
          clause_count = excluded.clause_count,
          status = 'IN_PROGRESS'
      `).run(contractId, name, rawText, clauseCount ?? null, nowISO());
      return ok({ status: 'success', contractId, name });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'validate_clause',
  'SAFETY-CRITICAL: run the 6 immutable clause checks. Returns approved:bool plus '
    + 'a per-check breakdown. These rules are enforced in code and cannot be bypassed.',
  {
    contractId: z.string(),
    clauseText: z.string(),
    riskScore: z.number(),
    riskLevel: z.string(),
    rewriteSuggestion: z.string().nullable().optional(),
  },
  async (clause) => {
    try {
      const result = validateClause({
        contractId: clause.contractId,
        clauseText: clause.clauseText,
        riskScore: clause.riskScore,
        riskLevel: clause.riskLevel,
        rewriteSuggestion: clause.rewriteSuggestion ?? null,
      });
      return ok({ status: 'success', ...result });
    } catch (e) {
      return ok({ status: 'error', approved: false, message: String(e.message || e) });
    }
  },
);

server.tool(
  'save_clause_review',
  'Store one clause review. Runs validate_clause FIRST — a review that fails any '
    + 'of the 6 checks is REJECTED and not written to the database.',
  {
    id: z.string().optional(),
    contractId: z.string(),
    clauseText: z.string(),
    clauseType: z.string(),
    position: z.number().int(),
    riskScore: z.number(),
    riskLevel: z.string(),
    riskyTermsFound: z.array(z.string()).optional(),
    vetoActive: z.boolean().optional(),
    rewriteSuggestion: z.string().nullable().optional(),
    reasoning: z.string().optional(),
    confidence: z.string().optional(),
  },
  async (data) => {
    try {
      // ── Defense in depth: validate even though the agent already did ──
      const validation = validateClause({
        contractId: data.contractId,
        clauseText: data.clauseText,
        riskScore: data.riskScore,
        riskLevel: data.riskLevel,
        rewriteSuggestion: data.rewriteSuggestion ?? null,
      });
      if (!validation.approved) {
        log(`Rejected clause #${data.position} of ${data.contractId}: validation failed`);
        return ok({
          status: 'rejected',
          approved: false,
          message: 'Clause review failed validation — not saved.',
          validation,
        });
      }

      const db = getDb();
      const id = data.id || genId('CR');
      db.prepare(`
        INSERT INTO clause_reviews (
          id, contract_id, clause_text, clause_type, position, risk_score,
          risk_level, risky_terms_found, veto_active, rewrite_suggestion,
          reasoning, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, data.contractId, data.clauseText, data.clauseType, data.position,
        data.riskScore, data.riskLevel,
        JSON.stringify(data.riskyTermsFound || []),
        data.vetoActive ? 1 : 0,
        data.rewriteSuggestion ?? null,
        data.reasoning || '',
        data.confidence || 'LOW',
        nowISO(),
      );
      return ok({ status: 'success', approved: true, id, validation });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'get_review_history',
  'Get past clause reviews, optionally filtered to a single contract.',
  { contractId: z.string().optional(), limit: z.number().int().optional() },
  async ({ contractId, limit }) => {
    try {
      const db = getDb();
      const rows = contractId
        ? db.prepare(
            'SELECT * FROM clause_reviews WHERE contract_id = ? ORDER BY position ASC LIMIT ?',
          ).all(contractId, limit ?? 200)
        : db.prepare(
            'SELECT * FROM clause_reviews ORDER BY created_at DESC LIMIT ?',
          ).all(limit ?? 100);
      return ok({ status: 'success', count: rows.length, reviews: rows });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'get_recent_runs',
  'List recent finalized review runs (most recent first), with contract names.',
  { limit: z.number().int().optional() },
  async ({ limit }) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT r.*, c.name AS contract_name, c.status AS contract_status
        FROM review_runs r
        LEFT JOIN contracts c ON c.id = r.contract_id
        ORDER BY r.completed_at DESC
        LIMIT ?
      `).all(limit ?? 50);
      return ok({ status: 'success', count: rows.length, runs: rows });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'get_contract_stats',
  'Aggregate risk statistics for a single contract.',
  { contractId: z.string() },
  async ({ contractId }) => {
    try {
      const db = getDb();
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
      if (!contract) {
        return ok({ status: 'error', message: `Contract ${contractId} not found` });
      }
      const rows = db.prepare(
        'SELECT risk_level, risk_score, veto_active FROM clause_reviews WHERE contract_id = ?',
      ).all(contractId);

      const summary = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const r of rows) {
        if (r.risk_level === 'LOW') summary.low++;
        else if (r.risk_level === 'MEDIUM') summary.medium++;
        else if (r.risk_level === 'HIGH') summary.high++;
        else if (r.risk_level === 'CRITICAL') summary.critical++;
      }
      const overall = rows.length
        ? Math.round(rows.reduce((s, r) => s + (r.risk_score || 0), 0) / rows.length)
        : 0;
      const run = db.prepare(
        'SELECT * FROM review_runs WHERE contract_id = ? ORDER BY completed_at DESC LIMIT 1',
      ).get(contractId);

      return ok({
        status: 'success',
        contractId,
        contractName: contract.name,
        contractStatus: contract.status,
        totalClauses: rows.length,
        summary,
        vetoCount: rows.filter((r) => r.veto_active).length,
        overallRiskScore: overall,
        latestRun: run || null,
      });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'finalize_review',
  'Mark a contract review COMPLETE: record a review_runs summary row with risk '
    + 'counts and the overall risk score, and flip the contract status.',
  { contractId: z.string() },
  async ({ contractId }) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT risk_level, risk_score FROM clause_reviews WHERE contract_id = ?',
      ).all(contractId);

      const counts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
      for (const r of rows) counts[r.risk_level] = (counts[r.risk_level] || 0) + 1;
      const overall = rows.length
        ? Math.round(rows.reduce((s, r) => s + (r.risk_score || 0), 0) / rows.length)
        : 0;

      const runId = genId('RUN');
      db.prepare(`
        INSERT INTO review_runs (
          id, contract_id, total_clauses, low_risk_count, medium_risk_count,
          high_risk_count, critical_count, overall_risk_score, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId, contractId, rows.length, counts.LOW, counts.MEDIUM,
        counts.HIGH, counts.CRITICAL, overall, nowISO(),
      );
      db.prepare("UPDATE contracts SET status = 'COMPLETE' WHERE id = ?").run(contractId);

      return ok({
        status: 'success',
        runId,
        contractId,
        totalClauses: rows.length,
        summary: {
          low: counts.LOW, medium: counts.MEDIUM,
          high: counts.HIGH, critical: counts.CRITICAL,
        },
        overallRiskScore: overall,
      });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

// ── Entry point ────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
log('Review DB MCP server running (stdio)');
