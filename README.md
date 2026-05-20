# Contract Clause Risk Reviewer

A multi-agent Node.js system that reads a contract, breaks it into clauses,
scores each clause for legal risk 0–100, and rewrites the dangerous ones —
with every output validated in server code, never in prompts.

```
            ┌──────────────────────────────────────────────┐
            │           Orchestrator  (Team Lead)           │
            │   coordinates · synthesizes · never executes  │
            └───────┬───────────────┬──────────────┬────────┘
                    │               │              │
            ┌───────▼──────┐ ┌──────▼───────┐ ┌────▼─────────┐
            │   Splitter   │ │  Classifier  │ │  Suggester   │
            │  parse +     │ │  risk score  │ │  rewrites +  │
            │  split       │ │  0–100       │ │  validation  │
            └───────┬──────┘ └──────┬───────┘ └────┬─────────┘
                    │               │              │
        ┌───────────▼───┐ ┌─────────▼────────┐ ┌───▼───────────┐
        │ contract-     │ │ legal-knowledge- │ │ review-db-mcp │
        │ parser-mcp    │ │ mcp              │ │ (SAFETY-CRIT) │
        └───────────────┘ └──────────────────┘ └───────────────┘
```

## How it works

Each review runs through a fixed 7-phase pipeline:

| # | Phase           | Owner          | What happens                                                    |
|---|-----------------|----------------|-----------------------------------------------------------------|
| 1 | Pre-check       | Orchestrator   | Validate input is non-empty; ensure the database is ready       |
| 2 | Splitting       | Splitter       | Parse text/PDF; segment into typed clauses (heuristics first)   |
| 3 | Classification  | Classifier     | Score each clause 0–100; keyword scan first, LLM only if needed |
| 4 | Decision        | Orchestrator   | Decide which clauses need a rewrite (risk ≥ 65 or veto active)  |
| 5 | Suggestion      | Suggester      | Generate rewrites for HIGH / CRITICAL clauses                   |
| 6 | Validation      | Suggester      | Run `validate_clause` on every clause before saving             |
| 7 | Report          | Orchestrator   | Assemble structured JSON; persist the run                       |

**Risk levels:** `0–35 LOW · 36–64 MEDIUM · 65–84 HIGH · 85–100 CRITICAL`.

**VETO terms** — *unlimited liability*, *perpetual irrevocable*, *unilateral
amendment*, etc. — escalate a clause automatically. One veto forces at least
HIGH; two or more force CRITICAL.

## Quick start

```bash
npm install

# Optional — unlocks LLM nuance scoring + bespoke rewrites.
# The system runs fully WITHOUT a key, in keyword-only mode.
cp .env.example .env        # then set ANTHROPIC_API_KEY

npm test                    # review the sample NDA, print a formatted report
npm start                   # boot the HTTP server (default port 3000)
```

Then open the bundled frontend at `http://localhost:3000`.

## API

### `POST /review`
Review a contract supplied as JSON text or a PDF / TXT file upload.

```bash
curl -X POST http://localhost:3000/review \
  -H "Content-Type: application/json" \
  -d '{"contractName":"Acme NDA","text":"1. LIABILITY\nThe Contractor accepts unlimited liability for any and all damages."}'
```

PDF upload:

```bash
curl -X POST http://localhost:3000/review \
  -F "file=@./contract.pdf" \
  -F "contractName=Vendor Agreement"
```

Response (abridged):

```json
{
  "status": "success",
  "contractId": "C20260520_ab12cd",
  "contractName": "Acme NDA",
  "totalClauses": 1,
  "overallRiskScore": 85,
  "summary": { "low": 0, "medium": 0, "high": 0, "critical": 1 },
  "clauses": [
    {
      "position": 1,
      "type": "LIABILITY",
      "riskScore": 85,
      "riskLevel": "CRITICAL",
      "riskyTermsFound": ["unlimited liability"],
      "vetoActive": true,
      "rewriteSuggestion": "Except for breaches of confidentiality ...",
      "reasoning": "VETO: Veto term present ...",
      "confidence": "HIGH"
    }
  ],
  "processingTimeMs": 61
}
```

### Other endpoints
- `GET /` — bundled frontend
- `GET /reviews` — list past finalized review runs
- `GET /reviews/:contractId` — full stored review for one contract
- `GET /health` — server + MCP health, LLM enabled state

## Safety model

Risk rules are enforced in **server code**, not in prompts — the LLM cannot
talk its way past them. `review-db-mcp`'s `validate_clause` runs 6 immutable
checks on every clause review; a review that fails any check is **rejected
and never saved**:

1. Clause text present (10–5000 chars)
2. Risk score within 0–100
3. Risk level is `LOW / MEDIUM / HIGH / CRITICAL`
4. Every HIGH/CRITICAL clause carries a rewrite suggestion
5. Every review is linked to a contract id
6. A rewrite differs from the original by ≥ 20% (word-level)

`npm test` exercises this explicitly — it asserts that invalid reviews are
blocked.

## Cost discipline

Keyword scanning and clause templates handle the entire pipeline for free.
The Anthropic API is consulted only for (a) clauses the keyword scan leaves
ambiguous and (b) bespoke rewrites for HIGH/CRITICAL clauses. A typical
review on `claude-sonnet-4-5` costs around `$0.03`; the system runs fully
without an API key.

## Project layout

```
mcp-servers/
  shared/index.js             constants, thresholds, helpers
  contract-parser-mcp/        parse text/PDF, split, type clauses
  review-db-mcp/              SQLite + the 6 immutable validation checks
  legal-knowledge-mcp/        risky-terms library, templates, playbook
src/
  agents/                     orchestrator · splitter · classifier · suggester
  mcp-client.js               spawns and talks to the MCP servers
  llm.js                      optional Anthropic wrapper
  server.js                   Fastify HTTP server
public/                       frontend (HTML / CSS / vanilla ES module)
.claude/skills/               4 agent skills (SKILL.md + scripts)
test/                         sample contracts + end-to-end test
```

## Requirements

Node.js 20+. No external services required to run — SQLite is embedded; the
Anthropic key is optional.
