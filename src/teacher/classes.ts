import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsPatch, fsDelete, fsQuery } from '../utils/firestore';
import type { ClassDoc } from './types';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };
const router = new Hono<AppEnv>();

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

async function getOwnedClass(
  projectId: string,
  accessToken: string,
  classId: string,
  teacherUid: string
): Promise<ClassDoc> {
  const doc = await fsGet(projectId, accessToken, `classes/${classId}`);
  if (!doc) throw Object.assign(new Error('Class not found'), { status: 404 });
  if (doc.teacherId !== teacherUid) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return doc as unknown as ClassDoc;
}

// POST / — create class
router.post('/', async (c) => {
  const teacherUid = c.get('teacherUid');
  const body = await c.req.json<{ name?: string; gridConfig?: { rows: number; cols: number } }>();
  if (!body.name?.trim()) return c.json({ success: false, error: 'name is required' }, 400);

  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  const classId = generateId();
  const now = new Date().toISOString();
  const classDoc: ClassDoc = {
    id: classId,
    name: body.name.trim(),
    teacherId: teacherUid,
    schoolId: 'mvl',
    studentIds: [],
    gridConfig: body.gridConfig ?? { rows: 4, cols: 5 },
    deskPositions: {},
    createdAt: now,
    updatedAt: now,
  };
  const result = await fsPatch(projectId, accessToken, `classes/${classId}`, classDoc as unknown as Record<string, unknown>);
  return c.json(result, 201);
});

// PATCH /:classId — update name, gridConfig, or deskPositions
router.patch('/:classId', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const body = await c.req.json<{
    name?: string;
    gridConfig?: { rows: number; cols: number };
    deskPositions?: Record<string, { col: number; row: number }>;
  }>();
  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  let existing: ClassDoc;
  try {
    existing = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }
  const updated: ClassDoc = {
    ...existing,
    ...(body.name !== undefined && { name: body.name }),
    ...(body.gridConfig !== undefined && { gridConfig: body.gridConfig }),
    ...(body.deskPositions !== undefined && { deskPositions: body.deskPositions }),
    updatedAt: new Date().toISOString(),
  };
  const result = await fsPatch(projectId, accessToken, `classes/${classId}`, updated as unknown as Record<string, unknown>);
  return c.json(result);
});

// DELETE /:classId
router.delete('/:classId', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  try {
    await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }
  await fsDelete(projectId, accessToken, `classes/${classId}`);
  return new Response(null, { status: 204 });
});

export default router;
