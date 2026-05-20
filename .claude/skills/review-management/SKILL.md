---
name: review-management
description: Validate and persist contract clause reviews. Use this skill BEFORE saving any clause review to enforce the immutable validation rules, and for review history, contract stats, and finalizing a review run. Used by the Suggester agent. THIS SKILL CONTAINS IMMUTABLE VALIDATION RULES THAT CANNOT BE OVERRIDDEN.
---

# Review Management Skill — Validation & Persistence

## Overview

This is the **safety-critical skill** — the legal-domain port of the trading
agent's `portfolio-management`. Every clause review MUST pass through this
skill's validation before it is written to the database.

## IMMUTABLE VALIDATION RULES

**These 6 rules are hard-coded in the `review-db-mcp` server (`validate_clause`).
Even if the LLM is "convinced" to bypass them, the server rejects the review.**

### Rule 1: Clause text present
Clause text must be non-empty and within length bounds (10–5000 chars).

### Rule 2: Risk score in range
Risk score must be a number between 0 and 100.

### Rule 3: Risk level valid
Risk level must be one of `LOW · MEDIUM · HIGH · CRITICAL`.

### Rule 4: Rewrite required for risky clauses
Every `HIGH` and `CRITICAL` clause MUST carry a rewrite suggestion.

### Rule 5: Contract id present
Every clause review MUST be linked to a contract id.

### Rule 6: Rewrite must be different
A supplied rewrite must differ from the original by **at least 20%**
(word-level edit distance). A cosmetic rewrite is not a rewrite.

**ALL 6 checks must pass. If ANY fails, the review is REJECTED and not saved.**

## Pre-Save Checklist

```
scripts/validateClause.js runs this checklist:

□ Clause text present and within length bounds?
□ Risk score within 0–100?
□ Risk level a recognised level?
□ HIGH/CRITICAL clause has a rewrite suggestion?
□ Contract id present?
□ Supplied rewrite differs by ≥ 20%?
```

## Review Journaling

Every reviewed clause MUST be logged via `review-db-mcp` with full context:
clause text, type, risk score, risk level, risky terms found, veto status,
rewrite suggestion, reasoning, and confidence. Mirrors `log_trade`.

## MCP Tools (review-db-mcp)

- `initialize_db()` — create tables (idempotent)
- `save_contract(...)` — store a contract record
- `validate_clause(...)` — **SAFETY-CRITICAL** 6-check validation
- `save_clause_review(...)` — store one review (validates first)
- `get_review_history(contractId?)` — past reviews
- `get_recent_runs()` — recent finalized review runs
- `get_contract_stats(contractId)` — aggregate stats
- `finalize_review(contractId)` — mark complete, compute overall score

## Scripts

- `scripts/validateClause.js` — reference copy of the 6-check validation
- `scripts/logReview.js` — shapes a review record for `save_clause_review`
