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
import { sanitizePII } from '../utils/sanitizePII';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ThemeColors {
  primary?: string;       // e.g. "#FF7A3B"
  primaryDark?: string;   // darker shade for hover / borders
  primaryLight?: string;  // very light tint for surfaces
  bg?: string;            // page background
  surface?: string;       // card background
  text?: string;          // body text
}

interface GenerateMiniAppRequest {
  description: string;
  themeColors?: ThemeColors;
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


/**
 * Derive a slightly darker shade of a hex color for hover states.
 * Works for 6-digit hex strings like "#FF7A3B".
 */
function darkenHex(hex: string, amount = 30): string {
  const clean = hex.replace('#', '');
  const r = Math.max(0, parseInt(clean.slice(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(clean.slice(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(clean.slice(4, 6), 16) - amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Convert hex to rgba string with given opacity (0-1) */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Build the CSS :root block with theme overrides applied.
 * Falls back to the default dark design for any missing field.
 */
function buildDesignSystemCSS(theme?: ThemeColors): string {
  const p    = theme?.primary     ?? '#ff7a3b';
  const pD   = theme?.primaryDark  ?? darkenHex(p, 30);
  const pL   = theme?.primaryLight ?? hexToRgba(p, 0.12);
  const bg   = theme?.bg           ?? '#0f0a0d';
  const surf = theme?.surface      ?? '#22161c';
  const txt  = theme?.text         ?? '#fff4ec';

  return `
/* ===== SLAM DESIGN SYSTEM ===== */
:root {
  --c-primary: ${p};
  --c-primary-light: ${pL};
  --c-primary-dark: ${pD};
  --c-success: #10b981;
  --c-error: #ef4444;
  --c-warning: #f59e0b;
  --c-surface: ${surf};
  --c-bg: ${bg};
  --c-border: rgba(255,255,255,0.1);
  --c-text: ${txt};
  --c-text-muted: rgba(255,255,255,0.45);
  --r-sm: 8px; --r-md: 12px; --r-lg: 16px;
  --sh-sm: 0 1px 3px rgba(0,0,0,.18);
  --sh-md: 0 4px 6px rgba(0,0,0,.22),0 2px 4px rgba(0,0,0,.18);
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--c-bg);color:var(--c-text);font-size:15px;line-height:1.5;min-height:100vh;padding:16px}
h1{font-size:22px;font-weight:800;color:var(--c-text);margin-bottom:4px}
h2{font-size:17px;font-weight:700;margin-bottom:8px}
.card{background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--r-lg);box-shadow:var(--sh-md);padding:20px;margin-bottom:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border-radius:var(--r-md);font-family:var(--font);font-size:14px;font-weight:600;cursor:pointer;border:none;transition:all .15s ease;outline:none;user-select:none}
.btn-primary{background:var(--c-primary);color:#fff}
.btn-primary:hover{background:var(--c-primary-dark);transform:translateY(-1px);box-shadow:var(--sh-md)}
.btn-primary:active{transform:translateY(0)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-secondary{background:var(--c-primary-light);color:var(--c-primary)}
.btn-secondary:hover{opacity:.85}
.btn-outline{background:transparent;color:var(--c-primary);border:2px solid var(--c-primary)}
.btn-outline:hover{background:var(--c-primary-light)}
label,.label{display:block;font-size:12px;font-weight:700;color:var(--c-text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em}
input,select,textarea{width:100%;padding:10px 14px;border:1.5px solid var(--c-border);border-radius:var(--r-sm);font-family:var(--font);font-size:14px;color:var(--c-text);background:var(--c-surface);transition:border-color .15s;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--c-primary)}
.form-group{margin-bottom:14px}
.result-box{background:var(--c-primary-light);border-left:4px solid var(--c-primary);border-radius:var(--r-sm);padding:14px 16px;font-size:16px;font-weight:700;color:var(--c-text);margin-top:12px}
.success-box{background:rgba(16,185,129,.15);border-left:4px solid var(--c-success);border-radius:var(--r-sm);padding:12px 16px;color:#4dd490;font-weight:600}
.error-box{background:rgba(239,68,68,.15);border-left:4px solid var(--c-error);border-radius:var(--r-sm);padding:12px 16px;color:#ff6b7a}
.info-box{background:rgba(59,130,246,.12);border-left:4px solid #3b82f6;border-radius:var(--r-sm);padding:12px 16px;color:#60a5fa}
.grid{display:grid;gap:12px}
.grid-2{grid-template-columns:1fr 1fr}
.flex{display:flex;gap:10px;align-items:center}
.flex-wrap{flex-wrap:wrap}
.flex-col{flex-direction:column}
.tag{display:inline-block;background:var(--c-primary-light);color:var(--c-primary);font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px}
.divider{height:1px;background:var(--c-border);margin:16px 0}
@media(max-width:480px){.grid-2{grid-template-columns:1fr}}
`;
}

function buildPrompt(description: string, complexity: string, theme?: ThemeColors): string {
  const designCSS = buildDesignSystemCSS(theme);

  return `Du bist ein Experte für interaktive mathematische Web-Anwendungen.

Erstelle eine vollständige, eigenständige HTML-Mini-App basierend auf dieser Beschreibung:
"${description}"

KOMPLEXITÄTSSTUFE: ${complexity}

━━━ PFLICHT: SLAM DESIGN SYSTEM ━━━
Füge dieses CSS WÖRTLICH und VOLLSTÄNDIG in den <style>-Block ein:

${designCSS}

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

    const { description, themeColors } = body;
    if (!description) {
      throw new APIError('Missing required field: description', 400);
    }

    const complexity = determineComplexity(description);

    console.log('[generate-mini-app] Request:', {
      complexity,
      hasTheme: !!themeColors,
      primaryColor: themeColors?.primary ?? 'default',
      description: description.substring(0, 50) + '...',
    });

    const taskConfig = await getTaskModelConfig('generateMiniApp');
    console.log(`[Model Router] Using model ${taskConfig.model} from task config`);

    const safeDescription = sanitizePII(description);
    const prompt = buildPrompt(safeDescription, complexity, themeColors);

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
