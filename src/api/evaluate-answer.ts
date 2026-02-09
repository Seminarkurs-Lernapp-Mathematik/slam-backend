/**
 * Evaluate Answer Endpoint
 *
 * TODO: Migrate from functions/api/evaluate-answer.js
 */

import type { Context } from 'hono';
import type { Env } from '../index';

export async function handleEvaluateAnswer(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json();

  // TODO: Implement semantic math evaluation from evaluate-answer.js
  console.log('[evaluate-answer] Stub called');

  return c.json({
    success: true,
    isCorrect: false,
    feedback: 'Endpoint not yet migrated. See backend/MIGRATION.md',
    xpEarned: 0,
  });
}
