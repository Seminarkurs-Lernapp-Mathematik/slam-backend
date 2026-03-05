/**
 * repairJson.ts
 *
 * Fixes JSON strings that contain invalid escape sequences, which is a common
 * problem when AI models (especially Gemini) include LaTeX in JSON responses.
 *
 * Gemini often writes LaTeX commands like \frac, \sqrt, \int directly into
 * JSON string values without double-escaping the backslash. Valid JSON escapes
 * are only: \" \\ \/ \b \f \n \r \t \uXXXX — everything else is invalid.
 *
 * Example of the bug:
 *   Gemini outputs:  {"question": "Berechne $\sqrt{x}$"}
 *   Valid JSON needs: {"question": "Berechne $\\sqrt{x}$"}
 *
 * After JSON.parse, both produce the same JavaScript string "$\sqrt{x}$",
 * so the LaTeX still renders correctly after the repair.
 */

/**
 * Repairs invalid JSON escape sequences in a raw string before JSON.parse.
 * Finds any \x where x is not a valid JSON escape character and doubles
 * the backslash to make it valid.
 *
 * Valid single-char JSON escapes: " \ / b f n r t
 * Valid multi-char JSON escape:   uXXXX (4 hex digits)
 */
export function repairJsonEscapes(text: string): string {
  return text.replace(
    /\\(u[0-9a-fA-F]{4}|["\\/bfnrt]|u(?![0-9a-fA-F]{4})|[\s\S])/g,
    (match, captured) => {
      // Keep valid single-char escapes: \", \\, \/, \b, \f, \n, \r, \t
      if (captured.length === 1 && '"\\\/bfnrt'.includes(captured)) {
        return match;
      }
      // Keep valid unicode escapes: \uXXXX
      if (captured.length === 5 && captured.startsWith('u')) {
        return match;
      }
      // Fix invalid escape by doubling the backslash
      return '\\\\' + captured;
    }
  );
}

/**
 * Attempts to parse a JSON string, with automatic repair of invalid escapes
 * as a fallback. Throws if both attempts fail.
 */
export function parseJsonWithRepair(text: string): any {
  // First attempt: try raw parse (fastest path, works for Claude)
  try {
    return JSON.parse(text);
  } catch (_) {
    // Second attempt: repair invalid escape sequences then retry
    try {
      const repaired = repairJsonEscapes(text);
      return JSON.parse(repaired);
    } catch (err) {
      throw new Error(`Failed to parse JSON even after repair: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Extracts the first JSON object from a string (strips surrounding text /
 * markdown fences) and parses it with repair fallback.
 */
export function extractAndParseJson(text: string): any {
  // Try to extract JSON object or array
  const objectMatch = text.match(/\{[\s\S]*\}/);
  const arrayMatch = text.match(/\[[\s\S]*\]/);

  // Prefer the longer match (more complete JSON)
  let jsonStr: string;
  if (objectMatch && arrayMatch) {
    jsonStr = objectMatch[0].length >= arrayMatch[0].length ? objectMatch[0] : arrayMatch[0];
  } else {
    jsonStr = (objectMatch || arrayMatch)?.[0] || text;
  }

  return parseJsonWithRepair(jsonStr);
}
