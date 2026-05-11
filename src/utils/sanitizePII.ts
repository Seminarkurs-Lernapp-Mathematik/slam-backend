/**
 * PII sanitization for AI prompts.
 *
 * Strips personal identifiable information from user-supplied free-text
 * before it is embedded in AI prompts.  Mathematical content (numbers,
 * operators, LaTeX) is preserved — only human-identifiable patterns are
 * replaced with neutral placeholders.
 */

type PIIRule = { pattern: RegExp; replacement: string };

const PII_RULES: PIIRule[] = [
  // Email addresses
  {
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[E-Mail]',
  },
  // German / international phone numbers
  {
    pattern: /(?:\+49|0049|0)[1-9][0-9\s\-\/]{6,14}[0-9]/g,
    replacement: '[Telefonnummer]',
  },
  // Generic international phone-like strings (7–15 consecutive digits / separators)
  {
    pattern: /\b(?:\+\d{1,3}[\s\-]?)?\(?\d{3,5}\)?[\s\-]?\d{3,5}[\s\-]?\d{2,5}\b/g,
    replacement: '[Telefonnummer]',
  },
];

/**
 * Replace recognizable PII patterns in `text` with neutral placeholders.
 * Returns the sanitized string; if `text` is falsy, returns it unchanged.
 */
export function sanitizePII(text: string | undefined | null): string {
  if (!text) return text ?? '';
  let result = text;
  for (const { pattern, replacement } of PII_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
