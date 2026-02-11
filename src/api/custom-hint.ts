/**
 * Custom Hint Endpoint
 * Generates personalized, progressive hints for students using AI
 *
 * Features:
 * - Multi-provider support (Claude, Gemini)
 * - Progressive hint specificity based on hintsUsed count
 * - Misconception-aware hints when userAnswer is provided
 * - German language hints for math context
 * - Never gives away the answer directly
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CustomHintRequest {
  question: string;
  userAnswer?: string;
  hintsUsed?: number;
  apiKey?: string;
  provider?: 'claude' | 'gemini';
  selectedModel?: string;
  solution?: string;
  topic?: string;
  difficulty?: number;
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

function buildHintPrompt(
  question: string,
  userAnswer?: string,
  hintsUsed?: number,
  solution?: string,
  topic?: string,
  difficulty?: number,
): string {
  const hintLevel = hintsUsed || 0;

  const hintLevelDescription =
    hintLevel === 0
      ? 'STUFE 1 (Sanfter Hinweis): Gib einen allgemeinen Denkanstoß. Nenne die relevante mathematische Methode oder das Konzept, ohne konkrete Schritte zu verraten.'
      : hintLevel === 1
      ? 'STUFE 2 (Spezifischer Hinweis): Gib einen konkreteren Hinweis. Beschreibe den ersten Lösungsschritt oder die wichtigste Formel, die angewendet werden muss.'
      : 'STUFE 3 (Detaillierter Hinweis): Gib einen sehr detaillierten Hinweis. Führe den Schüler fast bis zur Lösung, zeige den Lösungsweg bis auf den letzten Schritt. Verrate aber NICHT die endgültige Antwort.';

  const userAnswerContext = userAnswer
    ? `\nDer Schüler hat folgende (falsche) Antwort gegeben: "${userAnswer}"\nGehe auf den spezifischen Fehler oder das Missverständnis ein und erkläre, warum dieser Ansatz nicht funktioniert.`
    : '';

  const solutionContext = solution
    ? `\nDie korrekte Lösung lautet: "${solution}" (NIEMALS direkt verraten!)`
    : '';

  const topicContext = topic
    ? `\nThemengebiet: ${topic}`
    : '';

  const difficultyContext = difficulty
    ? `\nSchwierigkeitsgrad: ${difficulty}/10`
    : '';

  return `Du bist ein erfahrener und einfühlsamer Mathematik-Tutor. Ein Schüler braucht Hilfe bei folgender Aufgabe.

AUFGABE: ${question}
${topicContext}${difficultyContext}${solutionContext}${userAnswerContext}

HINWEIS-LEVEL:
${hintLevelDescription}

Bisherige Hinweise erhalten: ${hintLevel}

REGELN:
- Antworte auf Deutsch
- Verwende LaTeX-Notation für mathematische Ausdrücke: $...$
- Sei ermutigend und unterstützend
- Gib NIEMALS die vollständige Lösung oder Antwort direkt preis
- Passe die Detailtiefe an die Hinweis-Stufe an
- Wenn der Schüler eine falsche Antwort gegeben hat, gehe auf seinen spezifischen Fehler ein
- Halte den Hinweis kurz und prägnant (2-4 Sätze)

WICHTIG: Antworte NUR mit einem JSON-Objekt (kein zusätzlicher Text, kein Markdown-Code-Block).

{
  "hint": "Dein Hinweis hier..."
}`;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleCustomHint(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<CustomHintRequest>();

    // Validate required fields
    const { question, apiKey, userAnswer, hintsUsed, selectedModel, solution, topic, difficulty } = body;
    if (!question) {
      throw new APIError('Missing required field: question', 400);
    }

    if (!apiKey) {
      throw new APIError('Missing required field: apiKey', 400);
    }

    // Determine provider and model
    // Use the light model for hints since they are short responses
    const provider = body.provider || 'claude';
    const model = selectedModel || MODEL_TIERS[provider]?.light || MODEL_TIERS.claude.light;

    console.log(`[custom-hint] Request: provider=${provider}, model=${model}, hintsUsed=${hintsUsed || 0}, hasUserAnswer=${!!userAnswer}`);

    // Build prompt and call AI
    const prompt = buildHintPrompt(question, userAnswer, hintsUsed, solution, topic, difficulty);

    const responseText = await callAIProvider({
      provider,
      apiKey,
      model,
      prompt,
      temperature: 0.6,
      maxTokens: 1000,
    });

    // Parse the AI response
    let hint = '';

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        hint = parsed.hint || '';
      } else {
        throw new Error('No JSON object found in response');
      }
    } catch (parseError) {
      // Fallback: use the raw response text as the hint
      console.warn('[custom-hint] JSON parse failed, using raw response');

      // Clean up the response: remove markdown formatting if present
      hint = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .replace(/^\s*\{[\s\S]*"hint"\s*:\s*"/, '')
        .replace(/"\s*\}\s*$/, '')
        .trim();

      // If still empty, use the full response
      if (!hint) {
        hint = responseText.trim();
      }
    }

    if (!hint) {
      throw new APIError('AI response did not contain a valid hint', 500);
    }

    console.log(`[custom-hint] Success: hint length=${hint.length} chars`);

    return c.json({
      success: true,
      hint,
    });
  } catch (error) {
    console.error('[custom-hint] Error:', error);

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
