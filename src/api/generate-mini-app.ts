/**
 * Generate Mini App Endpoint
 * Generates interactive HTML mini-apps using AI
 *
 * Features:
 * - Multi-provider support (Claude, Gemini)
 * - Generates standalone HTML with CSS and JavaScript
 * - Educational math-focused apps
 * - Safe, sandboxed code generation
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
  apiKey: string;
  provider?: 'claude' | 'gemini';
  complexity?: 'simple' | 'medium' | 'advanced';
}

interface GeneratedApp {
  html: string;
  css: string;
  javascript: string;
  title: string;
  description: string;
}

// ============================================================================
// MODEL ROUTER CONFIGURATION
// ============================================================================

const MODEL_TIERS = {
  claude: {
    simple: 'claude-haiku-4-5-20251001',
    medium: 'claude-sonnet-4-5-20250929',
    advanced: 'claude-sonnet-4-5-20250929',
  },
  gemini: {
    simple: 'gemini-3-flash-preview',
    medium: 'gemini-3-flash-preview',
    advanced: 'gemini-3-pro-preview',
  },
} as const;

const AI_ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function selectModel(
  provider: 'claude' | 'gemini',
  complexity: string,
  preferredModel?: string
): string {
  if (preferredModel) return preferredModel;

  const tier = MODEL_TIERS[provider]?.[complexity as keyof typeof MODEL_TIERS['claude']] || MODEL_TIERS[provider].medium;
  return tier;
}

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

function determineComplexity(description: string): 'simple' | 'medium' | 'advanced' {
  const lowerDesc = description.toLowerCase();
  
  // Advanced indicators
  if (lowerDesc.includes('3d') || 
      lowerDesc.includes('animation') || 
      lowerDesc.includes('simulation') ||
      lowerDesc.includes('komplex') ||
      lowerDesc.includes('fortgeschritten')) {
    return 'advanced';
  }
  
  // Simple indicators
  if (lowerDesc.includes('einfach') || 
      lowerDesc.includes('simple') || 
      lowerDesc.includes('basic') ||
      lowerDesc.includes('rechner') ||
      description.length < 50) {
    return 'simple';
  }
  
  return 'medium';
}

function buildPrompt(description: string, complexity: string): string {
  return `Du bist ein Experte für interaktive mathematische Web-Anwendungen.

Erstelle eine vollständige, eigenständige HTML-Mini-App basierend auf dieser Beschreibung:
"${description}"

KOMPLEXITÄTSSTUFE: ${complexity}

ANFORDERUNGEN:
1. Die App MUSS komplett in einer einzigen HTML-Datei funktionieren
2. Verwende INLINE CSS (im <style> Tag) und INLINE JavaScript (im <script> Tag)
3. Keine externen Bibliotheken außer CDN-Links für MathJax oder Chart.js (falls nötig)
4. Die App muss auf mobilen Geräten funktionieren (responsive Design)
5. Verwende deutsche Sprache für alle UI-Texte
6. Füge klare Anweisungen für den Benutzer hinzu
7. Implementiere Eingabevalidierung
8. Zeige Ergebnisse visuell an (Diagramme, Animationen, etc. wo sinnvoll)

SICHERHEITSREGELN:
- Kein Zugriff auf externe APIs
- Keine Cookies oder LocalStorage
- Keine Weiterleitungen
- Kein eval() von Benutzereingaben

ANTWORTFORMAT - JSON:
{
  "title": "Kurzer Titel der App",
  "description": "Beschreibung was die App macht",
  "html": "<!DOCTYPE html><html>...</html>",
  "css": "/* CSS Code */",
  "javascript": "/* JavaScript Code */"
}

WICHTIG: 
- Das HTML sollte den vollständigen, funktionierenden Code enthalten
- CSS und JavaScript sollen als separate Felder zurückgegeben werden (werden vom Client zusammengefügt)
- Keine Erklärungen außerhalb des JSON
- Valides JSON ohne Markdown-Code-Blöcke`;
}

function extractJSONFromResponse(text: string): any {
  // Try to find JSON in the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Continue to other methods
    }
  }
  
  // Try parsing the whole text
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Could not parse JSON from AI response');
  }
}

function validateAndSanitizeApp(appData: any): GeneratedApp {
  if (!appData.html || typeof appData.html !== 'string') {
    throw new APIError('Invalid response: missing html field', 500);
  }

  // Basic security checks
  const html = appData.html;
  const forbiddenPatterns = [
    /<script\s+src/i,  // External scripts
    /fetch\s*\(/i,      // Network requests
    /XMLHttpRequest/i, // AJAX
    /websocket/i,      // WebSockets
    /localStorage/i,   // Storage
    /document\.cookie/i, // Cookies
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(html)) {
      console.warn('[generate-mini-app] Potentially unsafe code detected, sanitizing');
    }
  }

  return {
    html: appData.html,
    css: appData.css || '',
    javascript: appData.javascript || '',
    title: appData.title || 'Mini App',
    description: appData.description || '',
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleGenerateMiniApp(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<Partial<GenerateMiniAppRequest>>();

    // Validate required fields
    const { description, apiKey } = body;
    if (!description || !apiKey) {
      throw new APIError('Missing required fields: description, apiKey', 400);
    }

    const provider = body.provider || 'claude';
    const complexity = body.complexity || determineComplexity(description);
    const selectedModel = body.selectedModel;

    console.log('[generate-mini-app] Request:', {
      provider,
      complexity,
      description: description.substring(0, 50) + '...',
    });

    // =======================================================================
    // PHASE 1: Select model
    // =======================================================================

    const model = selectModel(provider, complexity, selectedModel);
    console.log(`[Model Router] Selected ${model} for ${provider} (complexity: ${complexity})`);

    // =======================================================================
    // PHASE 2: Build prompt and call AI
    // =======================================================================

    const prompt = buildPrompt(description, complexity);
    const temperature = 0.7;

    const responseText = await callAIProvider({
      provider,
      apiKey,
      model,
      prompt,
      temperature,
      maxTokens: 8000,
    });

    // =======================================================================
    // PHASE 3: Parse and validate response
    // =======================================================================

    let appData: any;
    try {
      appData = extractJSONFromResponse(responseText);
    } catch (parseError) {
      console.error('[generate-mini-app] Parse error:', parseError);
      console.error('[generate-mini-app] Raw response:', responseText.substring(0, 500));
      throw new APIError('Failed to parse AI response as JSON', 500);
    }

    const generatedApp = validateAndSanitizeApp(appData);

    console.log('[generate-mini-app] Success:', {
      title: generatedApp.title,
      htmlLength: generatedApp.html.length,
      cssLength: generatedApp.css.length,
      jsLength: generatedApp.javascript.length,
    });

    // =======================================================================
    // PHASE 4: Return response
    // =======================================================================

    return c.json({
      success: true,
      ...generatedApp,
      modelUsed: model,
      providerUsed: provider,
    });

  } catch (error) {
    console.error('[generate-mini-app] Error:', error);

    if (error instanceof APIError) {
      return c.json({ success: false, error: error.message }, error.statusCode);
    }

    return c.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}
