import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsPatch } from '../utils/firestore';
import type { TeacherDoc } from './types';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };
const router = new Hono<AppEnv>();

router.get('/', async (c) => {
  const teacherUid = c.get('teacherUid');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  const doc = await fsGet(projectId, accessToken, `teachers/${teacherUid}`);
  if (!doc) return c.json({ success: false, error: 'Teacher profile not found' }, 404);
  return c.json(doc);
});

router.put('/', async (c) => {
  const teacherUid = c.get('teacherUid');
  const body = await c.req.json<{ displayName?: string; theme?: 'dark' | 'light' }>();
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  const existing = await fsGet(projectId, accessToken, `teachers/${teacherUid}`);
  if (!existing) return c.json({ success: false, error: 'Teacher profile not found' }, 404);

  const updated: TeacherDoc = {
    ...(existing as unknown as TeacherDoc),
    ...(body.displayName !== undefined && { displayName: body.displayName }),
    ...(body.theme !== undefined && { theme: body.theme }),
  };

  const result = await fsPatch(projectId, accessToken, `teachers/${teacherUid}`, updated as unknown as Record<string, unknown>);
  return c.json(result);
});

export default router;
