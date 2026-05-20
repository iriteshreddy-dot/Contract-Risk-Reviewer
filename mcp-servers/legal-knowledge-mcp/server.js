/**
 * Legal Knowledge MCP Server
 * ==========================
 * The knowledge base. Transport: stdio.
 *
 * Serves the risky-terms library, balanced clause templates, and the
 * review playbook. score_clause_sentiment is a fast, free keyword scan
 * that runs before any LLM call.
 *
 * Tools:
 *   - get_risky_terms        : categorized risky legal terms with risk weights
 *   - get_clause_templates   : market-standard "rewrite target" clauses
 *   - get_playbook_rules     : the review playbook (fair vs aggressive language)
 *   - score_clause_sentiment : keyword-scan a clause for risky terms + veto
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { CLAUSE_TYPES } from '../shared/index.js';
import {
  flagRiskyTerms,
  RISKY_TERMS,
  STANDARD_TERMS,
} from '../../.claude/skills/risk-classification/scripts/flagRiskyTerms.js';

const log = (...args) => console.error('[legal-knowledge-mcp]', ...args);
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

// ── Market-standard "rewrite target" clauses ───────────────
// What a FAIR version of each clause type should look like. The Suggester
// agent uses these as the baseline when no LLM key is configured.
const CLAUSE_TEMPLATES = {
  LIABILITY:
    "Except for breaches of confidentiality or indemnification obligations, "
    + "each party's total aggregate liability under this Agreement shall not "
    + "exceed the fees paid in the twelve (12) months preceding the claim. "
    + "Neither party shall be liable for indirect, incidental, or consequential damages.",
  INDEMNITY:
    "Each party shall indemnify the other against third-party claims arising "
    + "from its own breach of this Agreement, negligence, or wilful misconduct, "
    + "provided the indemnified party gives prompt notice and reasonable "
    + "cooperation. This indemnity is mutual and is the parties' sole remedy "
    + "for covered claims.",
  IP:
    "Each party retains ownership of its pre-existing intellectual property. "
    + "Deliverables created specifically for the Client transfer to the Client "
    + "upon full payment, while the Contractor retains a licence to reusable, "
    + "non-client-specific components.",
  TERMINATION:
    "Either party may terminate this Agreement for material breach if the "
    + "breach remains uncured thirty (30) days after written notice. Either "
    + "party may terminate for convenience on sixty (60) days' written notice. "
    + "Accrued payment obligations survive termination.",
  PAYMENT:
    "Fees are payable within thirty (30) days of a valid invoice. Late amounts "
    + "accrue interest at 1% per month or the maximum lawful rate, whichever is "
    + "lower. Disputed amounts must be raised in good faith within fifteen (15) days.",
  CONFIDENTIALITY:
    "Each party shall protect the other's Confidential Information using at "
    + "least reasonable care and shall use it solely to perform this Agreement. "
    + "Confidentiality obligations survive for three (3) years after termination "
    + "(or, for trade secrets, for as long as they remain trade secrets).",
  GOVERNING_LAW:
    "This Agreement is governed by the laws of [State/Country]. The parties "
    + "submit to the non-exclusive jurisdiction of its courts and will attempt "
    + "good-faith negotiation before commencing proceedings.",
  OTHER:
    "Restate this clause so that obligations are mutual, scoped to what is "
    + "reasonably necessary, and bounded by a clear time limit or cap.",
};

// ── Review playbook — fair vs aggressive guidance per category ──
const PLAYBOOK_RULES = {
  liability: {
    acceptable: 'Liability capped at fees paid (often 12 months); indirect/'
      + 'consequential damages excluded; carve-outs for confidentiality and IP.',
    aggressive: 'Unlimited or uncapped liability; no exclusion of consequential '
      + 'damages; one party liable, the other not.',
  },
  indemnity: {
    acceptable: 'Mutual indemnity, triggered by breach/negligence/wilful '
      + 'misconduct, with prompt-notice and cooperation conditions.',
    aggressive: 'One-sided "indemnify and hold harmless from any and all claims"; '
      + 'no notice requirement; no cap.',
  },
  ip_rights: {
    acceptable: 'Each party keeps pre-existing IP; client owns bespoke '
      + 'deliverables on payment; contractor keeps reusable components.',
    aggressive: 'Perpetual, irrevocable assignment of all IP including '
      + 'pre-existing work; moral rights waived; no licence-back.',
  },
  termination: {
    acceptable: 'Termination for cause with a 30-day cure period; termination '
      + 'for convenience with reasonable notice; mutual rights.',
    aggressive: 'Termination at any time without cause or notice; unilateral '
      + 'amendment rights; no cure period.',
  },
  payment: {
    acceptable: 'Net-30 terms; reasonable, lawful late interest; a good-faith '
      + 'dispute window.',
    aggressive: 'Immediately payable; non-refundable regardless of performance; '
      + 'punitive interest.',
  },
  governing_law: {
    acceptable: 'A named, mutually convenient jurisdiction; good-faith '
      + 'negotiation before litigation.',
    aggressive: 'Blanket waiver of legal rights; jury-trial waiver; an '
      + 'inconvenient exclusive forum.',
  },
};

const server = new McpServer({ name: 'legal-knowledge-mcp', version: '1.0.0' });

// ══════════════════════════════════════════════════════════
// TOOLS
// ══════════════════════════════════════════════════════════

server.tool(
  'get_risky_terms',
  'Return the categorized risky-legal-terms library with risk weights (1-10) and '
    + 'a why_risky explanation for each. Also returns the balanced/standard terms.',
  {},
  async () => {
    try {
      const byCategory = {};
      for (const t of RISKY_TERMS) {
        (byCategory[t.category] ||= []).push(t);
      }
      return ok({
        status: 'success',
        riskyTermCount: RISKY_TERMS.length,
        categories: byCategory,
        standardTerms: STANDARD_TERMS,
      });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'get_clause_templates',
  'Return market-standard, balanced versions of common clauses — the "rewrite '
    + 'target" for risky clauses. Pass a clause type, or omit for all templates.',
  { clauseType: z.string().optional() },
  async ({ clauseType }) => {
    try {
      if (clauseType) {
        const key = clauseType.toUpperCase();
        const template = CLAUSE_TEMPLATES[key] || CLAUSE_TEMPLATES.OTHER;
        return ok({ status: 'success', clauseType: key, template });
      }
      return ok({ status: 'success', templates: CLAUSE_TEMPLATES, clauseTypes: CLAUSE_TYPES });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'get_playbook_rules',
  'Return the review playbook: what is market-standard vs aggressive language '
    + 'for each clause category.',
  {},
  async () => {
    try {
      return ok({ status: 'success', playbook: PLAYBOOK_RULES });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

server.tool(
  'score_clause_sentiment',
  'Keyword-scan a clause for risky terms and veto terms. Fast and free — this '
    + 'runs BEFORE any LLM call (mirrors score_headline). Returns matched terms, '
    + 'a raw keyword score, and whether a veto term triggered.',
  { clauseText: z.string() },
  async ({ clauseText }) => {
    try {
      const flagged = flagRiskyTerms(clauseText);
      return ok({
        status: 'success',
        score: flagged.score,
        matchedTerms: flagged.matchedRisky.map((t) => t.term),
        matchedRisky: flagged.matchedRisky,
        matchedStandard: flagged.matchedStandard,
        vetoActive: flagged.vetoActive,
        vetoReason: flagged.vetoReason,
        vetoTerms: flagged.vetoTerms,
      });
    } catch (e) {
      return ok({ status: 'error', message: String(e.message || e) });
    }
  },
);

// ── Entry point ────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
log('Legal Knowledge MCP server running (stdio)');
