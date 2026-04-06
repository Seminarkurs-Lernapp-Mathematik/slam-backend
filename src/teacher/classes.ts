import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsPatch, fsDelete, fsQuery } from '../utils/firestore';
import type { ClassDoc, TeacherDoc } from './types';
import { getOwnedClass } from './classUtils';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };
const router = new Hono<AppEnv>();

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

// GET /:classId — fetch a single class
router.get('/:classId', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  try {
    const cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
    return c.json(cls);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }
});

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
  await fsPatch(projectId, accessToken, `classes/${classId}`, classDoc as unknown as Record<string, unknown>);

  // Add classId to teacher's classIds array
  const teacher = await fsGet(projectId, accessToken, `teachers/${teacherUid}`) as unknown as TeacherDoc;
  if (teacher) {
    const updatedTeacher = { ...teacher, classIds: [...(teacher.classIds ?? []), classId] };
    await fsPatch(projectId, accessToken, `teachers/${teacherUid}`, updatedTeacher as unknown as Record<string, unknown>);
  }

  return c.json(classDoc, 201);
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

  // Remove classId from teacher's classIds array
  const teacher = await fsGet(projectId, accessToken, `teachers/${teacherUid}`) as unknown as TeacherDoc;
  if (teacher) {
    const updatedTeacher = { ...teacher, classIds: (teacher.classIds ?? []).filter((id) => id !== classId) };
    await fsPatch(projectId, accessToken, `teachers/${teacherUid}`, updatedTeacher as unknown as Record<string, unknown>);
  }

  return new Response(null, { status: 204 });
});

// GET /:classId/students — roster with live status
router.get('/:classId/students', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  const thirtyMin = 30 * 60 * 1000;

  const students = await Promise.all(
    cls.studentIds.map(async (uid) => {
      const [sessions, recentQuestions, userDoc] = await Promise.all([
        fsQuery(projectId, accessToken, `users/${uid}`, {
          from: [{ collectionId: 'learningSessions' }],
          orderBy: [{ field: { fieldPath: 'startedAt' }, direction: 'DESCENDING' }],
          limit: 1,
        }),
        fsQuery(projectId, accessToken, `users/${uid}`, {
          from: [{ collectionId: 'questionHistory' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'timestamp' },
              op: 'GREATER_THAN_OR_EQUAL',
              value: { integerValue: String(now - 7 * 24 * 60 * 60 * 1000) },
            },
          },
          orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
          limit: 50,
        }),
        fsGet(projectId, accessToken, `users/${uid}`),
      ]);

      const totalQ = recentQuestions.length;
      const correctQ = recentQuestions.filter((q) => q.isCorrect === true).length;
      const accuracy7d = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;

      let status: 'active' | 'idle' | 'struggling' | 'offline' = 'offline';
      let lastActive: string | null = null;
      let sessionProgress: { answered: number; total: number } | null = null;

      if (sessions.length > 0) {
        const session = sessions[0];
        const sessionTime = new Date(session.startedAt as string).getTime();
        const elapsed = now - sessionTime;
        lastActive = session.startedAt as string;
        sessionProgress = {
          answered: (session.questionsCompleted as number) ?? 0,
          total: (session.questionsTotal as number) ?? 0,
        };
        if (elapsed < fiveMin) {
          status = totalQ >= 5 && correctQ < totalQ / 2 ? 'struggling' : 'active';
        } else if (elapsed < thirtyMin) {
          status = 'idle';
        }
      }

      if (!userDoc) {
        return { uid, displayName: uid, email: '', lastActive, accuracy7d: 0, streak: 0, totalXp: 0, status: 'offline' as const, currentTopic: null, sessionProgress: null };
      }

      return {
        uid,
        displayName: (userDoc.displayName as string) ?? uid,
        email: (userDoc.email as string) ?? '',
        lastActive,
        accuracy7d,
        streak: (userDoc.streak as number) ?? 0,
        totalXp: (userDoc.totalXp as number) ?? 0,
        status,
        currentTopic: null,
        sessionProgress,
      };
    })
  );

  return c.json(students);
});

// POST /:classId/students — add one or more students
router.post('/:classId/students', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const body = await c.req.json<{ studentIds?: string[] }>();

  if (!Array.isArray(body.studentIds) || body.studentIds.length === 0 ||
      !body.studentIds.every((id) => typeof id === 'string' && id.length > 0)) {
    return c.json({ success: false, error: 'studentIds must be a non-empty array of strings' }, 400);
  }

  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const merged = [...new Set([...cls.studentIds, ...body.studentIds])];
  const updated: ClassDoc = { ...cls, studentIds: merged, updatedAt: new Date().toISOString() };
  const result = await fsPatch(projectId, accessToken, `classes/${classId}`, updated as unknown as Record<string, unknown>);
  return c.json(result);
});

// DELETE /:classId/students/:userId — remove a student
router.delete('/:classId/students/:userId', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const userId = c.req.param('userId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }
  const updated: ClassDoc = {
    ...cls,
    studentIds: cls.studentIds.filter((id) => id !== userId),
    updatedAt: new Date().toISOString(),
  };
  const result = await fsPatch(projectId, accessToken, `classes/${classId}`, updated as unknown as Record<string, unknown>);
  return c.json(result);
});

export default router;
