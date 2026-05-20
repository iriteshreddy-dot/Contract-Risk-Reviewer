# Contract Clause Risk Reviewer

A multi-agent Node.js system that takes a contract, breaks it into clauses,
scores each clause for legal risk, and suggests rewrites for the risky ones.

It is a deliberate, structure-for-structure port of a multi-agent **trading
system** into the legal domain — the same orchestration, the same MCP layering,
the same "safety rules live in server code, not prompts" discipline.

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

## How it maps to the trading agent

| Trading Agent                       | Contract Reviewer                          |
|--------------------------------------|--------------------------------------------|
| Angel One API (data source)          | Contract text / PDF parser                 |
| Nifty 50 stocks                      | Contract clauses                           |
| RSI / MACD / EMA indicators          | Liability / indemnity / IP risk signals    |
| Composite score 0–100                | Clause risk score 0–100                    |
| STRONG BUY / BUY / NEUTRAL           | CRITICAL / HIGH / MEDIUM / LOW              |
| Red flag → VETO trade                | Veto term → force HIGH/CRITICAL            |
| `check_risk_limits()` (8 checks)     | `validate_clause()` (6 immutable checks)   |
| `log_trade()` with full reasoning    | `save_clause_review()` with full reasoning |
| `portfolio-db-mcp` SQLite DB         | `review-db-mcp` SQLite DB                  |
| Team Lead → Screener → Analyst → Executor | Orchestrator → Splitter → Classifier → Suggester |

## Quick start

```bash
npm install

# Optional — unlocks LLM nuance scoring + bespoke rewrites.
# The system runs fully WITHOUT a key, in keyword-only mode.
cp .env.example .env        # then set ANTHROPIC_API_KEY

npm test                    # review the sample NDA, print a formatted report
npm start                   # boot the HTTP server on port 3000
```

## API

### `POST /review`
Review a contract supplied as JSON text or a PDF/text file upload.

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
- `GET /reviews` — list past finalized review runs
- `GET /reviews/:contractId` — full stored review for one contract
- `GET /health` — server + MCP server health

## Safety model

Risk rules are enforced in **server code**, not in prompts — the LLM cannot talk
its way past them. `review-db-mcp`'s `validate_clause()` runs 6 immutable checks
on every clause review; a review that fails any check is **rejected and never
saved**:

1. Clause text present (10–5000 chars)
2. Risk score within 0–100
3. Risk level is LOW / MEDIUM / HIGH / CRITICAL
4. Every HIGH/CRITICAL clause carries a rewrite suggestion
5. Every review is linked to a contract id
6. A rewrite differs from the original by ≥ 20%

`npm test` exercises this explicitly — it asserts that invalid reviews are blocked.

## Cost discipline

Keyword scanning and clause templates handle the entire pipeline for free. The
Anthropic API is consulted only for (a) clauses the keyword scan leaves
ambiguous and (b) bespoke rewrites — mirroring the trading agent's "batch first,
individual only when needed" approach.

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
.claude/skills/               4 agent skills (SKILL.md + scripts)
test/                         sample contracts + end-to-end test
```

## Requirements
Node.js 20+. No external services required to run (SQLite is embedded; the
Anthropic key is optional).
