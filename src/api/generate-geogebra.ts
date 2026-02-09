import type { Context } from 'hono';
import type { Env } from '../index';

export async function handleGenerateGeogebra(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json();
  console.log('[generate-geogebra] Stub called');
  return c.json({ success: true, message: 'Endpoint not yet migrated' });
}
