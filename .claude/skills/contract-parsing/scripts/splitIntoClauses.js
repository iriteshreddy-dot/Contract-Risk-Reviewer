/**
 * Split raw contract text into individual clauses.
 * Mirrors the batch-first design of get_watchlist_quotes() — cheap heuristics
 * run FIRST; the LLM is only a fallback for genuinely ambiguous documents.
 *
 * Heuristics, in priority order:
 *   1. Numbered sections   — "1.", "1.1", "12."
 *   2. Named sections      — "ARTICLE IV", "SECTION 3", "CLAUSE 2"
 *   3. Recital markers     — "WHEREAS", "NOW, THEREFORE"
 *   4. All-caps headings   — "CONFIDENTIALITY"
 *   5. Fallback            — blank-line paragraph breaks
 */

const MIN_CLAUSE_CHARS = 25;

// A line that starts a brand-new clause.
const CLAUSE_START =
  /^\s*(?:\d+(?:\.\d+)*\.?\s+|\(?[a-z]\)\s+|(?:ARTICLE|SECTION|CLAUSE)\s+[\dIVXLC]+|WHEREAS\b|NOW,?\s+THEREFORE\b)/i;

// A standalone ALL-CAPS heading line (e.g. "LIMITATION OF LIABILITY").
const CAPS_HEADING = /^\s*[A-Z][A-Z0-9 ,&'\-/]{3,60}\s*$/;

function isClauseStart(line) {
  return CLAUSE_START.test(line) || CAPS_HEADING.test(line);
}

/**
 * @param {string} rawText
 * @returns {Array<{text:string, position:number}>}
 */
export function splitIntoClauses(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const structured = lines.some((l) => isClauseStart(l));

  let blocks = [];

  if (structured) {
    let current = [];
    for (const line of lines) {
      if (isClauseStart(line) && current.join('').trim()) {
        blocks.push(current.join('\n').trim());
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.join('').trim()) blocks.push(current.join('\n').trim());
  } else {
    // Unstructured document — fall back to paragraph breaks.
    blocks = text.split(/\n\s*\n+/).map((b) => b.trim());
  }

  // Merge fragments shorter than the minimum into the previous block:
  // a bare "1." heading line on its own should not be a standalone clause.
  const merged = [];
  for (const block of blocks) {
    if (!block) continue;
    if (block.length < MIN_CLAUSE_CHARS && merged.length > 0) {
      merged[merged.length - 1] += '\n' + block;
    } else {
      merged.push(block);
    }
  }

  return merged
    .filter((b) => b.length >= MIN_CLAUSE_CHARS)
    .map((text, i) => ({ text: text.replace(/\s+\n/g, '\n').trim(), position: i + 1 }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sample =
    '1. CONFIDENTIALITY\nThe Receiving Party shall keep information secret.\n' +
    '2. TERM\nThis Agreement lasts two years.';
  console.log(JSON.stringify(splitIntoClauses(sample), null, 2));
}
