/**
 * Manage Memories Endpoint
 * Spaced repetition system for long-term retention
 *
 * Features:
 * - SM-2 algorithm implementation
 * - Create, review, and manage memory items
 * - Due date calculations
 * - Statistics tracking
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type MemoryAction = 'create' | 'review' | 'get-due' | 'get-stats' | 'delete';

interface ManageMemoriesRequest {
  action: MemoryAction;
  userId: string;
  memoryId?: string;
  memoryData?: Partial<MemoryItem>;
  quality?: number; // 0-5 for SM-2 algorithm
  firebaseConfig?: {
    projectId: string;
    accessToken: string;
  };
}

interface MemoryItem {
  id: string;
  userId: string;
  questionId: string;
  questionText: string;
  topic: string;
  subtopic: string;
  difficulty: number;
  createdAt: string;
  lastReviewed: string;
  nextReview: string;
  repetitions: number;
  easeFactor: number;
  interval: number; // in days
}

// ============================================================================
// SM-2 ALGORITHM CONSTANTS
// ============================================================================

const SM2_DEFAULTS = {
  INITIAL_EASE_FACTOR: 2.5,
  MIN_EASE_FACTOR: 1.3,
  INITIAL_INTERVAL: 1, // 1 day
};

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

async function getMemoryItem(
  projectId: string,
  accessToken: string,
  userId: string,
  memoryId: string
): Promise<MemoryItem | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/memories/${memoryId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new APIError(`Failed to fetch memory: ${response.statusText}`, 500);
  }

  const data: any = await response.json();
  return documentToMemory(data);
}

async function getDueMemories(
  projectId: string,
  accessToken: string,
  userId: string
): Promise<MemoryItem[]> {
  const now = new Date().toISOString();
  
  // Query for memories where nextReview <= now
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/memories`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new APIError(`Failed to fetch memories: ${response.statusText}`, 500);
  }

  const data: any = await response.json();
  const documents = data.documents || [];

  return documents
    .map(documentToMemory)
    .filter((m: MemoryItem) => m.nextReview <= now)
    .sort((a: MemoryItem, b: MemoryItem) => 
      new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime()
    );
}

async function getAllMemories(
  projectId: string,
  accessToken: string,
  userId: string
): Promise<MemoryItem[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/memories`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new APIError(`Failed to fetch memories: ${response.statusText}`, 500);
  }

  const data: any = await response.json();
  const documents = data.documents || [];

  return documents.map(documentToMemory);
}

async function createMemory(
  projectId: string,
  accessToken: string,
  userId: string,
  memoryData: Partial<MemoryItem>
): Promise<MemoryItem> {
  const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  const memory: MemoryItem = {
    id: memoryId,
    userId,
    questionId: memoryData.questionId || '',
    questionText: memoryData.questionText || '',
    topic: memoryData.topic || 'Allgemein',
    subtopic: memoryData.subtopic || 'Allgemein',
    difficulty: memoryData.difficulty || 5,
    createdAt: now,
    lastReviewed: now,
    nextReview: now, // Due immediately
    repetitions: 0,
    easeFactor: SM2_DEFAULTS.INITIAL_EASE_FACTOR,
    interval: SM2_DEFAULTS.INITIAL_INTERVAL,
  };

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/memories/${memoryId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(memoryToDocument(memory)),
  });

  if (!response.ok) {
    throw new APIError(`Failed to create memory: ${response.statusText}`, 500);
  }

  return memory;
}

async function updateMemory(
  projectId: string,
  accessToken: string,
  userId: string,
  memory: MemoryItem
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/memories/${memory.id}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(memoryToDocument(memory)),
  });

  if (!response.ok) {
    throw new APIError(`Failed to update memory: ${response.statusText}`, 500);
  }
}

async function deleteMemory(
  projectId: string,
  accessToken: string,
  userId: string,
  memoryId: string
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/memories/${memoryId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 404) {
    throw new APIError(`Failed to delete memory: ${response.statusText}`, 500);
  }
}

// ============================================================================
// DATA CONVERSION
// ============================================================================

function documentToMemory(doc: any): MemoryItem {
  const fields = doc.fields || {};
  return {
    id: fields.id?.stringValue || '',
    userId: fields.userId?.stringValue || '',
    questionId: fields.questionId?.stringValue || '',
    questionText: fields.questionText?.stringValue || '',
    topic: fields.topic?.stringValue || '',
    subtopic: fields.subtopic?.stringValue || '',
    difficulty: fields.difficulty?.integerValue || 5,
    createdAt: fields.createdAt?.timestampValue || '',
    lastReviewed: fields.lastReviewed?.timestampValue || '',
    nextReview: fields.nextReview?.timestampValue || '',
    repetitions: fields.repetitions?.integerValue || 0,
    easeFactor: fields.easeFactor?.doubleValue || fields.easeFactor?.integerValue || 2.5,
    interval: fields.interval?.integerValue || 1,
  };
}

function memoryToDocument(memory: MemoryItem): any {
  return {
    fields: {
      id: { stringValue: memory.id },
      userId: { stringValue: memory.userId },
      questionId: { stringValue: memory.questionId },
      questionText: { stringValue: memory.questionText },
      topic: { stringValue: memory.topic },
      subtopic: { stringValue: memory.subtopic },
      difficulty: { integerValue: memory.difficulty },
      createdAt: { timestampValue: memory.createdAt },
      lastReviewed: { timestampValue: memory.lastReviewed },
      nextReview: { timestampValue: memory.nextReview },
      repetitions: { integerValue: memory.repetitions },
      easeFactor: { doubleValue: memory.easeFactor },
      interval: { integerValue: memory.interval },
    },
  };
}

// ============================================================================
// SM-2 ALGORITHM
// ============================================================================

function calculateSM2(
  currentInterval: number,
  currentRepetitions: number,
  currentEaseFactor: number,
  quality: number
): { interval: number; repetitions: number; easeFactor: number } {
  // Quality: 0-5 (0 = complete blackout, 5 = perfect response)
  
  let newInterval: number;
  let newRepetitions: number;
  let newEaseFactor: number;

  if (quality < 3) {
    // Failed recall - start over
    newRepetitions = 0;
    newInterval = 1;
    newEaseFactor = currentEaseFactor;
  } else {
    // Successful recall
    newRepetitions = currentRepetitions + 1;

    if (newRepetitions === 1) {
      newInterval = 1;
    } else if (newRepetitions === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.round(currentInterval * currentEaseFactor);
    }

    // Update ease factor
    newEaseFactor = currentEaseFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    newEaseFactor = Math.max(SM2_DEFAULTS.MIN_EASE_FACTOR, newEaseFactor);
  }

  return {
    interval: newInterval,
    repetitions: newRepetitions,
    easeFactor: newEaseFactor,
  };
}

function calculateNextReviewDate(intervalDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + intervalDays);
  return date.toISOString();
}

// ============================================================================
// STATS CALCULATION
// ============================================================================

function calculateStats(memories: MemoryItem[]) {
  const now = new Date().toISOString();
  const dueCount = memories.filter((m) => m.nextReview <= now).length;
  
  const totalReviews = memories.reduce((sum, m) => sum + m.repetitions, 0);
  const avgEaseFactor = memories.length > 0
    ? memories.reduce((sum, m) => sum + m.easeFactor, 0) / memories.length
    : 0;

  const byTopic: Record<string, number> = {};
  memories.forEach((m) => {
    byTopic[m.topic] = (byTopic[m.topic] || 0) + 1;
  });

  return {
    totalMemories: memories.length,
    dueForReview: dueCount,
    totalReviews,
    averageEaseFactor: Math.round(avgEaseFactor * 100) / 100,
    byTopic,
    nextReviewDue: memories.length > 0
      ? memories.sort((a, b) => 
          new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime()
        )[0].nextReview
      : null,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleManageMemories(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<Partial<ManageMemoriesRequest>>();

    // Validate required fields
    const { action, userId } = body;
    if (!action || !userId) {
      throw new APIError('Missing required fields: action, userId', 400);
    }

    const validActions: MemoryAction[] = ['create', 'review', 'get-due', 'get-stats', 'delete'];
    if (!validActions.includes(action)) {
      throw new APIError(`Invalid action: must be one of ${validActions.join(', ')}`, 400);
    }

    // Verify Firebase config
    const { firebaseConfig } = body;
    if (!firebaseConfig?.projectId || !firebaseConfig?.accessToken) {
      throw new APIError('Missing firebaseConfig with projectId and accessToken', 400);
    }

    console.log('[manage-memories] Action:', { action, userId });

    // =======================================================================
    // HANDLE ACTIONS
    // =======================================================================

    switch (action) {
      case 'create': {
        if (!body.memoryData) {
          throw new APIError('Missing memoryData for create action', 400);
        }

        const memory = await createMemory(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          body.memoryData
        );

        return c.json({
          success: true,
          action: 'create',
          memory,
        });
      }

      case 'review': {
        if (!body.memoryId) {
          throw new APIError('Missing memoryId for review action', 400);
        }
        if (typeof body.quality !== 'number' || body.quality < 0 || body.quality > 5) {
          throw new APIError('Invalid quality: must be 0-5', 400);
        }

        const memory = await getMemoryItem(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          body.memoryId
        );

        if (!memory) {
          throw new APIError('Memory item not found', 404);
        }

        // Apply SM-2 algorithm
        const sm2Result = calculateSM2(
          memory.interval,
          memory.repetitions,
          memory.easeFactor,
          body.quality
        );

        // Update memory
        const updatedMemory: MemoryItem = {
          ...memory,
          repetitions: sm2Result.repetitions,
          easeFactor: sm2Result.easeFactor,
          interval: sm2Result.interval,
          lastReviewed: new Date().toISOString(),
          nextReview: calculateNextReviewDate(sm2Result.interval),
        };

        await updateMemory(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          updatedMemory
        );

        return c.json({
          success: true,
          action: 'review',
          memory: updatedMemory,
          sm2Result,
        });
      }

      case 'get-due': {
        const dueMemories = await getDueMemories(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId
        );

        return c.json({
          success: true,
          action: 'get-due',
          memories: dueMemories,
          count: dueMemories.length,
        });
      }

      case 'get-stats': {
        const allMemories = await getAllMemories(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId
        );

        const stats = calculateStats(allMemories);

        return c.json({
          success: true,
          action: 'get-stats',
          stats,
        });
      }

      case 'delete': {
        if (!body.memoryId) {
          throw new APIError('Missing memoryId for delete action', 400);
        }

        await deleteMemory(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          body.memoryId
        );

        return c.json({
          success: true,
          action: 'delete',
          memoryId: body.memoryId,
        });
      }

      default:
        throw new APIError(`Unhandled action: ${action}`, 500);
    }

  } catch (error) {
    console.error('[manage-memories] Error:', error);

    if (error instanceof APIError) {
      return c.json({ success: false, error: error.message }, error.statusCode);
    }

    return c.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}
