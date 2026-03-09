/**
 * Update Auto Mode Endpoint
 * Adaptive difficulty adjustment based on performance
 *
 * Features:
 * - Analyzes recent performance data
 * - Adjusts AI parameters (temperature, detail level)
 * - Recommends difficulty changes
 * - Provides learning insights
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';
import { callAI, getTaskModelConfig } from '../utils/callAI';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface UpdateAutoModeRequest {
  userId: string;
  currentSettings: AutoModeSettings;
  recentPerformance: PerformanceRecord[];
}

interface AutoModeSettings {
  detailLevel: number; // 0-100
  temperature: number; // 0.0-1.0
  helpfulness: number; // 0-100
  targetDifficulty: number; // 1-10
}

interface PerformanceRecord {
  questionId: string;
  difficulty: number;
  isCorrect: boolean;
  hintsUsed: number;
  timeSpent: number; // seconds
  topic: string;
  timestamp: string;
}

interface AutoModeAssessment {
  currentAssessment: AutoModeSettings;
  reasoning: string;
  trend: 'improving' | 'stable' | 'declining';
  recommendations: string[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculatePerformanceMetrics(performance: PerformanceRecord[]) {
  if (performance.length === 0) {
    return {
      accuracy: 0,
      averageHints: 0,
      averageTime: 0,
      difficultyProgression: 0,
      consistency: 0,
    };
  }

  const correct = performance.filter((p) => p.isCorrect).length;
  const accuracy = (correct / performance.length) * 100;

  const totalHints = performance.reduce((sum, p) => sum + p.hintsUsed, 0);
  const averageHints = totalHints / performance.length;

  const totalTime = performance.reduce((sum, p) => sum + p.timeSpent, 0);
  const averageTime = totalTime / performance.length;

  // Calculate difficulty progression (are they attempting harder questions?)
  const sortedByTime = [...performance].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const firstHalf = sortedByTime.slice(0, Math.floor(sortedByTime.length / 2));
  const secondHalf = sortedByTime.slice(Math.floor(sortedByTime.length / 2));
  
  const firstHalfDiff = firstHalf.reduce((sum, p) => sum + p.difficulty, 0) / firstHalf.length || 0;
  const secondHalfDiff = secondHalf.reduce((sum, p) => sum + p.difficulty, 0) / secondHalf.length || 0;
  const difficultyProgression = secondHalfDiff - firstHalfDiff;

  // Calculate consistency (standard deviation of accuracy)
  const chunkSize = Math.max(1, Math.floor(performance.length / 3));
  const chunks = [];
  for (let i = 0; i < performance.length; i += chunkSize) {
    chunks.push(performance.slice(i, i + chunkSize));
  }
  
  const chunkAccuracies = chunks.map((chunk) => {
    const c = chunk.filter((p) => p.isCorrect).length;
    return (c / chunk.length) * 100;
  });
  
  const avgAccuracy = chunkAccuracies.reduce((a, b) => a + b, 0) / chunkAccuracies.length;
  const variance = chunkAccuracies.reduce((sum, a) => sum + Math.pow(a - avgAccuracy, 2), 0) / chunkAccuracies.length;
  const consistency = Math.max(0, 100 - Math.sqrt(variance));

  return {
    accuracy: Math.round(accuracy * 10) / 10,
    averageHints: Math.round(averageHints * 10) / 10,
    averageTime: Math.round(averageTime),
    difficultyProgression: Math.round(difficultyProgression * 10) / 10,
    consistency: Math.round(consistency),
  };
}

function buildPrompt(
  currentSettings: AutoModeSettings,
  performance: PerformanceRecord[],
  metrics: ReturnType<typeof calculatePerformanceMetrics>
): string {
  const performanceText = performance
    .slice(-10) // Last 10 records
    .map(
      (p) =>
        `- ${p.topic} (Difficulty ${p.difficulty}): ${p.isCorrect ? 'Correct' : 'Incorrect'}, ${p.hintsUsed} hints, ${p.timeSpent}s`
    )
    .join('\n');

  return `Du bist ein Experte für adaptives Lernen und Lernanalytik.

AKTUELLE EINSTELLUNGEN:
- Detailgrad: ${currentSettings.detailLevel}%
- Temperatur (Kreativität): ${currentSettings.temperature}
- Hilfestellungsgrad: ${currentSettings.helpfulness}%
- Ziel-Schwierigkeit: ${currentSettings.targetDifficulty}/10

LEISTUNGSMETRIKEN (letzte ${performance.length} Fragen):
- Genauigkeit: ${metrics.accuracy}%
- Durchschnittliche Hinweise: ${metrics.averageHints}
- Durchschnittliche Zeit: ${metrics.averageTime}s
- Schwierigkeitsprogression: ${metrics.difficultyProgression > 0 ? '+' : ''}${metrics.difficultyProgression}
- Konsistenz: ${metrics.consistency}%

DETAILLIERTE LEISTUNGSDATEN:
${performanceText || 'Keine Daten verfügbar'}

AUFGABE:
Analysiere die Leistungsdaten und passe die AUTO-Modus Einstellungen an.

RICHTLINIEN:
1. Wenn Genauigkeit > 85% und Konsistenz > 70%: Erhöhe Schwierigkeit, verringere Hilfestellung
2. Wenn Genauigkeit < 60% oder Konsistenz < 50%: Verringere Schwierigkeit, erhöhe Hilfestellung
3. Wenn viele Hinweise verwendet werden: Erhöhe Hilfestellungsgrad
4. Wenn durchschnittliche Zeit zu hoch: Erhöhe Detailgrad für klarere Erklärungen
5. Temperatur anpassen basierend auf Fortschritt (fortgeschritten = kreativer)

ANTWORTFORMAT - JSON:
{
  "currentAssessment": {
    "detailLevel": 0-100,
    "temperature": 0.0-1.0,
    "helpfulness": 0-100,
    "targetDifficulty": 1-10
  },
  "reasoning": "Detaillierte Erklärung der Anpassungen auf Deutsch",
  "trend": "improving|stable|declining",
  "recommendations": [
    "Empfehlung 1 für den Schüler",
    "Empfehlung 2 für den Schüler"
  ]
}

WICHTIG: Antworte NUR mit dem JSON-Objekt.`;
}

function extractJSONFromResponse(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Continue
    }
  }
  
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Could not parse JSON from AI response');
  }
}

function validateAssessment(data: any): AutoModeAssessment {
  if (!data.currentAssessment) {
    throw new APIError('Invalid response: missing currentAssessment', 500);
  }

  const assessment = data.currentAssessment;
  
  return {
    currentAssessment: {
      detailLevel: Math.max(0, Math.min(100, Math.round(assessment.detailLevel || 50))),
      temperature: Math.max(0, Math.min(1, Math.round((assessment.temperature || 0.7) * 10) / 10)),
      helpfulness: Math.max(0, Math.min(100, Math.round(assessment.helpfulness || 50))),
      targetDifficulty: Math.max(1, Math.min(10, Math.round(assessment.targetDifficulty || 5))),
    },
    reasoning: data.reasoning || 'Einstellungen angepasst basierend auf Leistungsanalyse',
    trend: ['improving', 'stable', 'declining'].includes(data.trend) ? data.trend : 'stable',
    recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleUpdateAutoMode(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<Partial<UpdateAutoModeRequest>>();

    // Validate required fields
    const { userId, currentSettings, recentPerformance } = body;
    
    if (!userId) {
      throw new APIError('Missing required field: userId', 400);
    }
    if (!currentSettings) {
      throw new APIError('Missing required field: currentSettings', 400);
    }

    const performance = recentPerformance || [];

    console.log('[update-auto-mode] Request:', {
      userId,
      performanceCount: performance.length,
    });

    // =======================================================================
    // PHASE 1: Calculate metrics locally
    // =======================================================================

    const metrics = calculatePerformanceMetrics(performance);
    console.log('[update-auto-mode] Metrics:', metrics);

    // If no performance data, return current settings with default reasoning
    if (performance.length === 0) {
      return c.json({
        success: true,
        currentAssessment: currentSettings,
        reasoning: 'Noch nicht genügend Daten für eine Analyse. Standard-Einstellungen beibehalten.',
        trend: 'stable',
        recommendations: ['Bearbeite einige Fragen, um personalisierte Einstellungen zu erhalten'],
        metrics,
      });
    }

    // =======================================================================
    // PHASE 2: Get task configuration from models.json
    // =======================================================================

    const taskConfig = await getTaskModelConfig('updateAutoMode');
    console.log(`[Model Router] Using ${taskConfig.model} for updateAutoMode task`);

    const prompt = buildPrompt(currentSettings, performance, metrics);

    // =======================================================================
    // PHASE 3: Call AI for assessment
    // =======================================================================

    const responseText = await callAI({
      provider: taskConfig.provider,
      model: taskConfig.model,
      prompt,
      temperature: taskConfig.temperature,
      maxTokens: taskConfig.maxTokens,
      systemPrompt: taskConfig.systemPrompt,
      env: c.env,
    });

    // =======================================================================
    // PHASE 4: Parse and validate response
    // =======================================================================

    let assessmentData: any;
    try {
      assessmentData = extractJSONFromResponse(responseText);
    } catch (parseError) {
      console.error('[update-auto-mode] Parse error:', parseError);
      console.error('[update-auto-mode] Raw response:', responseText.substring(0, 500));
      throw new APIError('Failed to parse AI response as JSON', 500);
    }

    const assessment = validateAssessment(assessmentData);

    console.log('[update-auto-mode] Success:', {
      trend: assessment.trend,
      newDifficulty: assessment.currentAssessment.targetDifficulty,
    });

    // =======================================================================
    // PHASE 5: Return response
    // =======================================================================

    return c.json({
      success: true,
      ...assessment,
      metrics,
      modelUsed: taskConfig.model,
      providerUsed: taskConfig.provider,
    });

  } catch (error) {
    console.error('[update-auto-mode] Error:', error);

    if (error instanceof APIError) {
      return c.json({ success: false, error: error.message }, error.statusCode as any);
    }

    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const status = errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate') ? 429 : 500;
    return c.json({ success: false, error: errMsg }, status as any);
  }
}
