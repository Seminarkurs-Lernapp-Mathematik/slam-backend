/**
 * repairJson.ts
 *
 * Fixes common problems in AI-generated JSON before passing to JSON.parse:
 *
 * 1. TRAILING COMMAS – Gemini often writes trailing commas in arrays/objects:
 *    ["a", "b",] → ["a", "b"]  (standard JSON forbids trailing commas)
 *
 * 2. INVALID BACKSLASH ESCAPES – JSON only allows: \" \\ \/ \b \f \n \r \t \uXXXX
 *    Gemini writes LaTeX like \sqrt, \int, \alpha → "Bad escaped character"
 *    Fix: double the backslash so \s → \\s (JSON.parse gives back \s for LaTeX)
 *
 * 3. VALID-BUT-MISUSED ESCAPES – \f \b \n \r \t are valid JSON escapes but
 *    Gemini uses them as LaTeX: \frac, \begin, \nabla…  After JSON.parse,
 *    \f becomes a form-feed character (U+000C) instead of the LaTeX command.
 *    Fix: when these appear before an alphabetic char, double the backslash.
 */

/**
 * Remove trailing commas inside JSON arrays and objects.
 * Handles nested structures correctly by only removing commas
 * immediately before ] or }.
 */
function removeTrailingCommas(text: string): string {
  // Remove comma(s) followed only by whitespace before ] or }
  return text.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Repairs raw AI response text so it can be parsed with JSON.parse.
 * Call this BEFORE JSON.parse.
 */
export function repairJsonEscapes(text: string): string {
  let result = text;

  // ─── Pass 1: Fix unambiguously invalid JSON escape sequences ──────────────
  result = result.replace(
    /\\(u[0-9a-fA-F]{4}|["\\/bfnrt]|u(?![0-9a-fA-F]{4})|[\s\S])/g,
    (match, captured) => {
      if (/^u[0-9a-fA-F]{4}$/.test(captured)) return match; // valid \uXXXX
      if (captured.length === 1 && '"\\\/bfnrt'.includes(captured)) return match; // valid single-char
      return '\\\\' + captured; // fix invalid escape
    }
  );

  // ─── Pass 2: Fix valid-but-misused escapes used as LaTeX commands ──────────
  // Only applies when the escape is followed directly by an alphabetic char
  // (indicating a LaTeX command like \frac, \begin, \text, \nabla, \rho…).
  // Guard prevents double-fixing already-escaped sequences (\\f etc.).
  const latexLeaders = ['f', 'b', 't', 'n', 'r'] as const;
  for (const ch of latexLeaders) {
    result = result.replace(
      new RegExp(`(^|[^\\\\])(\\\\${ch})(?=[a-zA-Z])`, 'g'),
      (_, pre, esc) => pre + '\\' + esc
    );
  }

  return result;
}

/**
 * Parses a JSON string with full repair pipeline applied unconditionally:
 *   1. Remove trailing commas
 *   2. Fix invalid/misused backslash escapes
 *   3. JSON.parse
 *
 * IMPORTANT: repair must run BEFORE JSON.parse, not as a fallback.
 * Sequences like \frac are "successfully" parsed by JSON.parse as a form-feed
 * character + "rac" — no error thrown, but the data is silently corrupted.
 */
export function parseJsonWithRepair(text: string): any {
  try {
    const repaired = repairJsonEscapes(removeTrailingCommas(text));
    return JSON.parse(repaired);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Extracts the first JSON object from a string (strips surrounding prose /
 * markdown fences) and parses it with the full repair pipeline.
 */
export function extractAndParseJson(text: string): any {
  const objectMatch = text.match(/\{[\s\S]*\}/);
  const candidate = objectMatch ? objectMatch[0] : text;
  return parseJsonWithRepair(candidate);
}
