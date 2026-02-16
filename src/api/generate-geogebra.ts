/**
 * Generate GeoGebra Commands Endpoint
 * Generates GeoGebra commands for mathematical visualizations
 *
 * Features:
 * - Multi-provider support (Claude, Gemini)
 * - Generates valid GeoGebra syntax commands
 * - Topic-based or prompt-based generation
 * - Educational explanations
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
  apiKey: string;
  provider?: 'claude' | 'gemini';
  selectedModel?: string;
  gradeLevel?: string;
}

interface GeoGebraResult {
  commands: string[];
  explanation: string;
  title: string;
  suggestedZoom?: number;
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

function selectModel(
  provider: 'claude' | 'gemini',
  preferredModel?: string
): string {
  if (preferredModel) return preferredModel;
  return MODEL_TIERS[provider].standard;
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

function buildPrompt(params: {
  questionText?: string;
  topic?: string;
  userPrompt?: string;
  gradeLevel?: string;
}): string {
  const { questionText, topic, userPrompt, gradeLevel } = params;
  
  let context = '';
  if (questionText) {
    context += `AUFGABE: ${questionText}\n`;
  }
  if (topic) {
    context += `THEMA: ${topic}\n`;
  }
  if (userPrompt) {
    context += `WUNSCH: ${userPrompt}\n`;
  }

  return `Du bist ein Experte für GeoGebra und mathematische Visualisierung.

${context}
KLASSENSTUFE: ${gradeLevel || 'Oberstufe'}

Erstelle GeoGebra-Befehle für eine passende Visualisierung.

VERFÜGBARE GEOGEBRA-BEFEHLE:
- Grundlegende Objekte: Point, Line, Segment, Circle, Polygon
- Funktionen: f(x) = ..., g: y = ...
- Transformationen: Mirror, Rotate, Translate, Dilate
- Messungen: Distance, Angle, Area, Length
- Analyse: Intersect, Root, Extremum, InflectionPoint
- Darstellung: Slider, Checkbox, InputBox
- Styling: SetColor, SetLineThickness, SetPointSize, SetVisibleInView
- Ansicht: ZoomIn, Pan, ShowAxes, ShowGrid

BEFEHLS-SYNTAX:
- Punkte: A = (1, 2) oder A = (0, 0)
- Funktionen: f(x) = x^2 + 3*x - 2
- Geraden: g: y = 2*x + 1
- Kreise: c = Circle(A, 2)
- Slider: a = Slider(0, 10)
- Farben: SetColor(f, "red") oder RGB-Werte

WICHTIGE REGELN:
1. Verwende nur gültige GeoGebra-Syntax
2. Erstelle sinnvolle Achsen-Skalierung (ZoomIn wenn nötig)
3. Füge Beschriftungen hinzu (Text-Befehl)
4. Verwende unterschiedliche Farben für verschiedene Objekte
5. Füge Slider für interaktive Parameter ein (wo sinnvoll)
6. Begrenze auf maximal 20 Befehle für Übersichtlichkeit

ANTWORTFORMAT - JSON:
{
  "title": "Titel der Visualisierung",
  "explanation": "Erklärung der Visualisierung für Schüler",
  "commands": [
    "Befehl 1",
    "Befehl 2",
    "..."
  ],
  "suggestedZoom": 5
}

Beispiele für gültige Befehle:
- "A = (0, 0)"
- "f(x) = x^2"
- "g: y = 2*x + 1"
- "c = Circle(A, 3)"
- "SetColor(f, \"blue\")"
- "ZoomIn(5)"
- "ShowGrid(true)"

WICHTIG: Antworte NUR mit dem JSON-Objekt, keine zusätzlichen Erklärungen.`;
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

function validateAndNormalizeCommands(data: any): GeoGebraResult {
  if (!data.commands || !Array.isArray(data.commands)) {
    throw new APIError('Invalid response: commands must be an array', 500);
  }

  // Filter out empty commands and normalize
  const commands = data.commands
    .map((cmd: any) => String(cmd).trim())
    .filter((cmd: string) => cmd.length > 0);

  if (commands.length === 0) {
    throw new APIError('No valid commands generated', 500);
  }

  return {
    commands,
    explanation: data.explanation || 'Visualisierung der mathematischen Konzepte',
    title: data.title || 'GeoGebra Visualisierung',
    suggestedZoom: data.suggestedZoom || 5,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleGenerateGeogebra(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<Partial<GenerateGeogebraRequest>>();

    // Validate required fields
    const { apiKey } = body;
    if (!apiKey) {
      throw new APIError('Missing required field: apiKey', 400);
    }

    // Need at least one of: questionText, topic, userPrompt
    if (!body.questionText && !body.topic && !body.userPrompt) {
      throw new APIError('Missing context: provide questionText, topic, or userPrompt', 400);
    }

    const provider = body.provider || 'claude';
    const selectedModel = body.selectedModel;
    const gradeLevel = body.gradeLevel;

    console.log('[generate-geogebra] Request:', {
      provider,
      hasQuestionText: !!body.questionText,
      hasTopic: !!body.topic,
      hasUserPrompt: !!body.userPrompt,
    });

    // =======================================================================
    // PHASE 1: Select model
    // =======================================================================

    const model = selectModel(provider, selectedModel);
    console.log(`[Model Router] Selected ${model} for ${provider}`);

    // =======================================================================
    // PHASE 2: Build prompt and call AI
    // =======================================================================

    const prompt = buildPrompt({
      questionText: body.questionText,
      topic: body.topic,
      userPrompt: body.userPrompt,
      gradeLevel,
    });

    const temperature = 0.6; // Lower for more consistent syntax

    const responseText = await callAIProvider({
      provider,
      apiKey,
      model,
      prompt,
      temperature,
      maxTokens: 4000,
    });

    // =======================================================================
    // PHASE 3: Parse and validate response
    // =======================================================================

    let geogebraData: any;
    try {
      geogebraData = extractJSONFromResponse(responseText);
    } catch (parseError) {
      console.error('[generate-geogebra] Parse error:', parseError);
      console.error('[generate-geogebra] Raw response:', responseText.substring(0, 500));
      throw new APIError('Failed to parse AI response as JSON', 500);
    }

    const result = validateAndNormalizeCommands(geogebraData);

    console.log('[generate-geogebra] Success:', {
      title: result.title,
      commandCount: result.commands.length,
    });

    // =======================================================================
    // PHASE 4: Return response
    // =======================================================================

    return c.json({
      success: true,
      ...result,
      modelUsed: model,
      providerUsed: provider,
    });

  } catch (error) {
    console.error('[generate-geogebra] Error:', error);

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
