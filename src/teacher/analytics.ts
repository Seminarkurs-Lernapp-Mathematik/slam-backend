// src/teacher/analytics.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsQuery } from '../utils/firestore';
import type { ClassDoc, TopicAccuracy, AnalyticsSummary, FeedEntry } from './types';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

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

// GET /api/teacher/class/:classId/analytics
router.get('/:classId/analytics', async (c) => {
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
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = now - dayMs;
  const weekStart = now - 7 * dayMs;

  // Fetch per-student data in parallel
  const studentData = await Promise.all(
    cls.studentIds.map(async (uid) => {
      const [history, userDoc] = await Promise.all([
        fsQuery(projectId, accessToken, `users/${uid}`, {
          from: [{ collectionId: 'questionHistory' }],
          orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
          limit: 200,
        }),
        fsGet(projectId, accessToken, `users/${uid}`),
      ]);
      return { uid, history, userDoc };
    })
  );

  // Aggregate
  const topicMap = new Map<string, { leitidee: string; thema: string; unterthema: string; correct: number; incorrect: number }>();
  let questionsToday = 0;
  let questionsThisWeek = 0;
  let totalCorrect = 0;
  let totalAnswered = 0;
  let activeStudentsToday = 0;
  let totalStreak = 0;
  let studentCount = 0;

  for (const { history, userDoc } of studentData) {
    let studentActiveToday = false;
    for (const q of history) {
      const ts = q.timestamp as number;
      if (ts > todayStart) {
        questionsToday++;
        studentActiveToday = true;
      }
      if (ts > weekStart) questionsThisWeek++;

      const isCorrect = q.isCorrect === true;
      const key = `${q.leitidee}|${q.thema}|${q.unterthema}`;
      const entry = topicMap.get(key) ?? {
        leitidee: q.leitidee as string,
        thema: q.thema as string,
        unterthema: q.unterthema as string,
        correct: 0,
        incorrect: 0,
      };
      if (isCorrect) { entry.correct++; totalCorrect++; }
      else { entry.incorrect++; }
      totalAnswered++;
      topicMap.set(key, entry);
    }

    if (studentActiveToday) activeStudentsToday++;
    if (userDoc) {
      totalStreak += (userDoc.streak as number) ?? 0;
      studentCount++;
    }
  }

  const classAverageAccuracy = totalAnswered > 0
    ? Math.round((totalCorrect / totalAnswered) * 100)
    : 0;

  const avgDailyStreak = studentCount > 0
    ? Math.round(totalStreak / studentCount)
    : 0;

  const summary: AnalyticsSummary = {
    questionsToday,
    questionsThisWeek,
    classAverageAccuracy,
    avgDailyStreak,
    activeStudentsToday,
  };

  const topics: TopicAccuracy[] = Array.from(topicMap.values()).map((t) => {
    const total = t.correct + t.incorrect;
    const accuracyPct = total > 0 ? Math.round((t.correct / total) * 100) : 0;
    return {
      leitidee: t.leitidee,
      thema: t.thema,
      unterthema: t.unterthema,
      correct: t.correct,
      incorrect: t.incorrect,
      accuracyPct,
      isWissensluecke: accuracyPct < 60,
    };
  });

  return c.json({ summary, topics });
});

// GET /api/teacher/class/:classId/feed
router.get('/:classId/feed', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const studentData = await Promise.all(
    cls.studentIds.map(async (uid) => {
      const [history, userDoc] = await Promise.all([
        fsQuery(projectId, accessToken, `users/${uid}`, {
          from: [{ collectionId: 'questionHistory' }],
          orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
          limit: 20,
        }),
        fsGet(projectId, accessToken, `users/${uid}`),
      ]);
      return { uid, displayName: (userDoc?.displayName as string) ?? uid, history };
    })
  );

  const entries: FeedEntry[] = [];
  for (const { uid, displayName, history } of studentData) {
    for (const q of history) {
      entries.push({
        userId: uid,
        displayName,
        questionText: (q.questionText as string) ?? '',
        studentAnswer: (q.userAnswer as string) ?? '',
        isCorrect: q.isCorrect === true,
        feedback: (q.feedback as string) ?? '',
        hintsUsed: (q.hintsUsed as number) ?? 0,
        timeSpentSeconds: (q.timeSpentSeconds as number) ?? 0,
        timestamp: (q.timestamp as number) ?? 0,
        leitidee: (q.leitidee as string) ?? '',
        thema: (q.thema as string) ?? '',
        unterthema: (q.unterthema as string) ?? '',
      });
    }
  }

  // Sort by most recent first, take top 50
  entries.sort((a, b) => b.timestamp - a.timestamp);

  return c.json({ entries: entries.slice(0, 50) });
});

export default router;
