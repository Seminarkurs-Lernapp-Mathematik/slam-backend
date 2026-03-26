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
 * Attempts to recover a truncated {"questions":[...]} JSON by finding the
 * last complete question object (depth transitions 2→1) and closing the
 * array + root object.  Returns null if no complete question was found.
 */
function recoverTruncatedQuestionsJson(text: string): string | null {
  let depth = 0;
  let lastQuestionEnd = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      // A closing `}` at depth 1 means we just closed a top-level array element
      if (ch === '}' && depth === 1) {
        lastQuestionEnd = i;
      }
    }
  }

  if (lastQuestionEnd === -1) return null;

  // Take everything through the last complete question, strip trailing comma,
  // then close the questions array and root object.
  const partial = text.substring(0, lastQuestionEnd + 1).trimEnd().replace(/,\s*$/, '');
  return partial + ']}';
}

/**
 * Extracts the first JSON object from a string (strips surrounding prose /
 * markdown fences) and parses it with the full repair pipeline.
 * Falls back to truncation recovery when the response was cut off by a
 * token limit mid-array.
 */
export function extractAndParseJson(text: string): any {
  const objectMatch = text.match(/\{[\s\S]*\}/);
  const candidate = objectMatch ? objectMatch[0] : text;

  try {
    return parseJsonWithRepair(candidate);
  } catch (firstError) {
    // The response may have been truncated by the model's token limit.
    // Try to salvage whatever complete questions were generated.
    const recovered = recoverTruncatedQuestionsJson(candidate);
    if (recovered !== null) {
      try {
        const result = parseJsonWithRepair(recovered);
        console.warn(
          `[repairJson] Recovered truncated JSON — salvaged ${result?.questions?.length ?? 0} questions`
        );
        return result;
      } catch {
        // Recovery also failed — fall through to throw the original error
      }
    }
    throw firstError;
  }
}
