/**
 * Identify the type of a contract clause via keyword scoring.
 * Mirrors identify_clause_type — cheap heuristic classification, no LLM.
 *
 * Returns the best-matching CLAUSE_TYPE plus a 0-1 confidence. Low confidence
 * is the signal for the parser/agent to escalate to the LLM.
 */

const TYPE_KEYWORDS = {
  LIABILITY: [
    'liability', 'liable', 'damages', 'limitation of liability',
    'consequential', 'indirect damages', 'cap on damages',
  ],
  INDEMNITY: [
    'indemnify', 'indemnification', 'hold harmless', 'defend',
    'indemnitee', 'indemnitor',
  ],
  IP: [
    'intellectual property', 'copyright', 'patent', 'trademark',
    'work product', 'work made for hire', 'ownership of', 'license', 'licence',
    'moral rights', 'inventions',
  ],
  TERMINATION: [
    'terminate', 'termination', 'expire', 'expiration', 'term of this',
    'renewal', 'notice period', 'cure period', 'for cause',
  ],
  PAYMENT: [
    'payment', 'fees', 'invoice', 'compensation', 'pay', 'price',
    'net 30', 'late fee', 'refund', 'reimburse',
  ],
  CONFIDENTIALITY: [
    'confidential', 'confidentiality', 'non-disclosure', 'proprietary information',
    'trade secret', 'receiving party', 'disclosing party',
  ],
  GOVERNING_LAW: [
    'governing law', 'jurisdiction', 'venue', 'arbitration', 'dispute resolution',
    'governed by', 'courts of', 'jury trial',
  ],
};

/**
 * @param {string} clauseText
 * @returns {{type:string, confidence:number, scores:object}}
 */
export function identifyClauseType(clauseText) {
  const text = String(clauseText || '').toLowerCase();
  const scores = {};
  let total = 0;

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += kw.includes(' ') ? 2 : 1; // phrases weigh more
    }
    scores[type] = score;
    total += score;
  }

  if (total === 0) {
    return { type: 'OTHER', confidence: 0.3, scores };
  }

  let bestType = 'OTHER';
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // Confidence = share of total signal captured by the winner.
  const confidence = Math.min(0.95, Math.max(0.3, bestScore / total));
  return { type: bestType, confidence: Number(confidence.toFixed(2)), scores };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(
    JSON.stringify(
      identifyClauseType('The Contractor shall indemnify and hold harmless the Company.'),
      null,
      2,
    ),
  );
}
