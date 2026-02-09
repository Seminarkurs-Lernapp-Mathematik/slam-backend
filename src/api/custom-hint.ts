import type { Context } from 'hono';
import type { Env } from '../index';

export async function handleCustomHint(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json();
  console.log('[custom-hint] Stub called');
  return c.json({ success: true, hint: 'Endpoint not yet migrated' });
}
