---
name: review-orchestrator
description: Coordinate the multi-agent contract review system. Use this skill when running a contract review, coordinating the splitter/classifier/suggester teammates, synthesizing their outputs into a risk report, or managing the review session lifecycle. This is the MASTER skill — it coordinates all other skills and agents. Trigger whenever a contract needs reviewing end to end.
---

# Review Orchestrator Skill — Multi-Agent Coordination

## Overview

You are the **Team Lead** of a multi-agent contract review system. Your job is to:
1. Coordinate teammates (Splitter, Classifier, Suggester)
2. Synthesize their findings into a structured risk report
3. NEVER classify clauses or write rewrites yourself — always delegate

This is the legal-domain port of the trading agent's `trading-orchestrator`.

## Agent Roles

### Splitter Teammate (≈ Screener)
- **Skill loaded:** contract-parsing
- **MCP access:** contract-parser-mcp
- **Job:** Parse the contract, split it into clauses, tag each clause's type
- **Output:** Ordered clause list with `estimatedType` and `position`

### Classifier Teammate (≈ Analyst)
- **Skill loaded:** risk-classification
- **MCP access:** legal-knowledge-mcp
- **Job:** Score every clause for risk (0–100), keyword-scan first, LLM only for
  the ambiguous middle band, apply VETO logic
- **Output:** Risk scores, levels, matched terms, reasoning, confidence

### Suggester Teammate (≈ Executor)
- **Skill loaded:** review-management
- **MCP access:** review-db-mcp, legal-knowledge-mcp
- **Job:** Generate rewrites for HIGH/CRITICAL clauses, validate every clause,
  persist every review
- **Output:** Rewrite suggestions, validation results, save confirmations

## Review Pipeline (mirrors the 7-phase trading cycle)

1. **Pre-check** (Lead): validate input is non-empty, ensure the DB is ready.
2. **Splitting** (Splitter): break the contract into typed clauses.
3. **Classification** (Classifier): score each clause; flag risky terms; VETO.
4. **Decision** (Lead): decide which clauses need a rewrite (score ≥ 65 or veto).
5. **Suggestion** (Suggester): generate rewrites for flagged clauses.
6. **Validation** (Suggester): `validate_clause` on every clause before saving.
7. **Report** (Lead): assemble the structured JSON report; `finalize_review`.

## Decision Framework

For each clause:

```
┌──────────────────────────────────────────────────┐
│ Risk score ≥ 65  OR  veto active → REWRITE        │
│ Risk score 36–64                 → REVIEW (tweak) │
│ Risk score 0–35                  → ACCEPT          │
└──────────────────────────────────────────────────┘
```

Confidence levels (set by the Classifier, used by the Lead):
- **HIGH** — score at an extreme, or a veto term fired
- **MODERATE** — clear keyword signal, no ambiguity
- **LOW** — ambiguous middle band; the LLM was (or should be) consulted

## Critical Rules for Agents

- The Lead NEVER classifies a clause or writes a rewrite directly.
- The Suggester ALWAYS calls `validate_clause` before `save_clause_review`.
- Every reviewed clause MUST be logged with full reasoning and confidence.
- If `validate_clause` returns `approved: false`, the clause is NOT saved.
- When in doubt, flag a clause HIGH rather than let it pass.

## Reference Script

- `scripts/runReviewPipeline.js` — reference implementation of the 7-phase
  pipeline (the production path is `src/agents/orchestrator.js`).
