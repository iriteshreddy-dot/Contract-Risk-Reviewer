---
name: risk-classification
description: Score contract clauses for legal risk. Use this skill when a clause needs a 0-100 risk score, when risky terms must be flagged, or when structural risk patterns must be detected. Used by the Classifier agent. Trigger whenever clause risk must be assessed.
---

# Risk Classification Skill — Clause Risk Scoring

## Overview

This skill scores each clause for legal risk on a 0–100 scale. It is the
legal-domain port of the trading agent's `technical-analysis` skill: where that
skill turned indicators into a composite signal, this one turns legal risk
sub-signals into a composite risk score.

## Composite Risk Score (0–100)

`scoreClauseRisk` mirrors `compute_composite_score()`. Each clause accrues
risk points across six categories, each with a contribution cap:

| Category       | Cap | Mirrors           |
|----------------|-----|-------------------|
| liability      | 25  | MACD (±25)        |
| indemnity      | 20  | RSI (±20)         |
| ip_rights      | 20  | EMA trend (±15)   |
| termination    | 15  | Bollinger (±10)   |
| governing_law  | 10  | Volume (±10)      |
| payment        | 10  | —                 |

The raw category total is normalized against a realistic single-clause ceiling
(a real clause touches only 1–2 categories), then structural-pattern and LLM
adjustments are applied.

## Risk Levels

| Score   | Level    | Meaning                                      |
|---------|----------|----------------------------------------------|
| 0–35    | LOW      | Standard clause, acceptable                  |
| 36–64   | MEDIUM   | Worth reviewing, suggest minor tweaks        |
| 65–84   | HIGH     | Needs a rewrite                              |
| 85–100  | CRITICAL | Remove or heavily renegotiate                |

## VETO Terms

VETO terms (e.g. *unlimited liability*, *perpetual irrevocable*, *unilateral
amendment*) mirror the trading agent's `RED_FLAGS`:

- **One** veto term → the clause is forced to at least **HIGH**.
- **Two or more** veto terms → the clause is forced to **CRITICAL**.

## Keyword Scan First, LLM Only When Ambiguous

Mirror the cost discipline of the trading agent: `flagRiskyTerms` keyword-scans
a clause for free. The LLM is consulted **only** when the resulting confidence
is `LOW` (the ambiguous 45–64 band) — never as the first move.

`detectPatterns` adds structural penalties for risk that single keywords miss:
unilateral-change rights, sole discretion, no-notice action, perpetual
obligations, one-sided drafting.

## Scripts

- `scripts/scoreClauseRisk.js` — composite risk scoring (≈ score_signal_strength)
- `scripts/flagRiskyTerms.js`  — risky / standard / veto keyword scan (≈ score_sentiment)
- `scripts/detectPatterns.js`  — structural risk-pattern detection (≈ detect_patterns)
