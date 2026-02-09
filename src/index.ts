/**
 * SLAM Backend - Cloudflare Workers API
 *
 * Main entry point for the API server using Hono framework.
 * Handles routing, CORS, and delegates to endpoint handlers.
 *
 * @see https://hono.dev/ for Hono documentation
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// Import API endpoint handlers
import { handleGenerateQuestions } from './api/generate-questions';
import { handleEvaluateAnswer } from './api/evaluate-answer';
import { handleUpdateAutoMode } from './api/update-auto-mode';
import { handleCustomHint } from './api/custom-hint';
import { handleGenerateGeogebra } from './api/generate-geogebra';
import { handleGenerateMiniApp } from './api/generate-mini-app';
import { handleManageLearningPlan } from './api/manage-learning-plan';
import { handleManageMemories } from './api/manage-memories';
import { handleAnalyzeImage } from './api/analyze-image';

// Type definitions for Cloudflare Workers
export interface Env {
  ENVIRONMENT?: string;
  CLAUDE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
}

// Create Hono app
const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Logger middleware
app.use('*', logger());

// CORS middleware - Allow requests from Flutter Web and development
app.use(
  '*',
  cors({
    origin: (origin) => {
      // Allow these origins
      const allowedOrigins = [
        'https://learn-smart.app',
        'https://www.learn-smart.app',
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:8080',
      ];

      // Allow all localhost ports for development
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return origin;
      }

      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        return origin;
      }

      // Default: allow all origins (can be restricted in production)
      return origin;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposeHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400, // 24 hours
    credentials: true,
  })
);

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/', (c) => {
  return c.json({
    service: 'SLAM Backend API',
    version: '1.0.0',
    environment: c.env.ENVIRONMENT || 'development',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/api/generate-questions',
      '/api/evaluate-answer',
      '/api/update-auto-mode',
      '/api/custom-hint',
      '/api/generate-geogebra',
      '/api/generate-mini-app',
      '/api/manage-learning-plan',
      '/api/manage-memories',
      '/api/analyze-image',
    ],
  });
});

// API Routes
app.post('/api/generate-questions', handleGenerateQuestions);
app.get('/api/generate-questions', (c) => {
  return c.json({
    endpoint: '/api/generate-questions',
    method: 'POST',
    description: 'Generates questions with intelligent model routing and caching',
    requiredFields: ['apiKey', 'userId', 'topics', 'userContext'],
    optionalFields: [
      'selectedModel',
      'provider (claude|gemini)',
      'complexity (light|standard|heavy)',
      'afbLevel (I|II|III)',
      'questionCount',
      'useCache',
      'forceRegenerate',
    ],
  });
});

app.post('/api/evaluate-answer', handleEvaluateAnswer);
app.get('/api/evaluate-answer', (c) => {
  return c.json({
    endpoint: '/api/evaluate-answer',
    method: 'POST',
    description: 'Evaluates user answers with semantic math comparison',
    requiredFields: [
      'questionId',
      'userAnswer',
      'correctAnswer',
      'questionType',
      'difficulty',
      'hintsUsed',
      'timeSpent',
      'correctStreak',
    ],
  });
});

app.post('/api/update-auto-mode', handleUpdateAutoMode);
app.post('/api/custom-hint', handleCustomHint);
app.post('/api/generate-geogebra', handleGenerateGeogebra);
app.post('/api/generate-mini-app', handleGenerateMiniApp);
app.post('/api/manage-learning-plan', handleManageLearningPlan);
app.post('/api/manage-memories', handleManageMemories);
app.post('/api/analyze-image', handleAnalyzeImage);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      message: `Endpoint ${c.req.path} not found`,
      availableEndpoints: [
        '/api/generate-questions',
        '/api/evaluate-answer',
        '/api/update-auto-mode',
        '/api/custom-hint',
        '/api/generate-geogebra',
        '/api/generate-mini-app',
        '/api/manage-learning-plan',
        '/api/manage-memories',
        '/api/analyze-image',
      ],
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: 'Internal Server Error',
      message: err.message,
      stack: c.env.ENVIRONMENT === 'development' ? err.stack : undefined,
    },
    500
  );
});

// ============================================================================
// EXPORT
// ============================================================================

export default app;
