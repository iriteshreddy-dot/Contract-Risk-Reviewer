/**
 * Clause-review journaling — format a review entry.
 * Mirrors log_trade.py: the actual persistence goes through the
 * review-db-mcp `save_clause_review` tool. This helper just shapes the record.
 *
 * Every reviewed clause MUST be logged with full reasoning context, exactly as
 * the trading agent logs every trade.
 */

import { nowISO, genId } from '../../../../mcp-servers/shared/index.js';

/**
 * Shape a clause review into the record expected by save_clause_review.
 *
 * @param {object} r
 * @returns {object} review record
 */
export function formatReviewEntry(r) {
  return {
    id: r.id || genId('CR'),
    contractId: r.contractId,
    clauseText: r.clauseText,
    clauseType: r.clauseType || 'OTHER',
    position: r.position,
    riskScore: r.riskScore,
    riskLevel: r.riskLevel,
    riskyTermsFound: r.riskyTermsFound || [],
    vetoActive: Boolean(r.vetoActive),
    rewriteSuggestion: r.rewriteSuggestion || null,
    reasoning: r.reasoning || '',
    confidence: r.confidence || 'LOW',
    createdAt: nowISO(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(formatReviewEntry({
    contractId: 'C1',
    clauseText: 'Sample clause text for journaling.',
    clauseType: 'LIABILITY',
    position: 3,
    riskScore: 88,
    riskLevel: 'CRITICAL',
    riskyTermsFound: ['unlimited liability'],
    vetoActive: true,
    rewriteSuggestion: 'A capped, mutual liability clause.',
    reasoning: 'Veto term present; uncapped exposure.',
    confidence: 'HIGH',
  }), null, 2));
}
