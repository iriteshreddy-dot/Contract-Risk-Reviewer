/**
 * Splitter Agent.
 *
 * Job: turn raw contract input into a structured clause list. Calls the
 * contract-parser-mcp tools and leans on heuristics first — cheap, fast,
 * and good enough for most contracts before the LLM is consulted.
 *
 * The Splitter NEVER scores risk — it only parses and structures.
 */

export const splitter = {
  /**
   * @param {object} parser  contract-parser-mcp client
   * @param {object} input   { text, contractName }
   * @returns {Promise<object>} { contractId, contractName, rawText, wordCount, clauses }
   */
  async run(parser, { text, contractName }) {
    const parsed = await parser.call('parse_contract', { text, contractName });
    if (parsed.status !== 'success') {
      throw new Error(`Splitter: parse_contract failed — ${parsed.message}`);
    }

    const split = await parser.call('split_into_clauses', {
      contractId: parsed.contractId,
      rawText: parsed.rawText,
    });
    if (split.status !== 'success') {
      throw new Error(`Splitter: split_into_clauses failed — ${split.message}`);
    }

    return {
      contractId: parsed.contractId,
      contractName: parsed.contractName,
      rawText: parsed.rawText,
      wordCount: parsed.wordCount,
      clauses: split.clauses,
    };
  },
};
