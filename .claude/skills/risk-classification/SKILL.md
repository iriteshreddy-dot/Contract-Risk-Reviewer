---
name: risk-classification
description: Score contract clauses for legal risk. Use this skill when a clause needs a 0-100 risk score, when risky terms must be flagged, or when structural risk patterns must be detected. Used by the Classifier agent. Trigger whenever clause risk must be assessed.
---

# Risk Classification Skill — Clause Risk Scoring

## Overview

This skill scores each clause for legal risk on a 0–100 scale by combining
keyword-based risk signals with structural drafting patterns and an optional
LLM nuance pass.

## Composite Risk Score (0–100)

`scoreClauseRisk` accrues risk points across six categories, each with a
contribution cap:

| Category       | Cap |
|----------------|-----|
| liability      | 25  |
| indemnity      | 20  |
| ip_rights      | 20  |
| termination    | 15  |
| governing_law  | 10  |
| payment        | 10  |

The raw category total is normalized against a realistic single-clause
ceiling (a real clause touches only 1–2 categories), then structural-pattern
and LLM adjustments are applied.

## Risk Levels

| Score   | Level    | Meaning                                      |
|---------|----------|----------------------------------------------|
| 0–35    | LOW      | Standard clause, acceptable                  |
| 36–64   | MEDIUM   | Worth reviewing, suggest minor tweaks        |
| 65–84   | HIGH     | Needs a rewrite                              |
| 85–100  | CRITICAL | Remove or heavily renegotiate                |

## VETO Terms

VETO terms (e.g. *unlimited liability*, *perpetual irrevocable*, *unilateral
amendment*) escalate a clause automatically:

- **One** veto term → the clause is forced to at least **HIGH**.
- **Two or more** veto terms → the clause is forced to **CRITICAL**.

## Keyword Scan First, LLM Only When Ambiguous

`flagRiskyTerms` keyword-scans a clause for free. The LLM is consulted
**only** when the resulting confidence is `LOW` (the ambiguous 45–64 band)
— never as the first move.

`detectPatterns` adds structural penalties for risk that single keywords
miss: unilateral-change rights, sole discretion, no-notice action, perpetual
obligations, one-sided drafting.

## Scripts

- `scripts/scoreClauseRisk.js` — composite risk scoring
- `scripts/flagRiskyTerms.js`  — risky / standard / veto keyword scan
- `scripts/detectPatterns.js`  — structural risk-pattern detection
