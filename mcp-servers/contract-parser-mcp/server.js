/**
 * Contract Parser MCP Server
 * ==========================
 * Contract input layer. Transport: stdio.
 *
 * Parses raw text or PDF, splits a contract into clauses, and identifies
 * clause types. Splitting uses cheap heuristics FIRST (numbered sections,
 * headings, recitals) and only escalates to the LLM to disambiguate the
 * leftovers — batch-first discipline for cost efficiency.
 *
 * Tools:
 *   - parse_contract       : raw text or PDF -> a contract object
 *   - split_into_clauses   : contract text -> individual clauses with types
 *   - identify_clause_type : a clause -> its type + confidence
 *   - get_clause_types     : the catalogue of clause types
 */

import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { CLAUSE_TYPES, nowISO, genId } from '../shared/index.js';
import { splitIntoClauses } from '../../.claude/skills/contract-parsing/scripts/splitIntoClauses.js';
import { identifyClauseType } from '../../.claude/skills/contract-parsing/scripts/identifyClauseType.js';

const log = (...args) => console.error('[contract-parser-mcp]', ...args);
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

const CLAUSE_TYPE_DESCRIPTIONS = {
  LIABILITY: 'Caps, exclusions and allocation of legal/financial liability.',
  INDEMNITY: 'Obligations to defend or compensate the other party for claims.',
  IP: 'Ownership, assignment and licensing of intellectual property.',
  TERMINATION: 'How and when the agreement ends; notice and cure periods.',
  PAYMENT: 'Fees, invoicing, payment timing and late-payment terms.',
  CONFIDENTIALITY: 'Protection and permitted use of confidential information.',
  GOVERNING_LAW: 'Choice of law, jurisdiction and dispute resolution.',
  OTHER: 'Boilerplate or clauses that fit none of the categories above.',
};

/** Read a contract file from disk — PDF via pdf-parse, otherwise plain text. */
async function readContractFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (filePath.toLowerCase().endsWith('.pdf')) {
    // Import the lib entry directly — the package index runs debug code under ESM.
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  return buffer.toString('utf-8');
}

const server = new McpServer({ name: 'contract-parser-mcp', version: '1.0.0' });

// ══════════════════════════════════════════════════════════
// TOOLS
// ══════════════════════════════════════════════════════════

server.tool(
  'parse_contract',
  'Parse a contract from raw text or a file (text or PDF) into a contract object '
    + 'with a generated contractId, the extracted raw text, and a word count.',
  {
    text: z.string().optional(),
    filePath: z.string().optional(),
    contractName: z.string().optional(),
  },
  async ({ text, filePath, contractName }) => {
    try {
      let rawText = text || '';
      if (!rawText && filePath) {
        rawText = await readContractFile(filePath);
      }
      rawText = String(rawText || '').trim();
      if (!rawText) {
        return ok({ status: 'error', message: 'No contract text supplied (need text or filePath).' });
      }
      const wordCount = rawText.split(/\s+/).filter(Boolean).length;
      return ok({
        status: 'success',
        contractId: genId('C'),
        contractName: contractName || 'Untitled Contract',
        rawText,
        wordCount,
        timestamp: nowISO(),
      });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'split_into_clauses',
  'Split a contract into individual clauses using heuristics (numbered sections, '
    + 'headings, recital markers, paragraph breaks). Each clause is returned with '
    + 'a heuristic estimatedType and its position.',
  { contractId: z.string(), rawText: z.string() },
  async ({ contractId, rawText }) => {
    try {
      const split = splitIntoClauses(rawText);
      const clauses = split.map((c) => {
        const typed = identifyClauseType(c.text);
        return {
          clauseId: genId('CL'),
          contractId,
          text: c.text,
          position: c.position,
          estimatedType: typed.type,
          typeConfidence: typed.confidence,
        };
      });
      log(`Split ${contractId} into ${clauses.length} clauses`);
      return ok({ status: 'success', contractId, clauseCount: clauses.length, clauses });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'identify_clause_type',
  'Identify the type of a single clause via keyword scoring. Returns the best '
    + 'matching type and a 0-1 confidence (low confidence = escalate to the LLM).',
  { clauseText: z.string() },
  async ({ clauseText }) => {
    try {
      const result = identifyClauseType(clauseText);
      return ok({ status: 'success', ...result });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'get_clause_types',
  'Return the catalogue of recognised clause types with descriptions.',
  {},
  async () => {
    return ok({
      status: 'success',
      types: CLAUSE_TYPES.map((t) => ({ type: t, description: CLAUSE_TYPE_DESCRIPTIONS[t] })),
    });
  },
);

// ── Entry point ────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
log('Contract Parser MCP server running (stdio)');
