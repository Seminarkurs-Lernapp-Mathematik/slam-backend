/**
 * Async Job Tracking API
 *
 * Endpoints:
 *   GET  /api/jobs/:jobId          — poll job status
 *   POST /api/generate-mini-app/async — submit async generation, returns 202
 *
 * Jobs are stored in Firestore under asyncJobs/{jobId}.
 * The Flutter client polls GET /api/jobs/:jobId until status === 'done'.
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsPatch } from '../utils/firestore';
import { buildPrompt, validateAndSanitizeApp, ThemeColors } from './generate-mini-app';
import { callAI, getTaskModelConfig } from '../utils/callAI';
import { parseJsonWithRepair } from '../utils/repairJson';
import { sanitizePII } from '../utils/sanitizePII';

// Job status shape stored in Firestore
export interface AsyncJob {
  status: 'pending' | 'running' | 'done' | 'error';
  type: string;
  createdAt: string;
  updatedAt: string;
  result?: Record<string, unknown>;
  error?: string;
}

function generateJobId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `job_${ts}_${rand}`;
}

/** GET /api/jobs/:jobId — return current job status and result */
export async function handleGetJob(c: Context<{ Bindings: Env }>) {
  const jobId = c.req.param('jobId');
  if (!jobId || !/^job_[a-z0-9_]+$/.test(jobId)) {
    return c.json({ success: false, error: 'Invalid job ID' }, 400);
  }

  try {
    const { projectId, accessToken } = await getFirebaseConfig(c.env);
    const doc = await fsGet(projectId, accessToken, `asyncJobs/${jobId}`);

    if (!doc) {
      return c.json({ success: false, error: 'Job not found' }, 404);
    }

    return c.json({ success: true, ...doc });
  } catch (err) {
    console.error('[jobs] GET error:', err);
    return c.json({ success: false, error: 'Failed to retrieve job' }, 500);
  }
}

/** POST /api/generate-mini-app/async — submit generation, return 202 */
export async function handleGenerateMiniAppAsync(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    description?: string;
    themeColors?: ThemeColors;
    isFastMode?: boolean;
  }>();

  if (!body.description) {
    return c.json({ success: false, error: 'Missing required field: description' }, 400);
  }

  const jobId = generateJobId();
  const now = new Date().toISOString();

  try {
    const { projectId, accessToken } = await getFirebaseConfig(c.env);

    // Create job document in Firestore
    await fsPatch(projectId, accessToken, `asyncJobs/${jobId}`, {
      status: 'pending',
      type: 'generate-mini-app',
      createdAt: now,
      updatedAt: now,
    } satisfies AsyncJob);

    // Run AI generation in the background (Cloudflare waitUntil)
    // The response (202) is returned immediately below.
    const bgWork = runMiniAppGeneration(c.env, jobId, body.description, body.themeColors, body.isFastMode);
    c.executionCtx.waitUntil(bgWork);

    return c.json({ success: true, jobId, status: 'pending' }, 202);
  } catch (err) {
    console.error('[jobs] Submit error:', err);
    return c.json({ success: false, error: 'Failed to create job' }, 500);
  }
}

async function runMiniAppGeneration(
  env: Env,
  jobId: string,
  description: string,
  themeColors?: ThemeColors,
  isFastMode?: boolean,
): Promise<void> {
  const { projectId, accessToken } = await getFirebaseConfig(env);
  const now = () => new Date().toISOString();

  try {
    // Mark as running
    await fsPatch(projectId, accessToken, `asyncJobs/${jobId}`, {
      status: 'running',
      updatedAt: now(),
    });

    const safeDescription = sanitizePII(description);
    const complexity = description.length < 50 ? 'simple' : description.length < 150 ? 'medium' : 'advanced';
    const prompt = buildPrompt(safeDescription, complexity, themeColors);

    const taskName = isFastMode ? 'generateMiniAppFast' : 'generateMiniApp';
    const taskConfig = await getTaskModelConfig(taskName as any);
    const responseText = await callAI({
      provider: taskConfig.provider,
      model: taskConfig.model,
      prompt,
      temperature: taskConfig.temperature,
      maxTokens: taskConfig.maxTokens,
      systemPrompt: taskConfig.systemPrompt,
      env,
    });

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const candidate = jsonMatch ? jsonMatch[0] : responseText;
    const appData = parseJsonWithRepair(candidate);
    const generatedApp = validateAndSanitizeApp(appData);

    await fsPatch(projectId, accessToken, `asyncJobs/${jobId}`, {
      status: 'done',
      updatedAt: now(),
      result: {
        html: generatedApp.html,
        css: generatedApp.css,
        javascript: generatedApp.javascript,
        title: generatedApp.title,
        description: generatedApp.description,
        modelUsed: taskConfig.model,
      },
    });
  } catch (err) {
    console.error('[jobs] Background generation failed:', err);
    await fsPatch(projectId, accessToken, `asyncJobs/${jobId}`, {
      status: 'error',
      updatedAt: now(),
      error: err instanceof Error ? err.message : 'Unknown error',
    }).catch((patchErr) => {
      console.error('[jobs] Failed to update job error status in Firestore:', patchErr);
    });
  }
}
