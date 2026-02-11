/**
 * Shared TypeScript Type Definitions
 * Used across all API endpoints
 */

// ============================================================================
// TOPIC & USER CONTEXT
// ============================================================================

export interface Topic {
  leitidee: string;
  thema: string;
  unterthema: string;
}

export interface UserContext {
  gradeLevel: string;
  courseType: string;
  recentPerformance?: {
    strugglingTopics?: string[];
    averageScore?: number;
  };
  autoModeAssessment?: {
    currentAssessment: {
      detailLevel: number;
      temperature: number;
      helpfulness: number;
      reasoning: string;
    };
  };
}

// ============================================================================
// QUESTION TYPES
// ============================================================================

export type QuestionType = 'multiple-choice' | 'step-by-step';
export type StepByStepType = 'next-action' | 'sort-steps';

export interface QuestionHint {
  id: string;
  text: string;
}

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface StepByStepStep {
  id: string;
  text: string;
}

export interface StepByStepData {
  type: StepByStepType;
  steps: StepByStepStep[];
  correctOrder: string[];
}

export interface Question {
  id: string;
  type: QuestionType;
  difficulty: number;
  topic: string;
  subtopic: string;
  question: string;
  solution: string;
  explanation: string;
  correctFeedback: string;
  incorrectFeedback: string;
  hints: QuestionHint[];
  options?: QuestionOption[];
  stepByStepData?: StepByStepData;
  afbLevel?: 'I' | 'II' | 'III';
}

export interface QuestionSession {
  sessionId: string;
  learningPlanItemId: number;
  topics: Topic[];
  userContext: UserContext;
  questions: Question[];
  totalQuestions: number;
  fromCache: boolean;
  cacheKey?: string;
  modelUsed?: string;
  providerUsed?: string;
}

// ============================================================================
// AI CONFIGURATION
// ============================================================================

export type AIProvider = 'claude' | 'gemini';
export type ModelTier = 'light' | 'standard' | 'heavy';

// ============================================================================
// EVALUATION TYPES
// ============================================================================

export interface AnswerEvaluation {
  isCorrect: boolean;
  feedback: string;
  correctAnswer: string | string[] | null;
  xpEarned: number;
  coinsEarned: number;
  xpBreakdown: {
    base: number;
    hintPenalty: number;
    timePenalty: number;
    timeBonus?: number;
    streakBonus?: number;
    equivalenceBonus?: number;
    total: number;
  };
  coinBreakdown: {
    base: number;
    multiplier: number;
    bonuses?: Array<{ type: string; bonus: string }>;
    total: number;
  };
  misconceptions: Array<{
    id: string;
    name: string;
    description: string;
    hint: string;
  }>;
  equivalenceResult?: any;
  streakFrozen?: boolean;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class APIError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
  }
}

// ============================================================================
// LEARNING PLAN
// ============================================================================

export interface LearningPlanItem {
  id: number;
  topics: Topic[];
  status: 'pending' | 'in-progress' | 'completed';
  questionsGenerated: number;
  questionsCompleted: number;
  createdAt: string;
}

// ============================================================================
// MEMORY SYSTEM
// ============================================================================

export interface Memory {
  id: string;
  questionId: string;
  topic: string;
  subtopic: string;
  difficulty: number;
  lastReviewed: string;
  nextReview: string;
  repetitions: number;
  easeFactor: number;
  interval: number;
}
