/**
 * Shared TypeScript types for SLAM Backend
 */

// ============================================================================
// REQUEST/RESPONSE TYPES
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

export interface Question {
  id: string;
  type: 'multiple-choice' | 'fill-in' | 'step-by-step';
  difficulty: number;
  topic: string;
  subtopic: string;
  question: string;
  hints: Array<{
    level: number;
    text: string;
  }>;
  solution: string;
  explanation: string;
  afbLevel?: string;
  requiresGeogebra?: boolean;
}

export interface QuestionSession {
  success: boolean;
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

export interface AnswerEvaluation {
  success: boolean;
  isCorrect: boolean;
  feedback: string;
  xpEarned: number;
  detailedExplanation?: string;
  misconceptions?: string[];
  nextDifficulty?: number;
}

// ============================================================================
// API PROVIDER TYPES
// ============================================================================

export type AIProvider = 'claude' | 'gemini';
export type ModelTier = 'light' | 'standard' | 'heavy';
export type AFBLevel = 'I' | 'II' | 'III';

export interface ModelConfig {
  provider: AIProvider;
  model: string;
  tier: ModelTier;
  temperature?: number;
  maxTokens?: number;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
