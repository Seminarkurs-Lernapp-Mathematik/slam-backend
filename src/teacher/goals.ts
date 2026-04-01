// src/teacher/goals.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsPatch } from '../utils/firestore';
import { getOwnedClass } from './classUtils';
import type { ClassGoalDoc } from './types';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

// POST /api/teacher/class/:classId/goal
router.post('/:classId/goal', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const body = await c.req.json<{
    topics?: Array<{ leitidee: string; thema: string; unterthema: string }>;
    examDate?: string | null;
  }>();

  if (!Array.isArray(body.topics) || body.topics.length === 0) {
    return c.json({ success: false, error: 'topics must be a non-empty array' }, 400);
  }

  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  try {
    await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const goal: ClassGoalDoc = {
    classId,
    teacherId: teacherUid,
    topics: body.topics,
    examDate: body.examDate ?? null,
    setAt: new Date().toISOString(),
  };

  const result = await fsPatch(
    projectId,
    accessToken,
    `classGoals/${classId}`,
    goal as unknown as Record<string, unknown>
  );

  return c.json(result);
});

export default router;
