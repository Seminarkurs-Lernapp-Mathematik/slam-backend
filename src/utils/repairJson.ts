/**
 * repairJson.ts
 *
 * Fixes JSON strings that contain invalid or misused escape sequences.
 * This is a common problem when AI models (especially Gemini) include LaTeX
 * in JSON responses without properly escaping backslashes.
 *
 * Two classes of problems:
 *
 * 1. INVALID escapes – JSON only allows: \" \\ \/ \b \f \n \r \t \uXXXX
 *    Gemini writes: \sqrt, \int, \sum, \alpha, etc. → "Bad escaped character"
 *    Fix: double the backslash so \s → \\s (which JSON.parse gives back as \s)
 *
 * 2. VALID-BUT-MISUSED escapes – \f \b \t \n \r are valid JSON escapes, but
 *    Gemini uses them as the start of LaTeX commands: \frac, \begin, \text...
 *    After JSON.parse, \f becomes a form feed character (U+000C), not \frac.
 *    Fix: when \f \b \t \n \r are followed by alphabetic chars (→ LaTeX cmd),
 *    double the backslash before JSON.parse.
 */

/**
 * Repairs raw AI response text so it can be parsed with JSON.parse.
 * Call this BEFORE JSON.parse.
 */
export function repairJsonEscapes(text: string): string {
  let result = text;

  // ─── Pass 1: Fix unambiguously invalid JSON escape sequences ──────────────
  // Valid single-char JSON escapes: " \ / b f n r t
  // Valid multi-char: \uXXXX
  // Everything else (e.g. \s, \a, \c, \{, \(, uppercase letters, …) is invalid.
  result = result.replace(
    /\\(u[0-9a-fA-F]{4}|["\\/bfnrt]|u(?![0-9a-fA-F]{4})|[\s\S])/g,
    (match, captured) => {
      // Keep valid \uXXXX
      if (/^u[0-9a-fA-F]{4}$/.test(captured)) return match;
      // Keep valid single-char escapes
      if (captured.length === 1 && '"\\\/bfnrt'.includes(captured)) return match;
      // Fix everything else
      return '\\\\' + captured;
    }
  );

  // ─── Pass 2: Fix valid-but-misused escapes that are actually LaTeX ─────────
  // \f \b \t \n \r followed by an alphabetic character almost certainly means
  // a LaTeX command (\frac, \begin, \text, \nabla, \rho, …) was written with a
  // single backslash in the JSON. We double the backslash so JSON.parse gives
  // back the single backslash that LaTeX needs.
  //
  // Guard: don't touch an already-doubled backslash sequence (\\f…).
  // The lookbehind alternative via negative group: (^|[^\\]) before the match.
  // Replacement keeps group-1 (the char before the backslash) and doubles \.
  const latexLeaders = ['f', 'b', 't', 'n', 'r'] as const;
  for (const ch of latexLeaders) {
    // Match: (start-of-string OR non-backslash char) + \ch + alphabetic char (lookahead)
    // The first group preserves the character before the backslash.
    result = result.replace(
      new RegExp(`(^|[^\\\\])(\\\\${ch})(?=[a-zA-Z])`, 'g'),
      (_, pre, esc) => pre + '\\' + esc  // double the backslash: \ch → \\ch
    );
  }

  return result;
}

/**
 * Attempts to parse a JSON string, with automatic repair of LaTeX escape
 * issues as a fallback. Throws if both attempts fail.
 */
export function parseJsonWithRepair(text: string): any {
  // Fast path: direct parse (always works for Claude)
  try {
    return JSON.parse(text);
  } catch (_) {
    // Slow path: repair then retry
    try {
      return JSON.parse(repairJsonEscapes(text));
    } catch (err) {
      throw new Error(
        `Failed to parse JSON even after repair: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * Extracts the first JSON object from a string (strips surrounding prose /
 * markdown fences) and parses it with repair fallback.
 */
export function extractAndParseJson(text: string): any {
  const objectMatch = text.match(/\{[\s\S]*\}/);
  const candidate = objectMatch ? objectMatch[0] : text;
  return parseJsonWithRepair(candidate);
}
