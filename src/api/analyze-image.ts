/**
 * Analyze Image Endpoint
 * Extracts mathematical topics from uploaded images (exam papers, notes, etc.)
 *
 * Features:
 * - Multipart form data handling for image uploads
 * - Vision model integration (Claude/Gemini with vision)
 * - Topic extraction and curriculum mapping
 * - Support for German math terminology
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AnalyzeImageRequest {
  imageBase64: string;
  apiKey: string;
  provider?: 'claude' | 'gemini';
  selectedModel?: string;
  analysisType?: 'topic-extraction' | 'question-generation' | 'full-analysis';
  gradeLevel?: string;
}

interface ExtractedTopic {
  leitidee: string;
  thema: string;
  unterthema: string;
  confidence: number;
}

interface AnalysisResult {
  topics: ExtractedTopic[];
  summary: string;
  suggestedQuestions?: string[];
  difficulty?: number;
}

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

const VISION_MODELS = {
  claude: 'claude-sonnet-4-5-20250929', // Claude has vision capabilities
  gemini: 'gemini-3-pro-preview', // Gemini Pro has vision
} as const;

const AI_ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
} as const;

// ============================================================================
// CURRICULUM REFERENCE FOR VALIDATION
// ============================================================================

const VALID_LEITIDEEN = ['Algebra', 'Analysis', 'Geometrie', 'Stochastik'] as const;

const THEMA_MAPPINGS: Record<string, string[]> = {
  'Algebra': [
    'Gleichungen', 'Ungleichungen', 'Funktionen', 'Terme', 'Potenzen', 'Wurzeln',
    'Logarithmen', 'Polynome', 'Rationalg', 'Komplexe Zahlen', 'Matrizen'
  ],
  'Analysis': [
    'Grenzwerte', 'Differentialrechnung', 'Integralrechnung', 'Kurvendiskussion',
    'Funktionsscharen', 'e-Funktion', 'Trigonometrische Funktionen', 'Folgen', 'Reihen'
  ],
  'Geometrie': [
    'Vektoren', 'Analytische Geometrie', 'Geraden', 'Ebenen', 'Kreise', 'Kugeln',
    'Abbildungen', 'Trigonometrie', 'Sätze', 'Körper'
  ],
  'Stochastik': [
    'Kombinatorik', 'Wahrscheinlichkeit', 'Zufallsvariablen', 'Verteilungen',
    'Statistik', 'Hypothesentests', 'Regression', 'Binomialverteilung', 'Normalverteilung'
  ],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function selectModel(provider: 'claude' | 'gemini', preferredModel?: string): string {
  if (preferredModel) return preferredModel;
  return VISION_MODELS[provider];
}

async function callVisionProvider({
  provider,
  apiKey,
  model,
  imageBase64,
  prompt,
}: {
  provider: 'claude' | 'gemini';
  apiKey: string;
  model: string;
  imageBase64: string;
  prompt: string;
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
          max_tokens: 4000,
          temperature: 0.3,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          }],
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
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageBase64,
                },
              },
            ],
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4000 },
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

function buildPrompt(analysisType: string, gradeLevel?: string): string {
  const basePrompt = `Analysiere dieses Bild und extrahiere mathematische Themen.

${gradeLevel ? `KLASSENSTUFE: ${gradeLevel}` : ''}

AUFGABE:
1. Identifiziere ALLE mathematischen Themen im Bild
2. Ordne sie dem deutschen Mathematik-Lehrplan zu:
   - Leitidee (Algebra, Analysis, Geometrie, Stochastik)
   - Thema (z.B. "Gleichungen", "Differentialrechnung")
   - Unterthema (spezifischer Bereich)

3. Bewerte deine Zuordnung mit Confidence-Score (0.0-1.0)

4. Erstelle eine Zusammenfassung des Inhalts

LEITIDEEN-REFERENZ:
- Algebra: Gleichungen, Funktionen, Terme, Logarithmen, Matrizen
- Analysis: Grenzwerte, Ableitungen, Integrale, Kurvendiskussion, e-Funktion
- Geometrie: Vektoren, Analytische Geometrie, Trigonometrie, Körper
- Stochastik: Wahrscheinlichkeit, Statistik, Verteilungen, Kombinatorik

ANTWORTFORMAT - JSON:
{
  "topics": [
    {
      "leitidee": "Algebra|Analysis|Geometrie|Stochastik",
      "thema": "Name des Themas",
      "unterthema": "Spezifisches Unterthema",
      "confidence": 0.95
    }
  ],
  "summary": "Beschreibung des Bildinhalts in 2-3 Sätzen"
}`;

  if (analysisType === 'question-generation') {
    return basePrompt + `,
  "suggestedQuestions": [
    "Beispiel-Frage 1 zum Thema",
    "Beispiel-Frage 2 zum Thema"
  ],
  "difficulty": 5
}`;
  }

  return basePrompt;
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

function validateAndNormalizeTopics(data: any): AnalysisResult {
  if (!data.topics || !Array.isArray(data.topics)) {
    throw new APIError('Invalid response: topics must be an array', 500);
  }

  // Validate and normalize each topic
  const validatedTopics: ExtractedTopic[] = data.topics
    .map((t: any) => ({
      leitidee: VALID_LEITIDEEN.includes(t.leitidee) ? t.leitidee : 'Algebra',
      thema: t.thema || 'Allgemein',
      unterthema: t.unterthema || t.thema || 'Allgemein',
      confidence: Math.max(0, Math.min(1, parseFloat(t.confidence) || 0.5)),
    }))
    .filter((t: ExtractedTopic) => t.leitidee && t.thema);

  if (validatedTopics.length === 0) {
    throw new APIError('No valid topics extracted from image', 422);
  }

  return {
    topics: validatedTopics,
    summary: data.summary || 'Mathematische Themen extrahiert',
    suggestedQuestions: data.suggestedQuestions,
    difficulty: data.difficulty,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleAnalyzeImage(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<Partial<AnalyzeImageRequest>>();

    // Validate required fields
    const { imageBase64, apiKey } = body;
    if (!imageBase64) {
      throw new APIError('Missing required field: imageBase64', 400);
    }
    if (!apiKey) {
      throw new APIError('Missing required field: apiKey', 400);
    }

    // Validate image data format
    if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
      throw new APIError('Invalid imageBase64 format: must be base64 encoded', 400);
    }

    // Check image size (rough estimate: base64 is ~4/3 of binary size)
    const estimatedSize = (imageBase64.length * 3) / 4;
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (estimatedSize > MAX_SIZE) {
      throw new APIError(`Image too large: maximum 10MB allowed`, 400);
    }

    const provider = body.provider || 'claude';
    const selectedModel = body.selectedModel;
    const analysisType = body.analysisType || 'topic-extraction';
    const gradeLevel = body.gradeLevel;

    console.log('[analyze-image] Request:', {
      provider,
      analysisType,
      imageSize: estimatedSize,
    });

    // =======================================================================
    // PHASE 1: Select model
    // =======================================================================

    const model = selectModel(provider, selectedModel);
    console.log(`[Model Router] Selected ${model} for ${provider}`);

    // =======================================================================
    // PHASE 2: Build prompt and call AI
    // =======================================================================

    const prompt = buildPrompt(analysisType, gradeLevel);

    const responseText = await callVisionProvider({
      provider,
      apiKey,
      model,
      imageBase64,
      prompt,
    });

    // =======================================================================
    // PHASE 3: Parse and validate response
    // =======================================================================

    let analysisData: any;
    try {
      analysisData = extractJSONFromResponse(responseText);
    } catch (parseError) {
      console.error('[analyze-image] Parse error:', parseError);
      console.error('[analyze-image] Raw response:', responseText.substring(0, 500));
      throw new APIError('Failed to parse AI response as JSON', 500);
    }

    const result = validateAndNormalizeTopics(analysisData);

    console.log('[analyze-image] Success:', {
      topicCount: result.topics.length,
      topConfidence: result.topics[0]?.confidence,
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
    console.error('[analyze-image] Error:', error);

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
