import type { Context } from 'hono';
import type { Env } from '../index';

export async function handleGenerateMiniApp(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json();
  console.log('[generate-mini-app] Stub called');
  return c.json({ success: true, message: 'Endpoint not yet migrated' });
}
