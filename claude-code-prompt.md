# Claude Code Prompt — Contract Clause Risk Reviewer

> Paste this entire prompt into Claude Code in your project directory.
> Have your trading-agent repo open in the same workspace or reference its path.

---

## PROMPT START — PASTE FROM HERE

---

I want to build a **Contract Clause Risk Reviewer** — a multi-agent Node.js system
that takes a contract as input, breaks it into clauses, classifies each clause by
risk level, and suggests rewrites for risky ones.

## Reference project — use this as your architectural blueprint

Before writing any code, read and deeply understand the trading agent project at
`../trading-agent` (or wherever it lives relative to this directory). Specifically study:

- `CLAUDE.md` — the master system design
- `WALKTHROUGH.md` — the 7-phase cycle and agent flow
- `mcp-servers/angel-one-mcp/server.py` — how a FastMCP server is structured
- `mcp-servers/portfolio-db-mcp/server.py` — how safety-critical rules are enforced in
  server CODE (not prompts), the `check_risk_limits()` pattern in particular
- `mcp-servers/news-sentiment-mcp/server.py` — how a data-fetching MCP is structured
- `.claude/skills/trading-orchestrator/SKILL.md` — the orchestrator coordination pattern
- `.claude/skills/portfolio-management/scripts/check_risk_limits.py` — the 8-check
  validation pattern we will mirror for legal clause validation
- `.claude/skills/technical-analysis/scripts/score_signal_strength.py` — the composite
  scoring pattern we will mirror for clause risk scoring
- `mcp-servers/shared/__init__.py` — the shared constants and config pattern

The architecture of THIS project must mirror the trading agent 1:1 with domain swapped.
Every structural pattern that exists there must exist here, in Node.js.

---

## What to build

### Domain mapping (trading → legal)

| Trading Agent                     | Contract Reviewer                          |
|-----------------------------------|--------------------------------------------|
| Angel One API (data source)       | Contract text / PDF parser                 |
| Nifty 50 stocks                   | Contract clauses                           |
| RSI/MACD/EMA indicators           | Risk signals (liability, indemnity, IP...) |
| Composite score 0–100             | Clause risk score 0–100                    |
| STRONG BUY / BUY / NEUTRAL        | HIGH RISK / MEDIUM RISK / LOW RISK         |
| Red flag → VETO trade             | Veto term → FLAG clause                    |
| Sentiment BEARISH overrides       | Critical legal term overrides              |
| `check_risk_limits()` 8 checks    | `validateClause()` validation checks       |
| `log_trade()` with full reasoning | `logReview()` with full reasoning          |
| `portfolio-db-mcp` SQLite DB      | `review-db-mcp` SQLite DB                  |
| Team Lead → Screener → Analyst → Executor | Orchestrator → Splitter → Classifier → Suggester |

---

## Tech stack (Node.js — this is intentional for a specific job application)

- **Runtime:** Node.js 20+
- **HTTP server:** Fastify (not Express — Fastify is faster and shows intentional choice)
- **MCP servers:** `@modelcontextprotocol/sdk` (Node.js MCP SDK)
- **LLM:** Anthropic Claude API (`@anthropic-ai/sdk`) — use `claude-sonnet-4-5` model
- **Database:** `better-sqlite3` (mirrors the SQLite usage in trading agent)
- **PDF parsing:** `pdf-parse` for PDF contract input
- **Environment:** `dotenv`
- **Package manager:** npm

Do NOT use Python anywhere. Everything is Node.js. This is the point.

---

## Project structure to create

```
contract-reviewer/
├── CLAUDE.md                          ← System rules (mirror trading agent's CLAUDE.md)
├── README.md
├── package.json
├── .env.example
├── .gitignore
│
├── .claude/
│   ├── settings.json                  ← { "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
│   └── skills/
│       ├── contract-parsing/
│       │   ├── SKILL.md
│       │   └── scripts/
│       │       ├── splitIntoClauses.js
│       │       └── identifyClauseType.js
│       ├── risk-classification/
│       │   ├── SKILL.md
│       │   └── scripts/
│       │       ├── scoreClauseRisk.js   ← mirrors score_signal_strength.py
│       │       ├── flagRiskyTerms.js    ← mirrors score_sentiment.py
│       │       └── detectPatterns.js   ← mirrors detect_patterns.py
│       ├── review-management/
│       │   ├── SKILL.md               ← mirrors portfolio-management/SKILL.md
│       │   └── scripts/
│       │       ├── validateClause.js   ← mirrors check_risk_limits.py (SAFETY-CRITICAL)
│       │       └── logReview.js        ← mirrors log_trade.py
│       └── review-orchestrator/
│           ├── SKILL.md               ← mirrors trading-orchestrator/SKILL.md
│           └── scripts/
│               └── runReviewPipeline.js
│
├── mcp-servers/
│   ├── shared/
│   │   └── index.js                   ← mirrors shared/__init__.py
│   ├── contract-parser-mcp/
│   │   └── server.js                  ← mirrors angel-one-mcp/server.py
│   ├── review-db-mcp/
│   │   └── server.js                  ← mirrors portfolio-db-mcp/server.py
│   └── legal-knowledge-mcp/
│       └── server.js                  ← mirrors news-sentiment-mcp/server.py
│
├── src/
│   ├── agents/
│   │   ├── orchestrator.js            ← Team Lead
│   │   ├── splitter.js                ← Screener equivalent
│   │   ├── classifier.js              ← Analyst equivalent
│   │   └── suggester.js               ← Executor equivalent
│   └── server.js                      ← Fastify HTTP server (POST /review endpoint)
│
├── data/
│   └── reviews.db                     ← SQLite (auto-created, gitignored)
│
└── test/
    ├── sample-contracts/
    │   ├── simple-nda.txt
    │   └── saas-agreement.txt
    └── test-review.js
```

---

## CLAUDE.md to create (master system file)

Create `CLAUDE.md` with this content as the base, then improve it:

```markdown
# Contract Clause Risk Reviewer

## What this is
A multi-agent Node.js system that reviews contracts clause by clause,
scores each clause for legal risk, and suggests rewrites for risky ones.

## Architecture
```
Orchestrator (Team Lead)
├── Splitter Agent    → parses contract, identifies clauses
├── Classifier Agent  → scores each clause for risk (0–100)
└── Suggester Agent   → generates rewrite suggestions for risky clauses
```

## Review Pipeline (mirrors the 7-phase trading cycle)
1. Pre-check: validate input, check DB ready
2. Splitting: Splitter Agent breaks contract into clauses with types
3. Classification: Classifier Agent scores each clause (0–100) + flags risky terms
4. Decision: Orchestrator decides which clauses need rewrites (score ≥ 65 = risky)
5. Suggestion: Suggester Agent generates rewrites for flagged clauses
6. Validation: validate all outputs before saving
7. Report: generate structured JSON report + save to DB

## Risk Score Scale (mirrors composite signal scoring)
- 0–35:   LOW RISK — standard clause, acceptable
- 36–64:  MEDIUM RISK — worth reviewing, suggest minor tweaks
- 65–84:  HIGH RISK — needs rewrite
- 85–100: CRITICAL — should be removed or heavily renegotiated

## VETO terms (automatic HIGH RISK regardless of score)
- Unlimited liability
- Perpetual irrevocable license
- Unilateral amendment rights
- One-sided indemnification
- No limitation of liability

## IMMUTABLE VALIDATION RULES (enforced in server code, not prompts)
These live in review-db-mcp validateClause() — the LLM cannot bypass them:
1. Clause text must be non-empty
2. Risk score must be 0–100
3. Risk level must be LOW/MEDIUM/HIGH/CRITICAL
4. Every HIGH/CRITICAL clause must have a rewrite suggestion
5. Every review must have a contract_id
6. Rewrite must be different from original (≥20% different)

## MCP Servers
- contract-parser-mcp: parse text/PDF, split clauses, identify types
- review-db-mcp: store reviews, enforce validation, query history
- legal-knowledge-mcp: risky terms library, clause templates, playbook rules

## Agent rules
- Orchestrator NEVER classifies or rewrites directly — always delegates
- Suggester ALWAYS calls validateClause() before saving
- Every review logged with: clause text, score, reasoning, confidence, suggestions
```

---

## MCP servers — implement these in detail

### 1. `mcp-servers/contract-parser-mcp/server.js`

Mirror `angel-one-mcp/server.py` exactly in structure (FastMCP → MCP SDK).

Tools to implement:
```javascript
// Parse raw text or PDF into a contract object
parse_contract({ text?, filePath?, contractName })
→ { contractId, contractName, rawText, wordCount, timestamp }

// Split contract text into individual clauses
split_into_clauses({ contractId, rawText })
→ { clauses: [{ clauseId, text, estimatedType, position }] }

// Identify the type of a clause
identify_clause_type({ clauseText })
→ { type: "LIABILITY"|"INDEMNITY"|"IP"|"TERMINATION"|"PAYMENT"|"CONFIDENTIALITY"|"GOVERNING_LAW"|"OTHER",
    confidence: 0–1 }

// Get a list of all clause types with descriptions
get_clause_types()
→ { types: [...] }
```

Key detail: The `split_into_clauses` function should use heuristics first
(paragraph breaks, numbered sections, "WHEREAS", "NOW THEREFORE", clause headers)
before hitting the LLM. Only call the LLM for ambiguous splits.
Mirror the batch-first approach from `get_watchlist_quotes()`.

### 2. `mcp-servers/review-db-mcp/server.js`

This is the SAFETY-CRITICAL server. Mirror `portfolio-db-mcp/server.py` exactly.
The validation checks here CANNOT be bypassed by the LLM.

SQLite tables to create (mirror `portfolio-schema.md`):

```sql
-- One row per contract reviewed
CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  clause_count INTEGER,
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETE','FAILED'))
);

-- One row per clause
CREATE TABLE clause_reviews (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  clause_text TEXT NOT NULL,
  clause_type TEXT NOT NULL,
  position INTEGER NOT NULL,
  risk_score REAL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level TEXT CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  risky_terms_found TEXT,   -- JSON array
  veto_active INTEGER DEFAULT 0,
  rewrite_suggestion TEXT,
  reasoning TEXT,
  confidence TEXT CHECK (confidence IN ('HIGH','MODERATE','LOW')),
  created_at TEXT NOT NULL
);

-- Summary per review run
CREATE TABLE review_runs (
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
```

Tools to implement:
```javascript
initialize_db()               // create tables, mirrors initialize_portfolio()
save_contract(contractData)   // save contract record
save_clause_review(data)      // save one clause review — runs validateClause() first
validate_clause(clauseData)   // SAFETY-CRITICAL: 6 hard checks, returns approved: bool
get_review_history(contractId?) // get past reviews
get_contract_stats(contractId)  // aggregate stats for a contract
finalize_review(contractId)     // mark complete, compute overall score
```

The `validate_clause()` function must enforce all 6 immutable rules in code
(mirror `check_risk_limits()` exactly — same structure, same approved/checks response shape).

### 3. `mcp-servers/legal-knowledge-mcp/server.js`

Mirror `news-sentiment-mcp/server.py`. This is the knowledge base.

```javascript
get_risky_terms()
// Returns categorized risky legal terms with risk weights
// Mirror BULLISH_KEYWORDS / BEARISH_KEYWORDS / RED_FLAGS from score_sentiment.py
// Categories: liability, indemnity, ip_rights, termination, payment, governing_law
// Each term has: term, weight (1–10), category, why_risky

get_clause_templates(clauseType)
// Returns standard/balanced versions of common clauses
// These are the "rewrite targets" — what a fair clause should look like

get_playbook_rules()
// Returns the review playbook:
// - What makes liability clauses acceptable
// - What indemnity language is market standard
// - What IP assignment terms are fair vs aggressive

score_clause_sentiment({ clauseText })
// Mirror score_headline() from score_sentiment.py
// Scan for risky terms, return { score, matchedTerms, vetoActive }
// Use keyword matching first, not LLM (fast + cheap for initial scan)
```

---

## Shared config — `mcp-servers/shared/index.js`

Mirror `shared/__init__.py` exactly:

```javascript
// mcp-servers/shared/index.js

// Risk thresholds (IMMUTABLE — mirror trading agent's IMMUTABLE RISK LIMITS)
export const RISK_THRESHOLDS = {
  LOW_MAX: 35,
  MEDIUM_MAX: 64,
  HIGH_MAX: 84,
  // 85+ = CRITICAL
};

export const VETO_TERMS = [
  'unlimited liability',
  'perpetual irrevocable',
  'unilateral amendment',
  'sole discretion to modify',
  'indemnify and hold harmless from any and all',
  'no limitation of liability',
  'assigns without consent',
];

export const CLAUSE_TYPES = [
  'LIABILITY', 'INDEMNITY', 'IP', 'TERMINATION',
  'PAYMENT', 'CONFIDENTIALITY', 'GOVERNING_LAW', 'OTHER'
];

// Validation rules (mirrors check_risk_limits constants)
export const VALIDATION_RULES = {
  MIN_CLAUSE_LENGTH: 10,
  MAX_CLAUSE_LENGTH: 5000,
  MIN_REWRITE_DIFF_PCT: 0.20,  // rewrite must differ by at least 20%
  REQUIRED_REWRITE_ABOVE: 64,  // HIGH and CRITICAL must have rewrites
};

export const DB_PATH = process.env.DB_PATH || './data/reviews.db';
```

---

## Fastify HTTP server — `src/server.js`

Single endpoint that drives the whole pipeline:

```javascript
POST /review
Body: { text?: string, contractName?: string }
// Also accept multipart/form-data with a PDF file

Response:
{
  contractId: string,
  contractName: string,
  totalClauses: number,
  overallRiskScore: number,  // 0–100
  summary: {
    low: number,
    medium: number,
    high: number,
    critical: number
  },
  clauses: [
    {
      position: number,
      type: string,
      text: string,
      riskScore: number,
      riskLevel: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
      riskyTermsFound: string[],
      vetoActive: boolean,
      rewriteSuggestion: string | null,
      reasoning: string,
      confidence: "HIGH"|"MODERATE"|"LOW"
    }
  ],
  processingTimeMs: number
}
```

Also add:
```javascript
GET /reviews              // list past review runs
GET /reviews/:contractId  // get full review for a contract
GET /health               // server health check
```

---

## Agent pipeline — `src/agents/`

### `orchestrator.js`
Mirror `trading-orchestrator/SKILL.md` — the 7-phase cycle.
Responsibilities:
- Coordinates the pipeline phases
- NEVER classifies or rewrites directly
- Synthesizes outputs from all agents
- Handles errors and partial failures gracefully
- Logs the full pipeline run

### `splitter.js`
Mirror the Screener Agent.
Responsibilities:
- Calls `contract-parser-mcp` tools
- Returns structured clause list with types
- Uses heuristics before LLM (batch-first, cost-efficient)

### `classifier.js`
Mirror the Analyst Agent.
Responsibilities:
- Calls `legal-knowledge-mcp` to get risky terms
- Scores each clause using keyword matching first
- Calls LLM only for clauses that need nuanced judgment (score in 40–70 range)
- Applies veto logic for VETO_TERMS
- Returns risk scores + reasoning for each clause

### `suggester.js`
Mirror the Executor Agent.
Responsibilities:
- ALWAYS calls `validateClause()` before saving (mirror: always call check_risk_limits)
- Generates rewrites only for HIGH/CRITICAL clauses
- Calls `save_clause_review()` with full reasoning
- If validation fails → log rejection reason, continue with next clause
- Safety principle: when in doubt, flag as HIGH rather than pass

---

## Skills to create

### `.claude/skills/risk-classification/scripts/scoreClauseRisk.js`

Mirror `score_signal_strength.py` exactly in structure:

```javascript
// scoreClauseRisk.js
// Composite clause risk scoring — mirrors compute_composite_score()
// Input: clause analysis object
// Output: { rawScore, riskScore (0-100), riskLevel, confidence }

const RISK_WEIGHTS = {
  liability:       { max: 25 },  // mirrors RSI score (+/-20)
  indemnity:       { max: 20 },  // mirrors MACD score (+/-25)
  ip_assignment:   { max: 20 },  // mirrors EMA trend (+/-15)
  termination:     { max: 15 },  // mirrors Bollinger (+/-10)
  governing_law:   { max: 10 },  // mirrors volume (+/-10)
  payment_terms:   { max: 10 },
};

export function scoreClauseRisk(clauseAnalysis) {
  // ... implement scoring
  // normalize: (rawScore / maxPossible) * 100
  // return { rawScore, riskScore, riskLevel, confidence }
}
```

### `.claude/skills/risk-classification/scripts/flagRiskyTerms.js`

Mirror `score_sentiment.py`:

```javascript
// RISKY_TERMS (mirrors BEARISH_KEYWORDS — negative weight terms)
// STANDARD_TERMS (mirrors BULLISH_KEYWORDS — positive weight terms)  
// VETO_TERMS (mirrors RED_FLAGS — trigger automatic HIGH RISK)

export function flagRiskyTerms(clauseText) {
  // keyword scan first (no LLM)
  // return { score, matchedRisky, matchedStandard, vetoActive, vetoReason }
}

export function applyTimeDecay(score, clausePosition, totalClauses) {
  // clauses at the end of contracts are less likely to be read carefully
  // apply slight weight reduction for boilerplate sections
  // mirror apply_time_decay() from score_sentiment.py
}
```

---

## Key implementation notes

1. **MCP server transport**: Use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
   for consistency with trading agent's stdio transport.

2. **Error handling**: Every tool must return `{ status: "success"|"error", ... }` — same
   shape as the trading agent's tools. Never throw uncaught errors.

3. **Logging**: Log to stderr only (stdout is for MCP JSON-RPC) — same pattern as
   `logging.basicConfig(stream=sys.stderr)` in the trading agent.

4. **LLM calls**: Use `@anthropic-ai/sdk`. Model: `claude-sonnet-4-5`. Wrap every call
   in try/catch. Always include structured output instructions in the system prompt.

5. **Cost efficiency**: Mirror the trading agent's "batch first, individual only when needed"
   approach. Keyword scan first, LLM only for ambiguous cases. This is a design pattern
   Genie specifically cares about (they mention API efficiency in their architecture).

6. **The README**: Write it in the style of the trading agent's README — architecture diagram,
   quick start, safety section, file map. Reviewers should immediately recognize the
   intentional mirroring.

7. **Sample contracts**: Create 2 sample contracts in `test/sample-contracts/`:
   - `simple-nda.txt` — 5–8 clauses, mix of low and high risk
   - `saas-agreement.txt` — 10–12 clauses, more complex, includes aggressive IP clause
   These become your demo material.

---

## What to build first (order matters)

1. `package.json` + `mcp-servers/shared/index.js` — foundation
2. `mcp-servers/review-db-mcp/server.js` — database + validation (safety layer first,
   mirrors how the trading agent builds the safety layer before the data layer)
3. `mcp-servers/legal-knowledge-mcp/server.js` — knowledge base (risky terms, templates)
4. `mcp-servers/contract-parser-mcp/server.js` — contract input layer
5. Skills scripts (`scoreClauseRisk.js`, `flagRiskyTerms.js`, `validateClause.js`)
6. Agent pipeline (`splitter.js`, `classifier.js`, `suggester.js`, `orchestrator.js`)
7. `src/server.js` — Fastify HTTP server wiring it all together
8. `CLAUDE.md` — system rules file
9. `README.md` — with architecture diagram
10. Sample contracts + `test/test-review.js`

---

## Definition of done

The project is complete when:
- `npm start` boots the Fastify server on port 3000
- `POST /review` with either raw text or a PDF returns a full structured review
- All 3 MCP servers start without errors
- `validateClause()` correctly blocks invalid reviews (test this explicitly)
- `test/test-review.js` runs the sample NDA and prints a formatted report
- README includes a working curl example
- The architecture is clearly recognizable as a port of the trading agent

---

## PROMPT END

---
