// src/teacher/students.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsQuery } from '../utils/firestore';
import { callAI } from '../utils/callAI';
import { parseJsonWithRepair } from '../utils/repairJson';
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
// Returns a structured, explainable assessment with evidence per conclusion (XAI).
router.post('/:userId/ai-assessment', async (c) => {
  const userId = c.req.param('userId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  const history = await fsQuery(projectId, accessToken, `users/${userId}`, {
    from: [{ collectionId: 'questionHistory' }],
    orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
    limit: 50,
  });

  const totalAnswered = history.length;
  const correctCount = history.filter((q: any) => q.isCorrect).length;
  const accuracyPct = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

  const historyText = history
    .map((q: any, i: number) => {
      const status = q.isCorrect ? '✓' : '✗';
      return `${i + 1}. [${status}] ${q.leitidee} › ${q.thema} › ${q.unterthema}: „${q.questionText}" → „${q.userAnswer}"`;
    })
    .join('\n');

  const prompt = totalAnswered > 0
    ? `Du bist ein erfahrener Mathematiklehrer. Analysiere die Lernhistorie des Schülers.

Statistik: ${totalAnswered} Aufgaben, ${accuracyPct}% richtig.

Lernhistorie (neueste zuerst):
${historyText}

Erstelle eine strukturierte, nachvollziehbare Einschätzung als JSON. Gib für jede Aussage konkrete Belege aus der Lernhistorie an (Aufgabennummern), damit die Lehrkraft die KI-Entscheidung nachvollziehen kann.

Antworte NUR mit diesem JSON, kein Markdown:
{
  "summary": "Kurze Gesamteinschätzung (2–3 Sätze)",
  "strengths": [
    { "text": "Stärke", "evidence": "Belege aus Aufg. X, Y, Z" }
  ],
  "weaknesses": [
    { "text": "Schwäche", "evidence": "Belege aus Aufg. X, Y" }
  ],
  "recommendation": "Konkrete Handlungsempfehlung für die Lehrkraft",
  "confidence": "high|medium|low",
  "confidenceReason": "Begründung für das Konfidenz-Niveau (z.B. Datenbasis zu klein)"
}`
    : `{
  "summary": "Dieser Schüler hat noch keine Aufgaben bearbeitet. Es liegen keine Daten für eine Einschätzung vor.",
  "strengths": [],
  "weaknesses": [],
  "recommendation": "Schüler zur aktiven Nutzung des adaptiven Fragen-Feeds motivieren.",
  "confidence": "low",
  "confidenceReason": "Keine Lernhistorie vorhanden"
}`;

  const taskConfig = (modelsConfig as any).tasks.aiAssessment;

  const rawResponse = await callAI({
    provider: taskConfig.provider,
    model: taskConfig.model,
    prompt,
    temperature: taskConfig.temperature,
    maxTokens: taskConfig.maxTokens,
    systemPrompt: taskConfig.systemPrompt,
    env: c.env,
  });

  // Parse structured XAI response; fall back to prose if parsing fails
  let xaiResult: Record<string, unknown>;
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    xaiResult = parseJsonWithRepair(jsonMatch ? jsonMatch[0] : rawResponse);
  } catch {
    // Graceful degradation: wrap prose in the expected shape
    xaiResult = {
      summary: rawResponse,
      strengths: [],
      weaknesses: [],
      recommendation: '',
      confidence: 'low',
      confidenceReason: 'Structured parsing failed — prose assessment shown',
    };
  }

  return c.json({
    ...xaiResult,
    // Legacy field kept for backwards compatibility with existing dashboard consumers
    assessment: xaiResult.summary,
    stats: { totalAnswered, correctCount, accuracyPct },
    generatedAt: new Date().toISOString(),
    modelUsed: taskConfig.model,
  });
});

export default router;
