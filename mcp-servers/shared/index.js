/**
 * Shared configuration and utilities for all MCP servers and agents.
 *
 * The constants here are IMMUTABLE — they define the system's risk
 * thresholds, veto terms, and validation rules. The logic that consumes
 * them lives in review-db-mcp (server CODE, not prompts), so the LLM
 * cannot talk its way past these limits.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Project paths ──────────────────────────────────────────
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const DB_PATH =
  process.env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'reviews.db');

// ── LLM config ─────────────────────────────────────────────
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ── Risk thresholds (IMMUTABLE) ────────────────────────────
// Risk score 0-100 maps to a level using these boundaries.
export const RISK_THRESHOLDS = {
  LOW_MAX: 35,
  MEDIUM_MAX: 64,
  HIGH_MAX: 84,
  // 85-100 = CRITICAL
};

// Clauses at or above this score are routed for a rewrite suggestion.
export const RISKY_SCORE_FLOOR = 65;

// ── VETO terms (automatic HIGH RISK regardless of composite score) ──
// A clause containing any of these is forced to at least HIGH; two or
// more force CRITICAL. These are the most dangerous drafting patterns.
export const VETO_TERMS = [
  'unlimited liability',
  'perpetual irrevocable',
  'perpetual, irrevocable',
  'unilateral amendment',
  'sole discretion to modify',
  'indemnify and hold harmless from any and all',
  'no limitation of liability',
  'assigns without consent',
  'waives all rights',
];

export const CLAUSE_TYPES = [
  'LIABILITY',
  'INDEMNITY',
  'IP',
  'TERMINATION',
  'PAYMENT',
  'CONFIDENTIALITY',
  'GOVERNING_LAW',
  'OTHER',
];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const CONFIDENCE_LEVELS = ['HIGH', 'MODERATE', 'LOW'];

// ── Validation rules (consumed by validate_clause) ─────────
export const VALIDATION_RULES = {
  MIN_CLAUSE_LENGTH: 10,
  MAX_CLAUSE_LENGTH: 5000,
  MIN_REWRITE_DIFF_PCT: 0.2, // rewrite must differ by at least 20%
  REQUIRED_REWRITE_ABOVE: 64, // HIGH and CRITICAL must have rewrites
};

// ── Helpers ────────────────────────────────────────────────

export function nowISO() {
  return new Date().toISOString();
}

/** Map a 0-100 risk score to a risk level using the immutable thresholds. */
export function riskLevelFromScore(score) {
  if (score <= RISK_THRESHOLDS.LOW_MAX) return 'LOW';
  if (score <= RISK_THRESHOLDS.MEDIUM_MAX) return 'MEDIUM';
  if (score <= RISK_THRESHOLDS.HIGH_MAX) return 'HIGH';
  return 'CRITICAL';
}

/** Word-level Levenshtein distance between two token arrays. */
function wordLevenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Fraction (0-1) by which two texts differ, measured at word level.
 * Used by validateClause to enforce "a rewrite must actually be different".
 */
export function textDiffRatio(a, b) {
  const wa = String(a || '').toLowerCase().split(/\s+/).filter(Boolean);
  const wb = String(b || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (wa.length === 0 && wb.length === 0) return 0;
  const dist = wordLevenshtein(wa, wb);
  return dist / Math.max(wa.length, wb.length);
}

/** Generate a short unique id with a prefix. */
export function genId(prefix) {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.]/g, '')
    .slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${ts}_${rand}`;
}
