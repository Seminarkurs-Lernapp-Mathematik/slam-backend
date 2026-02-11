/**
 * SLAM Backend API - Cloudflare Workers Entry Point
 * Main router with CORS middleware and API endpoints
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleGenerateQuestions } from './api/generate-questions';
import { handleEvaluateAnswer } from './api/evaluate-answer';
import { handleGetModels } from './api/get-models';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Env {
  ENVIRONMENT: string;
  // Add other environment variables here
}

// ============================================================================
// MAIN HONO APP
// ============================================================================

const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// CORS MIDDLEWARE
// ============================================================================

app.use('*', cors({
  origin: (origin) => {
    const allowedOrigins = [
      'https://learn-smart.app',
      'https://www.learn-smart.app',
      'http://localhost:3000',
    ];

    // Allow all localhost and 127.0.0.1 ports for development
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return origin;
    }

    return allowedOrigins.includes(origin) ? origin : origin;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
}));

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/', (c) => {
  const env = c.env.ENVIRONMENT || 'unknown';
  return c.json({
    service: 'SLAM Backend API',
    version: '1.0.0',
    environment: env,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/get-models',
      'POST /api/generate-questions',
      'POST /api/evaluate-answer',
      'POST /api/update-auto-mode',
      'POST /api/custom-hint',
      'POST /api/generate-geogebra',
      'POST /api/generate-mini-app',
      'POST /api/manage-learning-plan',
      'POST /api/manage-memories',
      'POST /api/analyze-image',
    ],
  });
});

// API Endpoints (Migrated from Cloudflare Pages Functions)
app.post('/api/generate-questions', handleGenerateQuestions);
app.post('/api/evaluate-answer', handleEvaluateAnswer);
app.get('/api/get-models', handleGetModels);

// TODO: Migrate remaining endpoints
app.post('/api/update-auto-mode', (c) => c.json({ success: true, message: 'Stub - not yet migrated' }));
app.post('/api/custom-hint', (c) => c.json({ success: true, message: 'Stub - not yet migrated' }));
app.post('/api/generate-geogebra', (c) => c.json({ success: true, message: 'Stub - not yet migrated' }));
app.post('/api/generate-mini-app', (c) => c.json({ success: true, message: 'Stub - not yet migrated' }));
app.post('/api/manage-learning-plan', (c) => c.json({ success: true, message: 'Stub - not yet migrated' }));
app.post('/api/manage-memories', (c) => c.json({ success: true, message: 'Stub - not yet migrated' }));
app.post('/api/analyze-image', (c) => c.json({ success: true, message: 'Stub - not yet migrated' }));

// 404 Handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'Not Found',
    message: `Route ${c.req.method} ${c.req.path} not found`,
  }, 404);
});

// Error Handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({
    success: false,
    error: 'Internal Server Error',
    message: err.message,
  }, 500);
});

// ============================================================================
// EXPORT
// ============================================================================

export default app;
