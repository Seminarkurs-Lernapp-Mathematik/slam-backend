/**
 * Generate GeoGebra Commands Endpoint
 * Uses AI to generate GeoGebra commands for mathematical visualizations
 *
 * Features:
 * - Multi-provider support (Claude, Gemini)
 * - Generates valid GeoGebra syntax commands
 * - Provides explanation of the visualization
 * - Supports topic-based or question-based generation
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface GenerateGeogebraRequest {
  questionText?: string;
  topic?: string;
  userPrompt?: string;
  apiKey?: string;
  provider?: 'claude' | 'gemini';
  selectedModel?: string;
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

function buildGeogebraPrompt(questionText?: string, topic?: string, userPrompt?: string): string {
  const context = questionText
    ? `AUFGABE: ${questionText}`
    : topic
    ? `THEMA: ${topic}`
    : userPrompt
    ? `BENUTZERANFRAGE: ${userPrompt}`
    : 'THEMA: Allgemeine mathematische Visualisierung';

  return `Du bist ein Experte für GeoGebra und mathematische Visualisierungen. Erstelle GeoGebra-Befehle für eine mathematische Visualisierung.

${context}

ANFORDERUNGEN:
- Erstelle eine Liste von GeoGebra-Befehlen, die eine hilfreiche mathematische Visualisierung erzeugen
- Verwende ausschliesslich gueltige GeoGebra-Syntax
- Die Befehle sollen in der richtigen Reihenfolge stehen (Definitionen vor Verwendungen)
- Erstelle eine klare, uebersichtliche Visualisierung
- Verwende Farben und Beschriftungen fuer bessere Lesbarkeit

GUELTIGE GEOGEBRA-BEFEHLSBEISPIELE:
- Funktionen: f(x) = x^2, g(x) = sin(x), h(x) = 2*x + 3
- Punkte: A = (1, 2), B = (-3, 4)
- Geraden: Gerade[A, B]
- Kreise: Kreis[(0, 0), 3]
- Vektoren: v = Vektor[(0, 0), (3, 4)]
- Winkel: Winkel[A, B, C]
- Tangenten: Tangente[A, f]
- Ableitungen: f'(x) = Ableitung[f]
- Integrale: Integral[f, a, b]
- Farben setzen: SetzeKFarbe[f, "Blau"]
- Beschriftungen: SetzeBezeichnung[A, "Punkt A"]
- Sichtbarkeit: ZeigeBezeichnung[A, true]

WICHTIG: Antworte NUR mit einem JSON-Objekt (kein zusaetzlicher Text, kein Markdown-Code-Block).

{
  "commands": ["Befehl1", "Befehl2", "..."],
  "explanation": "Erklaerung der Visualisierung auf Deutsch"
}`;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleGenerateGeogebra(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<GenerateGeogebraRequest>();

    // Validate: at least one context field and an API key must be provided
    const { questionText, topic, userPrompt, apiKey, selectedModel } = body;
    if (!questionText && !topic && !userPrompt) {
      throw new APIError('At least one of questionText, topic, or userPrompt is required', 400);
    }

    if (!apiKey) {
      throw new APIError('Missing required field: apiKey', 400);
    }

    // Determine provider and model
    const provider = body.provider || 'claude';
    const model = selectedModel || MODEL_TIERS[provider]?.standard || MODEL_TIERS.claude.standard;

    console.log(`[generate-geogebra] Request: provider=${provider}, model=${model}, topic="${topic || questionText?.substring(0, 50) || userPrompt?.substring(0, 50)}"`);

    // Build prompt and call AI
    const prompt = buildGeogebraPrompt(questionText, topic, userPrompt);

    const responseText = await callAIProvider({
      provider,
      apiKey,
      model,
      prompt,
      temperature: 0.5,
      maxTokens: 4000,
    });

    // Parse the AI response
    let commands: string[] = [];
    let explanation = '';

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        commands = Array.isArray(parsed.commands) ? parsed.commands : [];
        explanation = parsed.explanation || '';
      } else {
        throw new Error('No JSON object found in response');
      }
    } catch (parseError) {
      // Fallback: try to extract commands line by line
      console.warn('[generate-geogebra] JSON parse failed, attempting line extraction');

      const lines = responseText.split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => {
          // Filter for lines that look like GeoGebra commands
          return line.length > 0
            && !line.startsWith('//')
            && !line.startsWith('#')
            && !line.startsWith('{')
            && !line.startsWith('}')
            && !line.startsWith('"')
            && (line.includes('=') || line.includes('(') || line.includes('['));
        });

      commands = lines;
      explanation = 'Automatisch extrahierte GeoGebra-Befehle.';
    }

    // Filter out any empty or invalid commands
    commands = commands.filter((cmd: string) => cmd && cmd.trim().length > 0);

    if (commands.length === 0) {
      throw new APIError('AI response did not contain valid GeoGebra commands', 500);
    }

    console.log(`[generate-geogebra] Success: ${commands.length} commands generated`);

    return c.json({
      success: true,
      commands,
      explanation,
    });
  } catch (error) {
    console.error('[generate-geogebra] Error:', error);

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
