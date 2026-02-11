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
import type { Topic, UserContext, QuestionSession, Question, QuestionOption, QuestionHint, StepByStepData } from '../types';
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

  return `Du bist ein erfahrener Mathematiklehrer für die ${userContext.gradeLevel}. Klasse (${userContext.courseType}).

THEMEN:
${topicsList}

SCHÜLER-KONTEXT:
- Klassenstufe: ${userContext.gradeLevel}
- Kurs: ${userContext.courseType}
${strugglingTopicsText}

${autoModeText}

${complexityInstructions}

Generiere ${questionCount} mathematische Fragen zu den angegebenen Themen.

ERLAUBTE FRAGETYPEN (NUR diese beiden):
1. "multiple-choice" - Genau 4 Antwortmöglichkeiten (A, B, C, D), genau eine davon korrekt
2. "step-by-step" - Zwei Varianten:
   a) "next-action": Präsentiere ein mathematisches Szenario und frage nach dem nächsten Schritt (Multiple Choice für jeden Schritt)
   b) "sort-steps": Gib durchmischte Lösungsschritte, die der Schüler in die richtige Reihenfolge bringen muss

PFLICHTFELDER FÜR JEDE FRAGE:
- "correctFeedback": Lobende, ermutigende Nachricht bei korrekter Antwort (auf Deutsch)
- "incorrectFeedback": Erklärende Nachricht bei falscher Antwort mit Hinweis auf den Fehler (auf Deutsch)
- "hints": GENAU 3 Hinweise, progressiv hilfreicher:
  - Hinweis 1 (id: "h1"): Sanfter Anstoß in die richtige Richtung
  - Hinweis 2 (id: "h2"): Spezifischere Anleitung
  - Hinweis 3 (id: "h3"): Fast vollständiger Lösungsweg

Nutze LaTeX für mathematische Formeln: $...$

WICHTIG: Antworte NUR mit einem JSON-Objekt (kein zusätzlicher Text, kein Markdown-Code-Block).

FORMAT FÜR "multiple-choice" Fragen:
{
  "id": "q1",
  "type": "multiple-choice",
  "difficulty": 1-10,
  "topic": "Hauptthema",
  "subtopic": "Unterthema",
  "question": "Die Fragestellung",
  "solution": "Die korrekte Lösung",
  "explanation": "Ausführliche Erklärung des Lösungswegs",
  "correctFeedback": "Perfekt! Du hast den Zusammenhang zwischen...",
  "incorrectFeedback": "Nicht ganz. Der Fehler liegt darin, dass...",
  "hints": [
    {"id": "h1", "text": "Sanfter Hinweis..."},
    {"id": "h2", "text": "Spezifischer Hinweis..."},
    {"id": "h3", "text": "Fast die Lösung..."}
  ],
  "options": [
    {"id": "a", "text": "Option A", "isCorrect": false},
    {"id": "b", "text": "Option B", "isCorrect": true},
    {"id": "c", "text": "Option C", "isCorrect": false},
    {"id": "d", "text": "Option D", "isCorrect": false}
  ]
}

FORMAT FÜR "step-by-step" Fragen (sort-steps):
{
  "id": "q2",
  "type": "step-by-step",
  "difficulty": 1-10,
  "topic": "Hauptthema",
  "subtopic": "Unterthema",
  "question": "Löse die Aufgabe, indem du die Schritte sortierst",
  "solution": "Die vollständige Lösung",
  "explanation": "Ausführliche Erklärung",
  "correctFeedback": "Ausgezeichnet! Du hast die Schritte perfekt gemeistert!",
  "incorrectFeedback": "Leider nicht richtig. Schaue dir die Reihenfolge nochmal an...",
  "hints": [
    {"id": "h1", "text": "Sanfter Hinweis..."},
    {"id": "h2", "text": "Spezifischer Hinweis..."},
    {"id": "h3", "text": "Fast die Lösung..."}
  ],
  "stepByStepData": {
    "type": "sort-steps",
    "steps": [
      {"id": "s1", "text": "Erster Schritt"},
      {"id": "s2", "text": "Zweiter Schritt"},
      {"id": "s3", "text": "Dritter Schritt"},
      {"id": "s4", "text": "Vierter Schritt"}
    ],
    "correctOrder": ["s1", "s2", "s3", "s4"]
  }
}

FORMAT FÜR "step-by-step" Fragen (next-action):
{
  "id": "q3",
  "type": "step-by-step",
  "difficulty": 1-10,
  "topic": "Hauptthema",
  "subtopic": "Unterthema",
  "question": "Was würdest du als nächstes tun?",
  "solution": "Die vollständige Lösung",
  "explanation": "Ausführliche Erklärung",
  "correctFeedback": "Genau richtig! Das war der optimale nächste Schritt!",
  "incorrectFeedback": "Das ist leider nicht der beste nächste Schritt...",
  "hints": [
    {"id": "h1", "text": "Sanfter Hinweis..."},
    {"id": "h2", "text": "Spezifischer Hinweis..."},
    {"id": "h3", "text": "Fast die Lösung..."}
  ],
  "stepByStepData": {
    "type": "next-action",
    "steps": [
      {"id": "s1", "text": "Mögliche Aktion A"},
      {"id": "s2", "text": "Mögliche Aktion B"},
      {"id": "s3", "text": "Mögliche Aktion C"},
      {"id": "s4", "text": "Mögliche Aktion D"}
    ],
    "correctOrder": ["s2"]
  }
}

REGELN:
- Generiere eine gute Mischung aus "multiple-choice" und "step-by-step" Fragen
- Bei step-by-step: Verwende abwechselnd "sort-steps" und "next-action"
- KEINE anderen Fragetypen als "multiple-choice" und "step-by-step"
- IDs müssen eindeutig sein (q1, q2, q3, ...)
- Bei multiple-choice: IMMER genau 4 Optionen mit genau einer korrekten
- Bei sort-steps: Die steps-Liste soll BEREITS GEMISCHT sein, correctOrder gibt die richtige Reihenfolge an
- Bei next-action: steps enthält die Wahlmöglichkeiten, correctOrder enthält die ID der korrekten Aktion
- Alle Texte auf Deutsch
- Schwierigkeitsgrad an AFB-Level ${afbLevel} anpassen

Antworte mit genau diesem Format:
{
  "questions": [...]
}`;
}

// ============================================================================
// QUESTION VALIDATION & NORMALIZATION
// ============================================================================

function validateAndNormalizeQuestion(q: any, index: number): Question | null {
  try {
    const id = q.id || `q${index + 1}`;
    const type = q.type;

    // Only allow multiple-choice and step-by-step
    if (type !== 'multiple-choice' && type !== 'step-by-step') {
      console.warn(`[Validation] Skipping question ${id}: invalid type "${type}"`);
      return null;
    }

    // Validate required base fields
    if (!q.question || !q.solution) {
      console.warn(`[Validation] Skipping question ${id}: missing question or solution`);
      return null;
    }

    // Normalize hints: ensure exactly 3 hints with id format
    const hints: QuestionHint[] = normalizeHints(q.hints);

    // Ensure correctFeedback and incorrectFeedback exist
    const correctFeedback = q.correctFeedback || 'Richtig! Gut gemacht!';
    const incorrectFeedback = q.incorrectFeedback || 'Leider nicht richtig. Versuche es nochmal.';

    // Build base question
    const baseQuestion: Question = {
      id,
      type,
      difficulty: Math.min(10, Math.max(1, Number(q.difficulty) || 5)),
      topic: q.topic || 'Mathematik',
      subtopic: q.subtopic || '',
      question: q.question,
      solution: q.solution,
      explanation: q.explanation || '',
      correctFeedback,
      incorrectFeedback,
      hints,
    };

    // Type-specific validation
    if (type === 'multiple-choice') {
      const options = normalizeMultipleChoiceOptions(q.options);
      if (!options) {
        console.warn(`[Validation] Skipping question ${id}: invalid multiple-choice options`);
        return null;
      }
      baseQuestion.options = options;
    } else if (type === 'step-by-step') {
      const stepByStepData = normalizeStepByStepData(q.stepByStepData);
      if (!stepByStepData) {
        console.warn(`[Validation] Skipping question ${id}: invalid step-by-step data`);
        return null;
      }
      baseQuestion.stepByStepData = stepByStepData;
    }

    return baseQuestion;
  } catch (err) {
    console.warn(`[Validation] Error processing question at index ${index}:`, err);
    return null;
  }
}

function normalizeHints(hints: any): QuestionHint[] {
  const defaultHints: QuestionHint[] = [
    { id: 'h1', text: 'Überlege dir, welcher Ansatz hier sinnvoll ist.' },
    { id: 'h2', text: 'Versuche, die Aufgabe Schritt für Schritt zu lösen.' },
    { id: 'h3', text: 'Schaue dir die Formel noch einmal genau an.' },
  ];

  if (!hints || !Array.isArray(hints) || hints.length === 0) {
    return defaultHints;
  }

  // Normalize each hint to have id and text
  const normalizedHints: QuestionHint[] = hints
    .slice(0, 3)
    .map((h: any, i: number) => ({
      id: h.id || `h${i + 1}`,
      text: h.text || (typeof h === 'string' ? h : `Hinweis ${i + 1}`),
    }));

  // Pad to exactly 3 hints if fewer were provided
  while (normalizedHints.length < 3) {
    const idx = normalizedHints.length;
    normalizedHints.push(defaultHints[idx] || { id: `h${idx + 1}`, text: `Hinweis ${idx + 1}` });
  }

  return normalizedHints;
}

function normalizeMultipleChoiceOptions(options: any): QuestionOption[] | null {
  if (!options || !Array.isArray(options) || options.length < 2) {
    return null;
  }

  const optionIds = ['a', 'b', 'c', 'd'];

  // Normalize to exactly 4 options
  const normalized: QuestionOption[] = options.slice(0, 4).map((opt: any, i: number) => ({
    id: opt.id || optionIds[i] || `opt${i + 1}`,
    text: opt.text || `Option ${i + 1}`,
    isCorrect: Boolean(opt.isCorrect),
  }));

  // Pad with dummy options if fewer than 4
  while (normalized.length < 4) {
    const idx = normalized.length;
    normalized.push({
      id: optionIds[idx] || `opt${idx + 1}`,
      text: `Option ${String.fromCharCode(65 + idx)}`,
      isCorrect: false,
    });
  }

  // Ensure exactly one correct option
  const correctCount = normalized.filter((o) => o.isCorrect).length;
  if (correctCount === 0) {
    // Mark the first option as correct if none is marked
    normalized[0].isCorrect = true;
  } else if (correctCount > 1) {
    // Keep only the first correct option
    let foundFirst = false;
    for (const opt of normalized) {
      if (opt.isCorrect) {
        if (foundFirst) {
          opt.isCorrect = false;
        } else {
          foundFirst = true;
        }
      }
    }
  }

  return normalized;
}

function normalizeStepByStepData(data: any): StepByStepData | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const type = data.type === 'next-action' ? 'next-action' : 'sort-steps';

  if (!data.steps || !Array.isArray(data.steps) || data.steps.length < 2) {
    return null;
  }

  const steps = data.steps.map((s: any, i: number) => ({
    id: s.id || `s${i + 1}`,
    text: s.text || `Schritt ${i + 1}`,
  }));

  // Validate correctOrder
  let correctOrder: string[];
  if (data.correctOrder && Array.isArray(data.correctOrder) && data.correctOrder.length > 0) {
    correctOrder = data.correctOrder.map((id: any) => String(id));
  } else {
    // Default: use steps in their given order for sort-steps, first step for next-action
    if (type === 'next-action') {
      correctOrder = [steps[0].id];
    } else {
      correctOrder = steps.map((s: any) => s.id);
    }
  }

  return { type, steps, correctOrder };
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

    // Validate and normalize questions to the new format
    if (questionsData.questions && Array.isArray(questionsData.questions)) {
      questionsData.questions = questionsData.questions
        .map((q: any, index: number) => validateAndNormalizeQuestion(q, index))
        .filter((q: any) => q !== null);
    }

    if (!questionsData.questions || questionsData.questions.length === 0) {
      throw new APIError('AI response contained no valid questions after validation', 500);
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
