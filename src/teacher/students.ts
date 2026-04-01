// src/teacher/students.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsQuery } from '../utils/firestore';
import { callAI } from '../utils/callAI';
import modelsConfig from '../config/models.json';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

// POST /api/teacher/student/:userId/ai-assessment
router.post('/:userId/ai-assessment', async (c) => {
  const userId = c.req.param('userId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  // Fetch last 50 question history entries
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
