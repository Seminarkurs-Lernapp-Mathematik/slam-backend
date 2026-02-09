import type { Context } from 'hono';
import type { Env } from '../index';

export async function handleManageLearningPlan(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json();
  console.log('[manage-learning-plan] Stub called');
  return c.json({ success: true, message: 'Endpoint not yet migrated' });
}
