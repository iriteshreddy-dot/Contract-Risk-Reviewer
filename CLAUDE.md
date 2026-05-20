# Contract Clause Risk Reviewer

## What This Is
A multi-agent Node.js system that reviews contracts clause by clause, scores
each clause for legal risk (0–100), and suggests rewrites for risky ones. It is
a 1:1 domain port of a multi-agent trading system — every structural pattern
from that system exists here, with the domain swapped from markets to legal.

## Architecture

```
Orchestrator (Team Lead) — coordinates, synthesizes, decides
├── Splitter Agent    → parses the contract, identifies clauses   (≈ Screener)
├── Classifier Agent  → scores each clause for risk (0–100)        (≈ Analyst)
└── Suggester Agent   → generates rewrites for risky clauses       (≈ Executor)
```

The Orchestrator NEVER classifies or rewrites — it only delegates and synthesizes.

## Skills (loaded by agents via `.claude/skills/`)

| Skill                | Used By      | Purpose                                            |
|----------------------|--------------|----------------------------------------------------|
| `contract-parsing`   | Splitter     | Parse text/PDF, split clauses, identify types      |
| `risk-classification`| Classifier   | Risky-term scan, composite scoring, pattern detect  |
| `review-management`  | Suggester    | Immutable validation, review journaling            |
| `review-orchestrator`| Orchestrator | 7-phase pipeline coordination                      |

## MCP Servers

- **contract-parser-mcp** — parse text/PDF, split clauses, identify types
  (`parse_contract`, `split_into_clauses`, `identify_clause_type`, `get_clause_types`)
- **review-db-mcp** — store reviews, enforce validation, query history
  (`initialize_db`, `save_contract`, `validate_clause`, `save_clause_review`,
  `get_review_history`, `get_recent_runs`, `get_contract_stats`, `finalize_review`)
- **legal-knowledge-mcp** — risky-terms library, clause templates, playbook rules
  (`get_risky_terms`, `get_clause_templates`, `get_playbook_rules`, `score_clause_sentiment`)

## Review Pipeline (mirrors the 7-phase trading cycle)
1. **Pre-check**: validate input, ensure the database is ready
2. **Splitting**: Splitter breaks the contract into clauses with types
3. **Classification**: Classifier scores each clause (0–100) + flags risky terms
4. **Decision**: Orchestrator decides which clauses need rewrites (score ≥ 65 = risky)
5. **Suggestion**: Suggester generates rewrites for flagged clauses
6. **Validation**: every output validated before it is saved
7. **Report**: structured JSON report assembled + persisted to the database

## Risk Score Scale (mirrors composite signal scoring)
- **0–35  LOW** — standard clause, acceptable
- **36–64 MEDIUM** — worth reviewing, suggest minor tweaks
- **65–84 HIGH** — needs a rewrite
- **85–100 CRITICAL** — should be removed or heavily renegotiated

## VETO Terms (automatic HIGH RISK regardless of score)
- Unlimited liability
- Perpetual irrevocable license
- Unilateral amendment rights
- One-sided indemnification ("indemnify and hold harmless from any and all")
- No limitation of liability

One veto term forces a clause to at least HIGH; two or more force CRITICAL.

## IMMUTABLE VALIDATION RULES (enforced in server code, not prompts)
These live in `review-db-mcp` `validate_clause()` — the LLM cannot bypass them:
1. Clause text must be non-empty (and within 10–5000 chars)
2. Risk score must be 0–100
3. Risk level must be LOW / MEDIUM / HIGH / CRITICAL
4. Every HIGH/CRITICAL clause must have a rewrite suggestion
5. Every review must have a contract_id
6. A rewrite must differ from the original by ≥ 20%

## Agent Rules
- The Orchestrator NEVER classifies or rewrites directly — always delegates.
- The Suggester ALWAYS calls `validate_clause()` before saving.
- Every review is logged with: clause text, score, reasoning, confidence, suggestions.
- Keyword scan runs first; the LLM is consulted only for ambiguous clauses.
- When in doubt, flag a clause HIGH rather than let it pass.

## Cost Discipline
Mirrors the trading agent's "batch first, individual only when needed":
keyword matching and clause templates handle the whole pipeline for free. The
Anthropic API is consulted only for (a) clauses left ambiguous by the keyword
scan and (b) bespoke rewrites. The system runs fully without an API key.

## Tech Stack
Node.js 20+ · Fastify (HTTP) · `@modelcontextprotocol/sdk` (MCP) ·
`@anthropic-ai/sdk` (LLM, model `claude-sonnet-4-5`) · `better-sqlite3` (DB) ·
`pdf-parse` (PDF input) · `dotenv`.

## File Structure
```
contract-reviewer/
├── CLAUDE.md / README.md
├── package.json / .env.example / .gitignore
├── .claude/
│   ├── settings.json
│   └── skills/
│       ├── contract-parsing/      (SKILL.md + scripts)
│       ├── risk-classification/   (SKILL.md + scripts)
│       ├── review-management/     (SKILL.md + scripts)
│       └── review-orchestrator/   (SKILL.md + scripts)
├── mcp-servers/
│   ├── shared/index.js            # constants, thresholds, helpers
│   ├── contract-parser-mcp/server.js
│   ├── review-db-mcp/server.js    # SAFETY-CRITICAL validation layer
│   └── legal-knowledge-mcp/server.js
├── src/
│   ├── agents/                    # orchestrator, splitter, classifier, suggester
│   ├── mcp-client.js              # spawns + talks to the MCP servers
│   ├── llm.js                     # Anthropic wrapper (optional)
│   └── server.js                  # Fastify HTTP server
├── data/reviews.db                # SQLite (auto-created, gitignored)
└── test/                          # sample contracts + test-review.js
```

## Getting Started
1. `npm install`
2. (Optional) copy `.env.example` → `.env` and add `ANTHROPIC_API_KEY`
3. `npm test` — runs the sample NDA and prints a formatted report
4. `npm start` — boots the Fastify server on port 3000
5. `POST /review` with `{ "text": "..." }` or a PDF upload
