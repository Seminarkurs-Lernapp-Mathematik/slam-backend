/**
 * Collaborative Canvas Endpoint
 * Allows users to draw/annotate on a canvas and ask AI questions about their drawing
 *
 * Features:
 * - Multipart form data handling for canvas image uploads
 * - Vision model integration (Claude/Gemini with vision)
 * - Math problem solving from handwritten/drawn input
 * - Step-by-step explanation generation
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';
import { callVisionAI, getTaskModelConfig } from '../utils/callAI';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CollaborativeCanvasRequest {
  imageBase64: string;
  question: string;
  gradeLevel?: string;
  courseType?: string;
}

interface CanvasResponse {
  answer: string;
  steps?: string[];
  relatedConcepts?: string[];
  suggestions?: string[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildPrompt(question: string, gradeLevel?: string, courseType?: string): string {
  return `Du bist ein Mathematik-Tutor. Ein Schüler hat ein mathematisches Problem auf einem digitalen Canvas gezeichnet/aufgeschrieben und hat eine Frage dazu.

${gradeLevel ? `KLASSENSTUFE: ${gradeLevel}` : ''}
${courseType ? `KURSTYP: ${courseType}` : ''}

FRAGE DES SCHÜLERS:
"${question}"

AUFGABE:
1. Analysiere das gezeichnete/geschriebene mathematische Problem im Bild
2. Beantworte die Frage des Schülers ausführlich und verständlich
3. Erkläre die Lösung Schritt für Schritt
4. Nenne verwandte mathematische Konzepte
5. Gib Vorschläge für ähnliche Übungsaufgaben

ANTWORTFORMAT - JSON:
{
  "answer": "Ausführliche Antwort auf die Frage mit Erklärung",
  "steps": [
    "Schritt 1: ...",
    "Schritt 2: ...",
    "Schritt 3: ..."
  ],
  "relatedConcepts": [
    "Konzept 1",
    "Konzept 2"
  ],
  "suggestions": [
    "Vorschlag für nächste Übung 1",
    "Vorschlag für nächste Übung 2"
  ]
}

Wichtig: Die Antwort muss gültiges JSON sein. Keine Markdown-Formatierung, kein Code-Block, nur reines JSON.`;
}

function extractJSONFromResponse(text: string): any {
  // Try to find JSON in code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      // Continue to other methods
    }
  }

  // Try to find JSON object directly
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

function validateResponse(data: any): CanvasResponse {
  if (!data.answer || typeof data.answer !== 'string') {
    throw new APIError('Invalid response: answer must be a string', 500);
  }

  return {
    answer: data.answer,
    steps: Array.isArray(data.steps) ? data.steps : undefined,
    relatedConcepts: Array.isArray(data.relatedConcepts) ? data.relatedConcepts : undefined,
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : undefined,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Parse request body - supports both JSON and multipart/form-data
 */
async function parseCanvasRequest(c: Context<{ Bindings: Env }>): Promise<CollaborativeCanvasRequest> {
  const contentType = c.req.header('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.parseBody();
    const imageFile = formData['image'];
    const question = formData['question'] as string;

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

    return {
      imageBase64,
      question: question || '',
      gradeLevel: formData['gradeLevel'] as string | undefined,
      courseType: formData['courseType'] as string | undefined,
    };
  }

  // JSON body
  const body = await c.req.json<Partial<CollaborativeCanvasRequest>>();
  return {
    imageBase64: body.imageBase64 || '',
    question: body.question || '',
    gradeLevel: body.gradeLevel,
    courseType: body.courseType,
  };
}

export async function handleCollaborativeCanvas(c: Context<{ Bindings: Env }>) {
  try {
    const { imageBase64, question, gradeLevel, courseType } = await parseCanvasRequest(c);

    // Validate required fields
    if (!imageBase64) {
      throw new APIError('Missing required field: imageBase64 or image file', 400);
    }
    if (!question || question.trim().length === 0) {
      throw new APIError('Missing required field: question', 400);
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

    console.log('[collaborative-canvas] Request:', {
      questionLength: question.length,
      imageSize: estimatedSize,
    });

    // =======================================================================
    // PHASE 1: Get task configuration from models.json
    // =======================================================================

    const taskConfig = await getTaskModelConfig('collaborativeCanvas');
    console.log(`[Model Router] Using ${taskConfig.model} for collaborativeCanvas task`);

    // =======================================================================
    // PHASE 2: Build prompt and call AI
    // =======================================================================

    const prompt = buildPrompt(question, gradeLevel, courseType);

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

    let responseData: any;
    try {
      responseData = extractJSONFromResponse(responseText);
    } catch (parseError) {
      console.error('[collaborative-canvas] Parse error:', parseError);
      console.error('[collaborative-canvas] Raw response:', responseText.substring(0, 500));
      
      // Fallback: return the raw text as answer
      return c.json({
        success: true,
        text: responseText,
        answer: responseText,
        modelUsed: taskConfig.model,
        providerUsed: taskConfig.provider,
      });
    }

    const result = validateResponse(responseData);

    console.log('[collaborative-canvas] Success:', {
      answerLength: result.answer.length,
      hasSteps: !!result.steps?.length,
    });

    // =======================================================================
    // PHASE 4: Return response
    // =======================================================================

    return c.json({
      success: true,
      text: result.answer,
      ...result,
      modelUsed: taskConfig.model,
      providerUsed: taskConfig.provider,
    });

  } catch (error) {
    console.error('[collaborative-canvas] Error:', error);

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
