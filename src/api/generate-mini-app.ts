/**
 * Generate Mini App Endpoint
 * Generates interactive HTML mini-apps using AI
 *
 * The prompt enforces a uniform SLAM visual design system so all generated
 * apps share consistent colors, typography, spacing, and components.
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
  if (
    lowerDesc.includes('3d') ||
    lowerDesc.includes('animation') ||
    lowerDesc.includes('simulation') ||
    lowerDesc.includes('komplex') ||
    lowerDesc.includes('fortgeschritten')
  ) {
    return 'advanced';
  }
  if (
    lowerDesc.includes('einfach') ||
    lowerDesc.includes('simple') ||
    lowerDesc.includes('basic') ||
    lowerDesc.includes('rechner') ||
    description.length < 50
  ) {
    return 'simple';
  }
  return 'medium';
}

/** Uniform design system embedded in every generated app */
const DESIGN_SYSTEM_CSS = `
/* ===== SLAM DESIGN SYSTEM ===== */
:root {
  --c-primary: #5c35cc;
  --c-primary-light: #ede9fb;
  --c-primary-dark: #3d1fa8;
  --c-success: #10b981;
  --c-error: #ef4444;
  --c-warning: #f59e0b;
  --c-surface: #ffffff;
  --c-bg: #f5f5f5;
  --c-border: #e0e0e0;
  --c-text: #1a1a2e;
  --c-text-muted: #64748b;
  --r-sm: 8px; --r-md: 12px; --r-lg: 16px;
  --sh-sm: 0 1px 3px rgba(0,0,0,.08);
  --sh-md: 0 4px 6px rgba(0,0,0,.07),0 2px 4px rgba(0,0,0,.06);
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--c-bg);color:var(--c-text);font-size:15px;line-height:1.5;min-height:100vh;padding:16px}
h1{font-size:22px;font-weight:800;color:var(--c-text);margin-bottom:4px}
h2{font-size:17px;font-weight:700;margin-bottom:8px}
.card{background:var(--c-surface);border-radius:var(--r-lg);box-shadow:var(--sh-md);padding:20px;margin-bottom:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border-radius:var(--r-md);font-family:var(--font);font-size:14px;font-weight:600;cursor:pointer;border:none;transition:all .15s ease;outline:none;user-select:none}
.btn-primary{background:var(--c-primary);color:#fff}
.btn-primary:hover{background:var(--c-primary-dark);transform:translateY(-1px);box-shadow:var(--sh-md)}
.btn-primary:active{transform:translateY(0)}
.btn-primary:disabled{background:#c4b5e8;cursor:not-allowed;transform:none}
.btn-secondary{background:var(--c-primary-light);color:var(--c-primary)}
.btn-secondary:hover{background:#d6cef5}
.btn-outline{background:transparent;color:var(--c-primary);border:2px solid var(--c-primary)}
.btn-outline:hover{background:var(--c-primary-light)}
label,.label{display:block;font-size:12px;font-weight:700;color:var(--c-text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em}
input,select,textarea{width:100%;padding:10px 14px;border:1.5px solid var(--c-border);border-radius:var(--r-sm);font-family:var(--font);font-size:14px;color:var(--c-text);background:var(--c-surface);transition:border-color .15s;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--c-primary)}
.form-group{margin-bottom:14px}
.result-box{background:var(--c-primary-light);border-left:4px solid var(--c-primary);border-radius:var(--r-sm);padding:14px 16px;font-size:16px;font-weight:700;color:var(--c-primary-dark);margin-top:12px}
.success-box{background:#d1fae5;border-left:4px solid var(--c-success);border-radius:var(--r-sm);padding:12px 16px;color:#065f46;font-weight:600}
.error-box{background:#fee2e2;border-left:4px solid var(--c-error);border-radius:var(--r-sm);padding:12px 16px;color:#991b1b}
.info-box{background:#e0f2fe;border-left:4px solid #0284c7;border-radius:var(--r-sm);padding:12px 16px;color:#0c4a6e}
.grid{display:grid;gap:12px}
.grid-2{grid-template-columns:1fr 1fr}
.flex{display:flex;gap:10px;align-items:center}
.flex-wrap{flex-wrap:wrap}
.flex-col{flex-direction:column}
.tag{display:inline-block;background:var(--c-primary-light);color:var(--c-primary);font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px}
.divider{height:1px;background:var(--c-border);margin:16px 0}
@media(max-width:480px){.grid-2{grid-template-columns:1fr}}
`;

function buildPrompt(description: string, complexity: string): string {
  return `Du bist ein Experte für interaktive mathematische Web-Anwendungen.

Erstelle eine vollständige, eigenständige HTML-Mini-App basierend auf dieser Beschreibung:
"${description}"

KOMPLEXITÄTSSTUFE: ${complexity}

━━━ PFLICHT: SLAM DESIGN SYSTEM ━━━
Füge dieses CSS WÖRTLICH und VOLLSTÄNDIG in den <style>-Block ein:

${DESIGN_SYSTEM_CSS}

━━━ ANFORDERUNGEN ━━━
1. Nutze ausschließlich die CSS-Variablen (--c-primary, --c-bg etc.) und Klassen (.card, .btn-primary, .result-box, .form-group usw.) aus dem Design System
2. App funktioniert komplett in einer einzigen HTML-Datei
3. Kein eigenes CSS für Farben/Fonts/Schatten — nur Design-System-Variablen
4. Externe Bibliotheken nur als CDN: Chart.js oder MathJax falls wirklich nötig
5. Responsive — funktioniert auf Mobilgeräten (nutze .grid-2 für zwei Spalten)
6. Alle UI-Texte auf Deutsch
7. Klare Beschreibung/Anleitung für den Nutzer direkt im Interface (innerhalb einer .info-box oder .card)
8. Eingabevalidierung mit visueller Fehlermeldung (.error-box)
9. Ergebnisse visuell hervorheben (.result-box oder .success-box)
10. Glatte Übergänge mit CSS transitions wo sinnvoll

SICHERHEITSREGELN:
- Kein Zugriff auf externe APIs
- Kein localStorage/sessionStorage
- Keine Weiterleitungen
- Kein eval() von Benutzereingaben

ANTWORTFORMAT — nur JSON, kein Markdown, kein Text außerhalb:
{
  "title": "Kurzer Titel der App",
  "description": "Was die App macht",
  "html": "<!DOCTYPE html><html lang=\\"de\\">...</html>",
  "css": "",
  "javascript": ""
}

WICHTIG: html enthält bereits das vollständige Design System CSS im <style>-Block. Die Felder css und javascript können leer sein wenn alles in html enthalten ist.`;
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

    const { description } = body;
    if (!description) {
      throw new APIError('Missing required field: description', 400);
    }

    const complexity = determineComplexity(description);

    console.log('[generate-mini-app] Request:', {
      complexity,
      description: description.substring(0, 50) + '...',
    });

    const taskConfig = await getTaskModelConfig('generateMiniApp');
    console.log(`[Model Router] Using model ${taskConfig.model} from task config`);

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
    const status =
      errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate')
        ? 429
        : 500;
    return c.json({ success: false, error: errMsg }, status as any);
  }
}
