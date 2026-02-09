/**
 * Generate Questions Endpoint
 * Migrated from functions/api/generate-questions.js
 *
 * Features:
 * - Intelligent model selection based on complexity
 * - Firestore question caching (7-day cache)
 * - Multi-provider support (Claude, Gemini)
 * - AFB-level aware generation
 * - Cost optimization for simple queries
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import type { Topic, UserContext, QuestionSession } from '../types';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface GenerateQuestionsRequest {
  apiKey: string;
  userId: string;
  learningPlanItemId: number;
  topics: Topic[];
  userContext: UserContext;
  selectedModel?: string;
  provider?: 'claude' | 'gemini';
  complexity?: 'light' | 'standard' | 'heavy' | null;
  afbLevel?: 'I' | 'II' | 'III';
  questionCount?: number;
  useCache?: boolean;
  forceRegenerate?: boolean;
  firebaseConfig?: {
    projectId: string;
    accessToken: string;
  };
}

// ============================================================================
// MODEL ROUTER CONFIGURATION
// ============================================================================

const MODEL_TIERS = {
  claude: {
    light: 'claude-haiku-4-5-20251001',
    standard: 'claude-sonnet-4-5-20250929',
    heavy: 'claude-sonnet-4-5-20250929',
  },
  gemini: {
    light: 'gemini-3-flash-preview',
    standard: 'gemini-3-flash-preview',
    heavy: 'gemini-3-pro-preview',
  },
} as const;

const AI_ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function determineModelTier({
  afbLevel = 'II',
  hasGeoGebra = false,
  questionCount = 20,
  hasProof = false,
  isNumericOnly = false,
}: {
  afbLevel?: 'I' | 'II' | 'III';
  hasGeoGebra?: boolean;
  questionCount?: number;
  hasProof?: boolean;
  isNumericOnly?: boolean;
}): 'light' | 'standard' | 'heavy' {
  // Heavy tier for complex tasks
  if (hasGeoGebra || hasProof || afbLevel === 'III' || questionCount > 15) {
    return 'heavy';
  }

  // Light tier for simple tasks
  if (afbLevel === 'I' || (isNumericOnly && questionCount <= 5) || questionCount <= 3) {
    return 'light';
  }

  return 'standard';
}

function selectModel(
  provider: 'claude' | 'gemini',
  complexityOptions: Parameters<typeof determineModelTier>[0],
  preferredModel?: string | null
): string {
  if (preferredModel) return preferredModel;

  const tier = determineModelTier(complexityOptions);
  return MODEL_TIERS[provider]?.[tier] || MODEL_TIERS.claude.standard;
}

function generateCacheKey(topics: Topic[], afbLevel: string, difficulty: number): string {
  const topicHash = topics
    .map((t) => `${t.leitidee}_${t.thema}_${t.unterthema}`)
    .sort()
    .join('|')
    .replace(/[^a-zA-Z0-9|_]/g, '_');

  return `cache_${topicHash}_AFB${afbLevel}_D${difficulty}`.substring(0, 128);
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

function buildPrompt(
  topics: Topic[],
  userContext: UserContext,
  afbLevel: string,
  questionCount: number
): string {
  const topicsList = topics.map((t) => `- ${t.leitidee} > ${t.thema} > ${t.unterthema}`).join('\n');

  const strugglingTopicsText =
    userContext.recentPerformance?.strugglingTopics?.length > 0
      ? `Der Schüler hat Schwierigkeiten mit: ${userContext.recentPerformance.strugglingTopics.join(', ')}`
      : 'Keine bekannten Schwierigkeiten';

  const autoModeText = userContext.autoModeAssessment
    ? `AUTO-Modus Einschätzung:
- Detailgrad: ${userContext.autoModeAssessment.currentAssessment.detailLevel}%
- Temperatur: ${userContext.autoModeAssessment.currentAssessment.temperature}
- Hilfestellung: ${userContext.autoModeAssessment.currentAssessment.helpfulness}%

Interne Begründung: "${userContext.autoModeAssessment.currentAssessment.reasoning}"`
    : 'AUTO-Modus nicht aktiv - nutze ausgewogene Einstellungen';

  const complexityInstructions = `
ANFORDERUNGSBEREICH: ${afbLevel}
${afbLevel === 'I' ? '- Fokus auf Reproduktion und einfache Anwendung\n- Keine komplexen Transferaufgaben' : ''}
${afbLevel === 'II' ? '- Ausgewogene Mischung aus Anwendung und Reorganisation\n- Moderate Komplexität' : ''}
${afbLevel === 'III' ? '- Fokus auf Transfer und komplexe Problemlösung\n- Beweise und Begründungen einbeziehen' : ''}

ANZAHL FRAGEN: ${questionCount}
`;

  return `Du bist ein Mathematiklehrer für die ${userContext.gradeLevel}. Klasse (${userContext.courseType}).

THEMEN:
${topicsList}

SCHÜLER-KONTEXT:
- Klassenstufe: ${userContext.gradeLevel}
- Kurs: ${userContext.courseType}
${strugglingTopicsText}

${autoModeText}

${complexityInstructions}

Generiere ${questionCount} mathematische Fragen zu den angegebenen Themen.

WICHTIG: Antworte NUR mit einem JSON-Objekt in folgendem Format (kein zusätzlicher Text):

{
  "questions": [
    {
      "id": "unique-id",
      "type": "multiple-choice" | "fill-in" | "step-by-step",
      "difficulty": 1-10,
      "topic": "Hauptthema",
      "subtopic": "Unterthema",
      "question": "Die Frage (nutze LaTeX für Formeln: $...$)",
      "hints": [
        {"level": 1, "text": "Erster Hinweis"},
        {"level": 2, "text": "Zweiter Hinweis"},
        {"level": 3, "text": "Dritter Hinweis"}
      ],
      "solution": "Die Lösung",
      "explanation": "Ausführliche Erklärung mit Lösungsweg",
      "afbLevel": "${afbLevel}",
      "requiresGeogebra": false
    }
  ]
}`;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleGenerateQuestions(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<GenerateQuestionsRequest>();

    // Validate required fields
    const { apiKey, userId, topics, userContext } = body;
    if (!apiKey || !userId || !topics || !userContext) {
      throw new APIError('Missing required fields: apiKey, userId, topics, userContext', 400);
    }

    // Extract parameters with defaults
    const provider = body.provider || 'claude';
    const afbLevel = body.afbLevel || 'II';
    const questionCount = body.questionCount || 20;
    const useCache = body.useCache !== false;
    const forceRegenerate = body.forceRegenerate || false;
    const learningPlanItemId = body.learningPlanItemId;
    const selectedModel = body.selectedModel;
    const complexity = body.complexity;
    const firebaseConfig = body.firebaseConfig;

    console.log('[generate-questions] Request:', {
      userId,
      provider,
      afbLevel,
      questionCount,
      topicCount: topics.length,
    });

    // ========================================================================
    // PHASE 1: Firestore Cache Lookup
    // ========================================================================

    const cacheKey = generateCacheKey(topics, afbLevel, 5);

    if (useCache && !forceRegenerate && firebaseConfig) {
      try {
        const firebaseUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/question_cache/${cacheKey}`;

        const cacheResponse = await fetch(firebaseUrl, {
          headers: {
            Authorization: `Bearer ${firebaseConfig.accessToken}`,
          },
        });

        if (cacheResponse.ok) {
          const cacheData: any = await cacheResponse.json();
          if (cacheData.fields?.questions?.arrayValue?.values) {
            const cachedQuestions = cacheData.fields.questions.arrayValue.values.map(
              (v: any) => JSON.parse(v.stringValue || '{}')
            );

            // Check if cache is still valid (< 7 days old)
            const cachedAt = cacheData.fields?.cachedAt?.timestampValue;
            if (cachedAt) {
              const cacheAge = Date.now() - new Date(cachedAt).getTime();
              const sevenDays = 7 * 24 * 60 * 60 * 1000;
              if (cacheAge < sevenDays) {
                console.log(
                  `[Cache Hit] Returning ${cachedQuestions.length} cached questions for key: ${cacheKey}`
                );

                const sessionId = `session_${Date.now()}_${userId.substring(0, 8)}`;
                return c.json({
                  success: true,
                  sessionId,
                  learningPlanItemId,
                  topics,
                  userContext,
                  questions: cachedQuestions,
                  totalQuestions: cachedQuestions.length,
                  fromCache: true,
                  cacheKey,
                });
              }
            }
          }
        }
      } catch (cacheError) {
        console.warn('[Cache] Error fetching from cache:', cacheError);
      }
    }

    // ========================================================================
    // PHASE 2: Model Router - Select optimal model
    // ========================================================================

    const hasGeoGebra = topics.some(
      (t) =>
        t.thema?.toLowerCase().includes('geometrie') ||
        t.thema?.toLowerCase().includes('funktion') ||
        t.unterthema?.toLowerCase().includes('graph')
    );

    const isNumericOnly = topics.every(
      (t) =>
        t.thema?.toLowerCase().includes('rechnen') ||
        t.thema?.toLowerCase().includes('arithmetik')
    );

    const model = selectModel(
      provider,
      {
        afbLevel,
        hasGeoGebra,
        questionCount,
        isNumericOnly,
      },
      selectedModel
    );

    console.log(
      `[Model Router] Selected ${model} for ${provider} (AFB: ${afbLevel}, GeoGebra: ${hasGeoGebra}, Count: ${questionCount})`
    );

    // ========================================================================
    // PHASE 3: Build prompt and call AI
    // ========================================================================

    const prompt = buildPrompt(topics, userContext, afbLevel, questionCount);
    const temperature = userContext.autoModeAssessment?.currentAssessment?.temperature || 0.7;

    const responseText = await callAIProvider({
      provider,
      apiKey,
      model,
      prompt,
      temperature,
      maxTokens: 16000,
    });

    // Parse JSON response
    let questionsData: any;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        questionsData = JSON.parse(jsonMatch[0]);
      } else {
        questionsData = JSON.parse(responseText);
      }
    } catch (parseError) {
      throw new APIError(
        `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
        500
      );
    }

    // ========================================================================
    // PHASE 4: Store in Firestore Cache
    // ========================================================================

    if (useCache && firebaseConfig && questionsData.questions?.length > 0) {
      try {
        const firebaseUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/question_cache/${cacheKey}`;

        const cacheDocument = {
          fields: {
            cacheKey: { stringValue: cacheKey },
            topics: { stringValue: JSON.stringify(topics) },
            afbLevel: { stringValue: afbLevel },
            questionCount: { integerValue: questionsData.questions.length },
            questions: {
              arrayValue: {
                values: questionsData.questions.map((q: any) => ({
                  stringValue: JSON.stringify(q),
                })),
              },
            },
            cachedAt: { timestampValue: new Date().toISOString() },
            model: { stringValue: model },
            provider: { stringValue: provider },
          },
        };

        await fetch(firebaseUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${firebaseConfig.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(cacheDocument),
        });

        console.log(`[Cache Store] Stored ${questionsData.questions.length} questions with key: ${cacheKey}`);
      } catch (cacheStoreError) {
        console.warn('[Cache] Error storing to cache:', cacheStoreError);
      }
    }

    // ========================================================================
    // PHASE 5: Return response
    // ========================================================================

    const sessionId = `session_${Date.now()}_${userId.substring(0, 8)}`;

    return c.json({
      success: true,
      sessionId,
      learningPlanItemId,
      topics,
      userContext,
      questions: questionsData.questions,
      totalQuestions: questionsData.questions.length,
      fromCache: false,
      cacheKey,
      modelUsed: model,
      providerUsed: provider,
    });
  } catch (error) {
    console.error('[generate-questions] Error:', error);

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
