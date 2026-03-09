/**
 * Generate GeoGebra Commands Endpoint
 * Generates GeoGebra commands for mathematical visualizations
 *
 * Features:
 * - Backend-configured AI provider and model
 * - Generates valid GeoGebra syntax commands
 * - Topic-based or prompt-based generation
 * - Educational explanations
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';
import { parseJsonWithRepair } from '../utils/repairJson';
import { callAI, getTaskModelConfig } from '../utils/callAI';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface GenerateGeogebraRequest {
  questionText?: string;
  topic?: string;
  userPrompt?: string;
  gradeLevel?: string;
}

interface GeoGebraResult {
  commands: string[];
  explanation: string;
  title: string;
  suggestedZoom?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : text;
  return parseJsonWithRepair(candidate);
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

    // Need at least one of: questionText, topic, userPrompt
    if (!body.questionText && !body.topic && !body.userPrompt) {
      throw new APIError('Missing context: provide questionText, topic, or userPrompt', 400);
    }

    const gradeLevel = body.gradeLevel;

    console.log('[generate-geogebra] Request:', {
      hasQuestionText: !!body.questionText,
      hasTopic: !!body.topic,
      hasUserPrompt: !!body.userPrompt,
    });

    // =======================================================================
    // PHASE 1: Get task configuration from models.json
    // =======================================================================

    const taskConfig = await getTaskModelConfig('generateGeogebra');
    console.log(`[Model Router] Using ${taskConfig.model} for generateGeogebra task`);

    // =======================================================================
    // PHASE 2: Build prompt and call AI
    // =======================================================================

    const prompt = buildPrompt({
      questionText: body.questionText,
      topic: body.topic,
      userPrompt: body.userPrompt,
      gradeLevel,
    });

    const responseText = await callAI({
      provider: taskConfig.provider,
      apiKey: '', // Will be fetched from env by callAI
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
      modelUsed: taskConfig.model,
      providerUsed: taskConfig.provider,
    });

  } catch (error) {
    console.error('[generate-geogebra] Error:', error);

    if (error instanceof APIError) {
      return c.json({ success: false, error: error.message }, error.statusCode as any);
    }

    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const status = errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate') ? 429 : 500;
    return c.json({ success: false, error: errMsg }, status as any);
  }
}
