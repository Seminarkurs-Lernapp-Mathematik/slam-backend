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

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CollaborativeCanvasRequest {
  imageBase64: string;
  question: string;
  apiKey: string;
  provider?: 'claude' | 'gemini';
  selectedModel?: string;
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
// MODEL CONFIGURATION
// ============================================================================

const VISION_MODELS = {
  claude: 'claude-sonnet-4-5-20250929',
  gemini: 'gemini-2.0-flash',
} as const;

const AI_ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
} as const;

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
          temperature: 0.4,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
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
                  mime_type: 'image/png',
                  data: imageBase64,
                },
              },
            ],
          }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4000 },
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

export async function handleCollaborativeCanvas(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<Partial<CollaborativeCanvasRequest>>();

    // Validate required fields
    const { imageBase64, question, apiKey } = body;
    if (!imageBase64) {
      throw new APIError('Missing required field: imageBase64', 400);
    }
    if (!question || question.trim().length === 0) {
      throw new APIError('Missing required field: question', 400);
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
    const gradeLevel = body.gradeLevel;
    const courseType = body.courseType;

    console.log('[collaborative-canvas] Request:', {
      provider,
      questionLength: question.length,
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

    const prompt = buildPrompt(question, gradeLevel, courseType);

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

    let responseData: any;
    try {
      responseData = extractJSONFromResponse(responseText);
    } catch (parseError) {
      console.error('[collaborative-canvas] Parse error:', parseError);
      console.error('[collaborative-canvas] Raw response:', responseText.substring(0, 500));
      
      // Fallback: return the raw text as answer
      return c.json({
        success: true,
        answer: responseText,
        modelUsed: model,
        providerUsed: provider,
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
      ...result,
      modelUsed: model,
      providerUsed: provider,
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
