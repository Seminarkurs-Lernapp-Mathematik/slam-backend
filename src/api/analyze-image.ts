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
import { callVisionAI, getTaskModelConfig } from '../utils/callAI';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AnalyzeImageRequest {
  imageBase64: string;
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

/**
 * Parse request body - supports both JSON and multipart/form-data
 */
async function parseImageRequest(c: Context<{ Bindings: Env }>): Promise<AnalyzeImageRequest> {
  const contentType = c.req.header('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.parseBody();
    const imageFile = formData['image'];

    if (!imageFile || typeof imageFile === 'string') {
      throw new APIError('Missing required field: image (file upload)', 400);
    }

    // Convert File to base64
    const arrayBuffer = await (imageFile as File).arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const imageBase64 = btoa(binary);

    // Accept both 'type' (frontend) and 'analysisType' (backend convention)
    const analysisType = (formData['type'] as string) || (formData['analysisType'] as string) || 'topic-extraction';

    return {
      imageBase64,
      analysisType: analysisType as AnalyzeImageRequest['analysisType'],
      gradeLevel: formData['gradeLevel'] as string | undefined,
    };
  }

  // JSON body
  const body = await c.req.json<Partial<AnalyzeImageRequest & { type?: string }>>();
  return {
    imageBase64: body.imageBase64 || '',
    // Accept both 'type' (frontend) and 'analysisType' (backend)
    analysisType: (body.type || body.analysisType || 'topic-extraction') as AnalyzeImageRequest['analysisType'],
    gradeLevel: body.gradeLevel,
  };
}

export async function handleAnalyzeImage(c: Context<{ Bindings: Env }>) {
  try {
    const { imageBase64, analysisType, gradeLevel } = await parseImageRequest(c);

    // Validate required fields
    if (!imageBase64) {
      throw new APIError('Missing required field: imageBase64 or image file', 400);
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

    console.log('[analyze-image] Request:', {
      analysisType,
      imageSize: estimatedSize,
    });

    // =======================================================================
    // PHASE 1: Get task configuration from models.json
    // =======================================================================

    const taskConfig = await getTaskModelConfig('analyzeImage');
    console.log(`[Model Router] Using ${taskConfig.model} for analyzeImage task`);

    // =======================================================================
    // PHASE 2: Build prompt and call AI
    // =======================================================================

    const prompt = buildPrompt(analysisType || 'topic-extraction', gradeLevel);

    const responseText = await callVisionAI({
      provider: taskConfig.provider,
      model: taskConfig.model,
      imageBase64,
      prompt,
      temperature: taskConfig.temperature,
      maxTokens: taskConfig.maxTokens,
      env: c.env,
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

    // Return both structured topics and flat string list for frontend compatibility
    // Frontend expects: topics as List<String>, summary as String
    const topicStrings = result.topics.map(
      (t) => `${t.leitidee} > ${t.thema} > ${t.unterthema}`
    );

    return c.json({
      success: true,
      topics: topicStrings,
      structuredTopics: result.topics,
      summary: result.summary,
      suggestedQuestions: result.suggestedQuestions,
      difficulty: result.difficulty,
      modelUsed: taskConfig.model,
      providerUsed: taskConfig.provider,
    });

  } catch (error) {
    console.error('[analyze-image] Error:', error);

    if (error instanceof APIError) {
      return c.json({ success: false, error: error.message }, error.statusCode as any);
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
