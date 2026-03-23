/**
 * Generate Mini App Endpoint
 * Generates interactive HTML mini-apps using AI
 *
 * Features:
 * - Backend-managed AI configuration
 * - Generates standalone HTML with CSS and JavaScript
 * - Educational math-focused apps
 * - Safe, sandboxed code generation
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';
import { parseJsonWithRepair } from '../utils/repairJson';
import { callAI, getTaskModelConfig } from '../utils/callAI';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface GenerateMiniAppRequest {
  description: string;
}

interface GeneratedApp {
  html: string;
  css: string;
  javascript: string;
  title: string;
  description: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : text;
  return parseJsonWithRepair(candidate);
}

function validateAndSanitizeApp(appData: any): GeneratedApp {
  if (!appData.html || typeof appData.html !== 'string') {
    throw new APIError('Invalid response: missing html field', 500);
  }

  // Security: sanitize forbidden patterns from the generated HTML
  let html: string = appData.html;
  const forbiddenPatterns: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /<script\s+src[^>]*>[\s\S]*?<\/script>/gi, replacement: '<!-- external script removed -->' },
    { pattern: /\bfetch\s*\(/gi, replacement: '/* fetch blocked */(' },
    { pattern: /XMLHttpRequest/gi, replacement: '/* XHR blocked */' },
    { pattern: /\bWebSocket\b/gi, replacement: '/* WebSocket blocked */' },
    { pattern: /localStorage/gi, replacement: '/* localStorage blocked */' },
    { pattern: /sessionStorage/gi, replacement: '/* sessionStorage blocked */' },
    { pattern: /document\.cookie/gi, replacement: '/* cookie access blocked */' },
    { pattern: /\beval\s*\(/gi, replacement: '/* eval blocked */(' },
    { pattern: /window\.open\s*\(/gi, replacement: '/* window.open blocked */(' },
    { pattern: /window\.location/gi, replacement: '/* redirect blocked */' },
  ];

  for (const { pattern, replacement } of forbiddenPatterns) {
    if (pattern.test(html)) {
      console.warn(`[generate-mini-app] Sanitizing unsafe pattern: ${pattern.source}`);
      html = html.replace(pattern, replacement);
    }
  }

  return {
    html,
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
    const { description } = body;
    if (!description) {
      throw new APIError('Missing required field: description', 400);
    }

    const complexity = determineComplexity(description);

    console.log('[generate-mini-app] Request:', {
      complexity,
      description: description.substring(0, 50) + '...',
    });

    // =======================================================================
    // PHASE 1: Get task model configuration
    // =======================================================================

    const taskConfig = await getTaskModelConfig('generateMiniApp');
    console.log(`[Model Router] Using model ${taskConfig.model} from task config`);

    // =======================================================================
    // PHASE 2: Build prompt and call AI
    // =======================================================================

    const prompt = buildPrompt(description, complexity);

    const responseText = await callAI({
      provider: taskConfig.provider,
      model: taskConfig.model,
      prompt,
      temperature: taskConfig.temperature,
      maxTokens: taskConfig.maxTokens,
      systemPrompt: taskConfig.systemPrompt,
      env: c.env,
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
      modelUsed: taskConfig.model,
      providerUsed: taskConfig.provider,
    });

  } catch (error) {
    console.error('[generate-mini-app] Error:', error);

    if (error instanceof APIError) {
      return c.json({ success: false, error: error.message }, error.statusCode as any);
    }

    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const status = errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate') ? 429 : 500;
    return c.json({ success: false, error: errMsg }, status as any);
  }
}
