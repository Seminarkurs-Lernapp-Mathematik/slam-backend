// src/teacher/students.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsQuery } from '../utils/firestore';
import { callAI } from '../utils/callAI';
import { createFirebaseUser, sendPasswordResetEmail, getUserByEmail } from '../utils/firebaseAdmin';
import modelsConfig from '../config/models.json';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

// POST /api/teacher/student/invite
// Must be registered before /:userId routes to avoid "invite" matching as userId
router.post('/invite', async (c) => {
  const body = await c.req.json<{ email?: string; displayName?: string }>();
  if (!body.email?.trim()) {
    return c.json({ success: false, error: 'email is required' }, 400);
  }

  let uid: string;
  try {
    uid = await createFirebaseUser(c.env, body.email.trim(), body.displayName?.trim() ?? '');
  } catch (err: unknown) {
    const msg = (err as Error).message ?? 'Failed to create user';
    if (msg.includes('EMAIL_EXISTS')) {
      try {
        uid = await getUserByEmail(c.env, body.email.trim());
      } catch {
        return c.json({ success: false, error: 'EMAIL_EXISTS' }, 409);
      }
    } else {
      return c.json({ success: false, error: msg }, 500);
    }
  }

  try {
    await sendPasswordResetEmail(c.env, body.email.trim());
  } catch (err: unknown) {
    // Non-fatal: user was created, email just didn't send
    console.error('Failed to send invite email:', (err as Error).message);
  }

  return c.json({ uid, email: body.email.trim() }, 201);
});

// POST /api/teacher/student/reset-password
router.post('/reset-password', async (c) => {
  const body = await c.req.json<{ email?: string }>();
  if (!body.email?.trim()) {
    return c.json({ success: false, error: 'email is required' }, 400);
  }

  await sendPasswordResetEmail(c.env, body.email.trim());
  return c.json({ success: true });
});

// POST /api/teacher/student/:userId/ai-assessment
router.post('/:userId/ai-assessment', async (c) => {
  const userId = c.req.param('userId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  const history = await fsQuery(projectId, accessToken, `users/${userId}`, {
    from: [{ collectionId: 'questionHistory' }],
    orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
    limit: 50,
  });

  const historyText = history
    .map((q, i) => {
      const status = q.isCorrect ? '✓' : '✗';
      return `${i + 1}. [${status}] ${q.leitidee} › ${q.thema} › ${q.unterthema}: „${q.questionText}" → „${q.userAnswer}"`;
    })
    .join('\n');

  const prompt = history.length > 0
    ? `Lernhistorie der letzten ${history.length} Aufgaben:\n\n${historyText}\n\nBitte erstelle eine kurze Einschätzung (3–4 Sätze) mit: Stärken, wiederkehrenden Flüchtigkeitsfehlern, und einer konkreten Empfehlung für die Lehrkraft.`
    : 'Dieser Schüler hat noch keine Aufgaben bearbeitet. Gib eine kurze Einschätzung.';

  const taskConfig = (modelsConfig as any).tasks.aiAssessment;

  const assessment = await callAI({
    provider: taskConfig.provider,
    model: taskConfig.model,
    prompt,
    temperature: taskConfig.temperature,
    maxTokens: taskConfig.maxTokens,
    systemPrompt: taskConfig.systemPrompt,
    env: c.env,
  });

  return c.json({ assessment, generatedAt: new Date().toISOString() });
});

export default router;
