/**
 * Evaluate Answer Endpoint
 * Migrated from functions/api/evaluate-answer.js
 *
 * Features:
 * - Semantic math equivalence checking (x+1 = 1+x)
 * - Numeric equivalence (1/2 = 0.5)
 * - Algebraic expression parsing
 * - Misconception detection (7 types)
 * - XP calculation with bonuses/penalties
 * - Coin calculation with multipliers
 * - Streak freeze support
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface EvaluateAnswerRequest {
  apiKey: string;
  userId: string;
  questionId: string;
  questionData: QuestionData;
  userAnswer: string | string[] | { [key: number]: string };
  hintsUsed?: number;
  timeSpent?: number;
  skipped?: boolean;
  correctStreak?: number;
  streakFreezeAvailable?: boolean;
  isFirstQuestionToday?: boolean;
  dailyStreak?: number;
}

interface QuestionData {
  type: 'multiple-choice' | 'step-by-step' | 'free-form' | 'numeric';
  difficulty: number;
  explanation?: string;
  correctAnswer?: string;
  expectedAnswer?: string;
  tolerance?: number;
  options?: Array<{
    id: string;
    text: string;
    isCorrect?: boolean;
  }>;
  steps?: Array<{
    stepNumber: number;
    expectedAnswer: string;
    tolerance?: number;
  }>;
}

interface EquivalenceResult {
  isEquivalent: boolean;
  method: 'exact' | 'numeric' | 'algebraic' | 'none';
  userValue?: number;
  expectedValue?: number;
  isClose?: boolean;
}

interface Misconception {
  id: string;
  name: string;
  description: string;
  hint: string;
}

interface MisconceptionPattern extends Misconception {
  check: (userAnswer: string, expectedAnswer: string) => boolean;
}

interface StepResult {
  stepNumber: number;
  correct: boolean;
  expected: string;
  actual: string;
  equivalenceMethod: string;
  isClose: boolean;
  misconceptions: Misconception[];
}

interface XPBreakdown {
  base: number;
  hintPenalty: number;
  timePenalty: number;
  timeBonus?: number;
  streakBonus?: number;
  equivalenceBonus?: number;
  total: number;
}

interface CoinBreakdown {
  base: number;
  multiplier: number;
  bonuses?: Array<{ type: string; bonus: string }>;
  total: number;
}

// ============================================================================
// SEMANTIC MATH EVALUATION ENGINE
// ============================================================================

/**
 * Normalize a mathematical expression for comparison
 * Handles fractions, decimals, and basic algebraic expressions
 */
function normalizeExpression(expr: string | number | null | undefined): string {
  if (expr === null || expr === undefined) return '';

  let normalized = String(expr).trim().toLowerCase();

  // Remove unnecessary spaces
  normalized = normalized.replace(/\s+/g, '');

  // Normalize common symbols
  normalized = normalized
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/·/g, '*')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi');

  // Remove leading '+' signs
  normalized = normalized.replace(/^\+/, '');

  // Normalize implicit multiplication (2x -> 2*x)
  normalized = normalized.replace(/(\d)([a-z])/gi, '$1*$2');

  return normalized;
}

/**
 * Evaluate a mathematical expression to a numeric value
 * Returns null if expression cannot be evaluated numerically
 */
function evaluateToNumber(expr: string | number | null | undefined): number | null {
  try {
    const normalized = normalizeExpression(expr);

    // Handle common mathematical constants
    let evalExpr = normalized
      .replace(/pi/g, String(Math.PI))
      .replace(/e(?![a-z])/g, String(Math.E))
      .replace(/sqrt\(([^)]+)\)/g, (_, inner) => `Math.sqrt(${inner})`)
      .replace(/\^/g, '**');

    // Handle fractions like "1/2"
    if (/^-?\d+\/\d+$/.test(evalExpr)) {
      const [num, denom] = evalExpr.split('/');
      return parseFloat(num) / parseFloat(denom);
    }

    // Safe evaluation for simple numeric expressions
    if (/^[0-9+\-*/().eE\s]+$/.test(evalExpr) || /Math\.\w+/.test(evalExpr)) {
      // Use Function constructor for safe evaluation
      const result = new Function(`return ${evalExpr}`)();
      if (typeof result === 'number' && !isNaN(result)) {
        return result;
      }
    }

    // Try direct parsing
    const direct = parseFloat(normalized);
    if (!isNaN(direct)) return direct;

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse algebraic expression into coefficient-variable terms
 * Returns a map of {variable: coefficient}
 */
function parseAlgebraic(expr: string): Record<string, number> {
  const normalized = normalizeExpression(expr);
  const terms: Record<string, number> = {};

  // Split by + and - while keeping the signs
  const parts = normalized.split(/(?=[+-])/);

  for (const part of parts) {
    if (!part) continue;

    // Match coefficient and variable(s)
    const match = part.match(/^([+-]?\d*\.?\d*)\*?([a-z]*)(\^?\d*)?$/i);
    if (match) {
      let [, coefStr, variable, power] = match;
      const coef =
        coefStr === '' || coefStr === '+' ? 1 : coefStr === '-' ? -1 : parseFloat(coefStr);
      variable = variable || 'const';
      power = power ? power.replace('^', '') : '1';

      const key = variable === 'const' ? 'const' : `${variable}^${power}`;
      terms[key] = (terms[key] || 0) + coef;
    }
  }

  return terms;
}

/**
 * Check if two algebraic expressions are equivalent
 */
function checkAlgebraicEquivalence(expr1: string, expr2: string): boolean {
  const terms1 = parseAlgebraic(expr1);
  const terms2 = parseAlgebraic(expr2);

  // Get all unique keys
  const allKeys = new Set([...Object.keys(terms1), ...Object.keys(terms2)]);

  // Compare each term
  for (const key of allKeys) {
    const val1 = terms1[key] || 0;
    const val2 = terms2[key] || 0;
    if (Math.abs(val1 - val2) > 0.0001) {
      return false;
    }
  }

  return true;
}

/**
 * Main equivalence checker combining numeric and algebraic methods
 */
function checkEquivalence(
  userAnswer: string,
  expectedAnswer: string,
  options: { tolerance?: number; type?: string } = {}
): EquivalenceResult {
  const { tolerance = 0.0001, type = 'auto' } = options;

  // Normalize both answers
  const userNorm = normalizeExpression(userAnswer);
  const expectedNorm = normalizeExpression(expectedAnswer);

  // Direct string match after normalization
  if (userNorm === expectedNorm) {
    return { isEquivalent: true, method: 'exact' };
  }

  // Try numeric evaluation
  const userNum = evaluateToNumber(userAnswer);
  const expectedNum = evaluateToNumber(expectedAnswer);

  if (userNum !== null && expectedNum !== null) {
    if (Math.abs(userNum - expectedNum) <= tolerance) {
      return {
        isEquivalent: true,
        method: 'numeric',
        userValue: userNum,
        expectedValue: expectedNum,
      };
    }
    // Close but not within tolerance
    if (Math.abs(userNum - expectedNum) <= tolerance * 100) {
      return {
        isEquivalent: false,
        method: 'numeric',
        isClose: true,
        userValue: userNum,
        expectedValue: expectedNum,
      };
    }
  }

  // Try algebraic equivalence for expressions with variables
  if (/[a-z]/i.test(userNorm) && /[a-z]/i.test(expectedNorm)) {
    if (checkAlgebraicEquivalence(userNorm, expectedNorm)) {
      return { isEquivalent: true, method: 'algebraic' };
    }
  }

  return { isEquivalent: false, method: 'none' };
}

// ============================================================================
// MISCONCEPTION DETECTOR
// ============================================================================

/**
 * Common mathematical misconceptions and their detection patterns
 */
const MISCONCEPTIONS: MisconceptionPattern[] = [
  {
    id: 'sign_error',
    name: 'Vorzeichenfehler',
    description: 'Das Vorzeichen wurde verwechselt',
    check: (user, expected) => {
      const userNum = evaluateToNumber(user);
      const expectedNum = evaluateToNumber(expected);
      if (userNum !== null && expectedNum !== null) {
        return Math.abs(userNum + expectedNum) < 0.0001;
      }
      return false;
    },
    hint: 'Überprüfe die Vorzeichen in deiner Rechnung.',
  },
  {
    id: 'factor_error',
    name: 'Faktor vergessen',
    description: 'Ein Faktor wurde vergessen oder hinzugefügt',
    check: (user, expected) => {
      const userNum = evaluateToNumber(user);
      const expectedNum = evaluateToNumber(expected);
      if (userNum !== null && expectedNum !== null && expectedNum !== 0) {
        const ratio = userNum / expectedNum;
        return [2, 0.5, 10, 0.1, Math.PI, 1 / Math.PI].some(
          (factor) => Math.abs(ratio - factor) < 0.001
        );
      }
      return false;
    },
    hint: 'Überprüfe, ob du alle Faktoren berücksichtigt hast.',
  },
  {
    id: 'fraction_flip',
    name: 'Bruch umgekehrt',
    description: 'Zähler und Nenner wurden vertauscht',
    check: (user, expected) => {
      const userNum = evaluateToNumber(user);
      const expectedNum = evaluateToNumber(expected);
      if (userNum !== null && expectedNum !== null && userNum !== 0) {
        return Math.abs(userNum * expectedNum - 1) < 0.0001;
      }
      return false;
    },
    hint: 'Überprüfe, ob Zähler und Nenner in der richtigen Position sind.',
  },
  {
    id: 'order_of_operations',
    name: 'Rechenreihenfolge',
    description: 'Punkt vor Strich nicht beachtet',
    check: (user, expected) => {
      // This is hard to detect generically, check for common patterns
      return false;
    },
    hint: 'Denke an die Rechenreihenfolge: Klammern, Potenzen, Punkt vor Strich.',
  },
  {
    id: 'power_error',
    name: 'Potenzfehler',
    description: 'Fehler beim Potenzieren',
    check: (user, expected) => {
      const userNum = evaluateToNumber(user);
      const expectedNum = evaluateToNumber(expected);
      if (userNum !== null && expectedNum !== null && expectedNum > 0) {
        // Check if user squared instead of not, or vice versa
        return (
          Math.abs(userNum - Math.sqrt(expectedNum)) < 0.001 ||
          Math.abs(userNum - expectedNum * expectedNum) < 0.001
        );
      }
      return false;
    },
    hint: 'Überprüfe die Potenz- und Wurzeloperationen.',
  },
  {
    id: 'decimal_error',
    name: 'Kommafehler',
    description: 'Das Dezimalkomma wurde falsch gesetzt',
    check: (user, expected) => {
      const userNum = evaluateToNumber(user);
      const expectedNum = evaluateToNumber(expected);
      if (userNum !== null && expectedNum !== null && expectedNum !== 0) {
        const ratio = userNum / expectedNum;
        return [10, 100, 1000, 0.1, 0.01, 0.001].some(
          (factor) => Math.abs(ratio - factor) < 0.0001
        );
      }
      return false;
    },
    hint: 'Überprüfe die Position des Dezimalkommas.',
  },
  {
    id: 'unit_conversion',
    name: 'Einheitenfehler',
    description: 'Einheiten wurden nicht korrekt umgerechnet',
    check: (user, expected) => {
      const userNum = evaluateToNumber(user);
      const expectedNum = evaluateToNumber(expected);
      if (userNum !== null && expectedNum !== null && expectedNum !== 0) {
        const ratio = userNum / expectedNum;
        // Common unit conversion factors
        return [60, 1 / 60, 3600, 1 / 3600, 1000, 0.001, 100, 0.01].some(
          (factor) => Math.abs(ratio - factor) < 0.0001
        );
      }
      return false;
    },
    hint: 'Überprüfe, ob du alle Einheiten korrekt umgerechnet hast.',
  },
];

/**
 * Detect misconceptions in the user's answer
 */
function detectMisconceptions(userAnswer: string, expectedAnswer: string): Misconception[] {
  const detected: Misconception[] = [];

  for (const misconception of MISCONCEPTIONS) {
    try {
      if (misconception.check(userAnswer, expectedAnswer)) {
        detected.push({
          id: misconception.id,
          name: misconception.name,
          description: misconception.description,
          hint: misconception.hint,
        });
      }
    } catch {
      // Ignore check errors
    }
  }

  return detected;
}

// ============================================================================
// MAIN EVALUATION HANDLER
// ============================================================================

export async function handleEvaluateAnswer(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<EvaluateAnswerRequest>();
    const {
      questionData,
      userAnswer,
      hintsUsed,
      timeSpent,
      skipped,
      correctStreak,
      streakFreezeAvailable,
    } = body;

    // Validate required fields
    if (!questionData || userAnswer === undefined) {
      throw new APIError('Missing required fields: questionData, userAnswer', 400);
    }

    let isCorrect = false;
    let correctAnswer: string | string[] | null = null;
    let feedback = '';
    let equivalenceResult: EquivalenceResult | StepResult[] | null = null;
    let misconceptions: Misconception[] = [];

    // ========================================================================
    // PHASE 1: Evaluate based on question type
    // ========================================================================

    if (questionData.type === 'multiple-choice') {
      // Multiple Choice Evaluation
      correctAnswer = questionData.options?.find((opt) => opt.isCorrect)?.id || null;
      isCorrect = userAnswer === correctAnswer;

      if (isCorrect) {
        feedback = `Richtig! ${questionData.explanation || ''}`;
      } else {
        const userOption = questionData.options?.find((opt) => opt.id === userAnswer);
        feedback = `Leider falsch. Du hast "${
          userOption?.text || 'keine Antwort'
        }" gewählt. ${questionData.explanation || ''}`;
      }
    } else if (questionData.type === 'step-by-step') {
      // Step-by-Step Evaluation
      const stepResults: StepResult[] =
        questionData.steps?.map((step, index) => {
          const userStepAnswer = Array.isArray(userAnswer)
            ? userAnswer[index]
            : typeof userAnswer === 'object'
            ? (userAnswer as any)[index]
            : '';
          const expected = step.expectedAnswer;
          const tolerance = step.tolerance || 0.01;

          // Use semantic equivalence check
          const result = checkEquivalence(String(userStepAnswer), expected, { tolerance });

          // Detect misconceptions for wrong answers
          let stepMisconceptions: Misconception[] = [];
          if (!result.isEquivalent) {
            stepMisconceptions = detectMisconceptions(String(userStepAnswer), expected);
          }

          return {
            stepNumber: step.stepNumber,
            correct: result.isEquivalent,
            expected: expected,
            actual: String(userStepAnswer),
            equivalenceMethod: result.method,
            isClose: result.isClose || false,
            misconceptions: stepMisconceptions,
          };
        }) || [];

      isCorrect = stepResults.every((r) => r.correct);
      correctAnswer = questionData.steps?.map((s) => s.expectedAnswer) || [];

      // Collect all misconceptions
      misconceptions = stepResults.flatMap((r) => r.misconceptions);

      if (isCorrect) {
        feedback = `Alle Schritte korrekt! ${questionData.explanation || ''}`;
      } else {
        const wrongSteps = stepResults.filter((r) => !r.correct);
        const wrongStepNumbers = wrongSteps.map((r) => r.stepNumber);

        // Build detailed feedback
        let detailedFeedback = `Nicht alle Schritte waren korrekt. Fehler in Schritt(en): ${wrongStepNumbers.join(
          ', '
        )}. `;

        // Add misconception hints
        if (misconceptions.length > 0) {
          const uniqueMisconceptions = [
            ...new Map(misconceptions.map((m) => [m.id, m])).values(),
          ];
          detailedFeedback += '\n\nMögliche Fehlerquellen:\n';
          uniqueMisconceptions.forEach((m) => {
            detailedFeedback += `• ${m.name}: ${m.hint}\n`;
          });
        }

        // Add "close" feedback
        const closeSteps = wrongSteps.filter((r) => r.isClose);
        if (closeSteps.length > 0) {
          detailedFeedback += `\nBei Schritt ${closeSteps
            .map((r) => r.stepNumber)
            .join(', ')} warst du nahe dran!`;
        }

        detailedFeedback += `\n\n${questionData.explanation || ''}`;
        feedback = detailedFeedback;
      }

      equivalenceResult = stepResults;
    } else if (questionData.type === 'free-form' || questionData.type === 'numeric') {
      // Free-form or Numeric Evaluation
      const expected = questionData.correctAnswer || questionData.expectedAnswer || '';
      const tolerance = questionData.tolerance || 0.01;

      const result = checkEquivalence(String(userAnswer), expected, { tolerance });
      isCorrect = result.isEquivalent;
      correctAnswer = expected;
      equivalenceResult = result;

      if (!isCorrect) {
        misconceptions = detectMisconceptions(String(userAnswer), expected);
      }

      if (isCorrect) {
        feedback = `Richtig! ${questionData.explanation || ''}`;
        if (result.method === 'algebraic') {
          feedback = `Richtig! Deine Antwort ist algebraisch äquivalent. ${
            questionData.explanation || ''
          }`;
        }
      } else {
        feedback = `Leider falsch. Die richtige Antwort ist ${expected}. `;

        if (result.isClose) {
          feedback += `Du warst sehr nahe dran! `;
        }

        if (misconceptions.length > 0) {
          feedback += '\n\nMögliche Fehlerquellen:\n';
          misconceptions.forEach((m) => {
            feedback += `• ${m.name}: ${m.hint}\n`;
          });
        }

        feedback += `\n${questionData.explanation || ''}`;
      }
    }

    // ========================================================================
    // PHASE 2: Calculate XP and Coins
    // ========================================================================

    const BASE_XP: Record<number, number> = {
      1: 10,
      2: 15,
      3: 20,
      4: 30,
      5: 50,
      6: 60,
      7: 75,
      8: 90,
      9: 110,
      10: 130,
    };

    const BASE_COINS: Record<number, number> = {
      1: 1,
      2: 1,
      3: 2,
      4: 2,
      5: 3,
      6: 3,
      7: 4,
      8: 4,
      9: 5,
      10: 5,
    };

    const baseXp = BASE_XP[questionData.difficulty] || 20;
    const baseCoins = BASE_COINS[questionData.difficulty] || 2;

    // If skipped
    if (skipped) {
      return c.json({
        success: true,
        isCorrect: false,
        feedback: 'Frage übersprungen',
        correctAnswer,
        xpEarned: 0,
        coinsEarned: 0,
        xpBreakdown: {
          base: baseXp,
          hintPenalty: -baseXp,
          timePenalty: 0,
          bonuses: 0,
          total: 0,
        },
        coinBreakdown: {
          base: baseCoins,
          multiplier: 0,
          total: 0,
        },
        misconceptions: [],
        equivalenceResult: null,
      });
    }

    // If wrong, no XP but provide misconception feedback
    if (!isCorrect) {
      // Check for streak freeze
      let streakFrozen = false;
      if (streakFreezeAvailable && correctStreak && correctStreak >= 5) {
        streakFrozen = true;
        feedback += '\n\n❄️ Dein Streak wurde durch ein Streak-Freeze geschützt!';
      }

      return c.json({
        success: true,
        isCorrect: false,
        feedback,
        correctAnswer,
        xpEarned: 0,
        coinsEarned: 0,
        xpBreakdown: {
          base: baseXp,
          hintPenalty: 0,
          timePenalty: 0,
          bonuses: 0,
          total: 0,
        },
        coinBreakdown: {
          base: baseCoins,
          multiplier: 0,
          total: 0,
        },
        misconceptions,
        equivalenceResult,
        streakFrozen,
      });
    }

    // ========================================================================
    // PHASE 3: Calculate XP for correct answer
    // ========================================================================

    const HINT_PENALTY_MULTIPLIER: Record<number, number> = {
      0: 1.0, // 100%
      1: 0.85, // 85%
      2: 0.65, // 65%
      3: 0.4, // 40%
    };

    let xp = baseXp;
    const hintMultiplier = HINT_PENALTY_MULTIPLIER[Math.min(hintsUsed || 0, 3)];
    const hintPenalty = baseXp * (1 - hintMultiplier);
    xp *= hintMultiplier;

    // Time bonus (if very fast - expected time ~60s per difficulty level)
    let timeBonus = 0;
    const expectedTime = (questionData.difficulty || 5) * 60;
    if (timeSpent && timeSpent < expectedTime * 0.5) {
      timeBonus = baseXp * 0.2; // +20% bonus
      xp += timeBonus;
    }

    // Streak bonus (5+ correct answers in a row)
    let streakBonus = 0;
    if (correctStreak && correctStreak >= 5) {
      streakBonus = xp * 0.5; // +50% bonus
      xp += streakBonus;
    } else if (correctStreak && correctStreak >= 3) {
      streakBonus = xp * 0.25; // +25% bonus for 3+ streak
      xp += streakBonus;
    }

    // Bonus for using semantic equivalence (shows mathematical understanding)
    let equivalenceBonus = 0;
    if (equivalenceResult && (equivalenceResult as EquivalenceResult).method === 'algebraic') {
      equivalenceBonus = baseXp * 0.1; // +10% for algebraic answer
      xp += equivalenceBonus;
    }

    const totalXp = Math.round(xp);

    // ========================================================================
    // PHASE 4: Calculate coins for correct answer
    // ========================================================================

    let coinMultiplier = 1.0;
    const coinBonuses: Array<{ type: string; bonus: string }> = [];

    // First question of the day bonus (2x multiplier)
    const isFirstQuestion = (body as any).isFirstQuestionToday || false;
    if (isFirstQuestion) {
      coinMultiplier *= 2.0;
      coinBonuses.push({ type: 'firstQuestion', bonus: 'x2' });
    }

    // Streak bonus for coins (5+ days: +50%)
    if ((body as any).dailyStreak && (body as any).dailyStreak >= 5) {
      coinMultiplier *= 1.5;
      coinBonuses.push({ type: 'streakBonus', bonus: '+50%' });
    }

    // Perfect answer bonus (no hints, fast time: +25%)
    const isPerfect =
      (hintsUsed || 0) === 0 && timeSpent && timeSpent < expectedTime * 0.5;
    if (isPerfect) {
      coinMultiplier *= 1.25;
      coinBonuses.push({ type: 'perfect', bonus: '+25%' });
    }

    const totalCoins = Math.round(baseCoins * coinMultiplier);

    // ========================================================================
    // PHASE 5: Return response
    // ========================================================================

    return c.json({
      success: true,
      isCorrect: true,
      feedback,
      correctAnswer,
      xpEarned: totalXp,
      coinsEarned: totalCoins,
      xpBreakdown: {
        base: baseXp,
        hintPenalty: -Math.round(hintPenalty),
        timePenalty: 0,
        timeBonus: Math.round(timeBonus),
        streakBonus: Math.round(streakBonus),
        equivalenceBonus: Math.round(equivalenceBonus),
        total: totalXp,
      },
      coinBreakdown: {
        base: baseCoins,
        multiplier: coinMultiplier,
        bonuses: coinBonuses,
        total: totalCoins,
      },
      misconceptions: [],
      equivalenceResult,
    });
  } catch (error) {
    console.error('[evaluate-answer] Error:', error);

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
