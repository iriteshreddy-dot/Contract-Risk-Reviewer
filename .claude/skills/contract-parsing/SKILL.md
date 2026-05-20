---
name: contract-parsing
description: Parse contracts and split them into individual clauses. Use this skill when a contract needs to be turned into structured clause data — parsing raw text or PDF, splitting on numbered sections and headings, and identifying clause types. Used by the Splitter agent. Trigger whenever contract input must be structured before risk analysis.
---

# Contract Parsing Skill — Input Layer

## Overview

This skill turns raw contract input into a structured clause list. It is the
legal-domain equivalent of the trading agent's `market-data` skill — the
front door through which all data enters the system.

## Splitting Strategy — Heuristics First

Mirror the batch-first discipline of `get_watchlist_quotes()`: cheap heuristics
run FIRST, the LLM is only a fallback. Clause boundaries are detected, in
priority order, by:

1. **Numbered sections** — `1.`, `1.1`, `12.`
2. **Named sections** — `ARTICLE IV`, `SECTION 3`, `CLAUSE 2`
3. **Recital markers** — `WHEREAS`, `NOW, THEREFORE`
4. **All-caps headings** — `LIMITATION OF LIABILITY`
5. **Fallback** — blank-line paragraph breaks (unstructured documents)

Fragments shorter than the minimum clause length are merged into the previous
clause so a bare heading line never becomes a standalone clause.

## Clause Types

`LIABILITY · INDEMNITY · IP · TERMINATION · PAYMENT · CONFIDENTIALITY ·
GOVERNING_LAW · OTHER`

`identifyClauseType` scores a clause against per-type keyword sets and returns
the best match plus a 0–1 confidence. **Low confidence is the signal to escalate
to the LLM** — do not guess.

## MCP Tools (contract-parser-mcp)

- `parse_contract({ text?, filePath?, contractName })` → contract object
- `split_into_clauses({ contractId, rawText })` → typed clause list
- `identify_clause_type({ clauseText })` → `{ type, confidence }`
- `get_clause_types()` → catalogue of clause types

## Scripts

- `scripts/splitIntoClauses.js` — heuristic clause splitter
- `scripts/identifyClauseType.js` — keyword-based type classifier
