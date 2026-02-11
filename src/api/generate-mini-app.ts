/**
 * Generate Mini App Endpoint
 * Generates a self-contained HTML app with inline CSS and JS using AI
 *
 * Features:
 * - Multi-provider support (Claude, Gemini)
 * - Generates standalone HTML files
 * - Extracts HTML, CSS, and JavaScript separately in response
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface GenerateMiniAppRequest {
  description: string;
  selectedModel?: string;
  apiKey?: string;
  provider?: 'claude' | 'gemini';
}

// ============================================================================
// MODEL ROUTER CONFIGURATION
// ============================================================================

const MODEL_TIERS = {
  claude: {
    light: 'claude-haiku-4-5-20251001',
    standard: 'claude-sonnet-4-5-20250929',
  },
  gemini: {
    light: 'gemini-3-flash-preview',
    standard: 'gemini-3-pro-preview',
  },
} as const;

const AI_ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function callAIProvider({
  provider,
  apiKey,
  model,
  prompt,
  temperature,
  maxTokens,
}: {
  provider: 'claude' | 'gemini';
  apiKey: string;
  model: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  switch (provider) {
    case 'claude': {
      const response = await fetch(AI_ENDPOINTS.claude, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Claude API error: ${JSON.stringify(error)}`);
      }

      const data: any = await response.json();
      return data.content[0].text;
    }

    case 'gemini': {
      const endpoint = `${AI_ENDPOINTS.gemini}/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
      }

      const data: any = await response.json();
      return data.candidates[0].content.parts[0].text;
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function buildMiniAppPrompt(description: string): string {
  return `Du bist ein erfahrener Web-Entwickler. Erstelle eine interaktive, eigenständige HTML-Anwendung basierend auf der folgenden Beschreibung:

BESCHREIBUNG: ${description}

ANFORDERUNGEN:
- Erstelle eine EINZIGE HTML-Datei, die komplett eigenständig funktioniert
- Alles CSS muss inline in einem <style>-Tag im <head> stehen
- Alles JavaScript muss inline in einem <script>-Tag stehen
- Keine externen Abhängigkeiten (keine CDN-Links, keine externen Bibliotheken)
- Die App soll visuell ansprechend sein mit modernem Design
- Responsive Design für verschiedene Bildschirmgrößen
- Verwende sinnvolle Farben und Animationen wo passend
- Die Benutzeroberfläche soll intuitiv und benutzerfreundlich sein
- Texte und Labels auf Deutsch

STRUKTUR:
Die Antwort MUSS ein JSON-Objekt sein mit genau diesen drei Feldern:
- "html": Der vollständige HTML-Code der Seite (das gesamte HTML-Dokument von <!DOCTYPE html> bis </html>)
- "css": NUR der CSS-Code (ohne <style>-Tags), extrahiert aus dem HTML
- "javascript": NUR der JavaScript-Code (ohne <script>-Tags), extrahiert aus dem HTML

WICHTIG: Antworte NUR mit einem JSON-Objekt (kein zusätzlicher Text, kein Markdown-Code-Block).

{
  "html": "<!DOCTYPE html>\\n<html>...</html>",
  "css": "body { ... }",
  "javascript": "function init() { ... }"
}`;
}

/**
 * Extract CSS from HTML string (content between <style> tags)
 */
function extractCSS(html: string): string {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  return styleMatch ? styleMatch[1].trim() : '';
}

/**
 * Extract JavaScript from HTML string (content between <script> tags)
 */
function extractJavaScript(html: string): string {
  const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  return scriptMatch ? scriptMatch[1].trim() : '';
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleGenerateMiniApp(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<GenerateMiniAppRequest>();

    // Validate required fields
    const { description, apiKey, selectedModel } = body;
    if (!description) {
      throw new APIError('Missing required field: description', 400);
    }

    if (!apiKey) {
      throw new APIError('Missing required field: apiKey', 400);
    }

    // Determine provider and model
    const provider = body.provider || 'claude';
    const model = selectedModel || MODEL_TIERS[provider]?.standard || MODEL_TIERS.claude.standard;

    console.log(`[generate-mini-app] Request: provider=${provider}, model=${model}, description="${description.substring(0, 80)}..."`);

    // Build prompt and call AI
    const prompt = buildMiniAppPrompt(description);

    const responseText = await callAIProvider({
      provider,
      apiKey,
      model,
      prompt,
      temperature: 0.7,
      maxTokens: 16000,
    });

    // Parse the AI response
    let result: { html: string; css: string; javascript: string };

    try {
      // Try to parse as JSON first
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        result = {
          html: parsed.html || '',
          css: parsed.css || '',
          javascript: parsed.javascript || parsed.js || '',
        };
      } else {
        throw new Error('No JSON object found in response');
      }
    } catch (parseError) {
      // Fallback: treat the entire response as HTML and extract parts
      console.warn('[generate-mini-app] JSON parse failed, attempting HTML extraction');

      // Check if response contains raw HTML (common when AI ignores JSON instruction)
      const htmlMatch = responseText.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
      const rawHtml = htmlMatch ? htmlMatch[0] : responseText;

      result = {
        html: rawHtml,
        css: extractCSS(rawHtml),
        javascript: extractJavaScript(rawHtml),
      };
    }

    // If CSS or JS are empty but HTML contains them, extract from HTML
    if (!result.css && result.html) {
      result.css = extractCSS(result.html);
    }
    if (!result.javascript && result.html) {
      result.javascript = extractJavaScript(result.html);
    }

    // Validate that we got meaningful HTML
    if (!result.html || result.html.length < 50) {
      throw new APIError('AI response did not contain valid HTML content', 500);
    }

    console.log(`[generate-mini-app] Success: HTML=${result.html.length} chars, CSS=${result.css.length} chars, JS=${result.javascript.length} chars`);

    return c.json({
      success: true,
      html: result.html,
      css: result.css,
      javascript: result.javascript,
    });
  } catch (error) {
    console.error('[generate-mini-app] Error:', error);

    if (error instanceof APIError) {
      return c.json({ success: false, error: error.message }, error.statusCode as any);
    }

    return c.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500 as any
    );
  }
}
