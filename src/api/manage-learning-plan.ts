/**
 * Manage Learning Plan Endpoint
 * CRUD operations for learning plans
 *
 * Features:
 * - Create, read, update, delete learning plans
 * - Topic prioritization
 * - Progress tracking
 * - Smart recommendations
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import type { Topic } from '../types';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type LearningPlanAction = 'create' | 'get' | 'update' | 'delete' | 'add-topic' | 'remove-topic' | 'prioritize';

interface ManageLearningPlanRequest {
  action: LearningPlanAction;
  userId: string;
  planId?: string;
  planData?: Partial<LearningPlan>;
  topic?: Topic;
  apiKey?: string;
  firebaseConfig?: {
    projectId: string;
    accessToken: string;
  };
}

interface LearningPlan {
  id: string;
  userId: string;
  name: string;
  topics: LearningPlanTopic[];
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
  targetCompletionDate?: string;
  progress: {
    totalTopics: number;
    completedTopics: number;
    totalQuestions: number;
    completedQuestions: number;
    accuracy: number;
  };
}

interface LearningPlanTopic extends Topic {
  order: number;
  status: 'pending' | 'in-progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  addedAt: string;
  completedAt?: string;
}

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

async function getLearningPlan(
  projectId: string,
  accessToken: string,
  userId: string,
  planId: string
): Promise<LearningPlan | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/learningPlans/${planId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new APIError(`Failed to fetch learning plan: ${response.statusText}`, 500);
  }

  const data: any = await response.json();
  return documentToLearningPlan(data);
}

async function getActiveLearningPlan(
  projectId: string,
  accessToken: string,
  userId: string
): Promise<LearningPlan | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/learningPlans`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new APIError(`Failed to fetch learning plans: ${response.statusText}`, 500);
  }

  const data: any = await response.json();
  const documents = data.documents || [];

  // Find active plan
  const activePlan = documents
    .map(documentToLearningPlan)
    .find((plan: LearningPlan) => plan.status === 'active');

  return activePlan || null;
}

async function createLearningPlan(
  projectId: string,
  accessToken: string,
  userId: string,
  planData: Partial<LearningPlan>
): Promise<LearningPlan> {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  const plan: LearningPlan = {
    id: planId,
    userId,
    name: planData.name || 'Mein Lernplan',
    topics: planData.topics || [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    targetCompletionDate: planData.targetCompletionDate,
    progress: {
      totalTopics: 0,
      completedTopics: 0,
      totalQuestions: 0,
      completedQuestions: 0,
      accuracy: 0,
    },
  };

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/learningPlans/${planId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(learningPlanToDocument(plan)),
  });

  if (!response.ok) {
    throw new APIError(`Failed to create learning plan: ${response.statusText}`, 500);
  }

  return plan;
}

async function updateLearningPlan(
  projectId: string,
  accessToken: string,
  userId: string,
  plan: LearningPlan
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/learningPlans/${plan.id}`;

  const updatedPlan = {
    ...plan,
    updatedAt: new Date().toISOString(),
  };

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(learningPlanToDocument(updatedPlan)),
  });

  if (!response.ok) {
    throw new APIError(`Failed to update learning plan: ${response.statusText}`, 500);
  }
}

async function deleteLearningPlan(
  projectId: string,
  accessToken: string,
  userId: string,
  planId: string
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}/learningPlans/${planId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 404) {
    throw new APIError(`Failed to delete learning plan: ${response.statusText}`, 500);
  }
}

// ============================================================================
// DATA CONVERSION
// ============================================================================

function documentToLearningPlan(doc: any): LearningPlan {
  const fields = doc.fields || {};
  
  const topics = fields.topics?.arrayValue?.values?.map((v: any) => ({
    leitidee: v.mapValue?.fields?.leitidee?.stringValue || '',
    thema: v.mapValue?.fields?.thema?.stringValue || '',
    unterthema: v.mapValue?.fields?.unterthema?.stringValue || '',
    order: v.mapValue?.fields?.order?.integerValue || 0,
    status: v.mapValue?.fields?.status?.stringValue || 'pending',
    priority: v.mapValue?.fields?.priority?.stringValue || 'medium',
    addedAt: v.mapValue?.fields?.addedAt?.timestampValue || '',
    completedAt: v.mapValue?.fields?.completedAt?.timestampValue,
  })) || [];

  const progressFields = fields.progress?.mapValue?.fields || {};

  return {
    id: fields.id?.stringValue || '',
    userId: fields.userId?.stringValue || '',
    name: fields.name?.stringValue || '',
    topics,
    status: fields.status?.stringValue || 'active',
    createdAt: fields.createdAt?.timestampValue || '',
    updatedAt: fields.updatedAt?.timestampValue || '',
    targetCompletionDate: fields.targetCompletionDate?.timestampValue,
    progress: {
      totalTopics: progressFields.totalTopics?.integerValue || topics.length,
      completedTopics: progressFields.completedTopics?.integerValue || 0,
      totalQuestions: progressFields.totalQuestions?.integerValue || 0,
      completedQuestions: progressFields.completedQuestions?.integerValue || 0,
      accuracy: progressFields.accuracy?.doubleValue || progressFields.accuracy?.integerValue || 0,
    },
  };
}

function learningPlanToDocument(plan: LearningPlan): any {
  return {
    fields: {
      id: { stringValue: plan.id },
      userId: { stringValue: plan.userId },
      name: { stringValue: plan.name },
      topics: {
        arrayValue: {
          values: plan.topics.map((t) => ({
            mapValue: {
              fields: {
                leitidee: { stringValue: t.leitidee },
                thema: { stringValue: t.thema },
                unterthema: { stringValue: t.unterthema },
                order: { integerValue: t.order },
                status: { stringValue: t.status },
                priority: { stringValue: t.priority },
                addedAt: { timestampValue: t.addedAt },
                ...(t.completedAt && { completedAt: { timestampValue: t.completedAt } }),
              },
            },
          })),
        },
      },
      status: { stringValue: plan.status },
      createdAt: { timestampValue: plan.createdAt },
      updatedAt: { timestampValue: plan.updatedAt },
      ...(plan.targetCompletionDate && {
        targetCompletionDate: { timestampValue: plan.targetCompletionDate },
      }),
      progress: {
        mapValue: {
          fields: {
            totalTopics: { integerValue: plan.progress.totalTopics },
            completedTopics: { integerValue: plan.progress.completedTopics },
            totalQuestions: { integerValue: plan.progress.totalQuestions },
            completedQuestions: { integerValue: plan.progress.completedQuestions },
            accuracy: { doubleValue: plan.progress.accuracy },
          },
        },
      },
    },
  };
}

// ============================================================================
// TOPIC OPERATIONS
// ============================================================================

function addTopicToPlan(plan: LearningPlan, topic: Topic): LearningPlan {
  // Check if topic already exists
  const exists = plan.topics.some(
    (t) =>
      t.leitidee === topic.leitidee &&
      t.thema === topic.thema &&
      t.unterthema === topic.unterthema
  );

  if (exists) {
    throw new APIError('Topic already exists in learning plan', 400);
  }

  const newTopic: LearningPlanTopic = {
    ...topic,
    order: plan.topics.length,
    status: 'pending',
    priority: 'medium',
    addedAt: new Date().toISOString(),
  };

  return {
    ...plan,
    topics: [...plan.topics, newTopic],
    progress: {
      ...plan.progress,
      totalTopics: plan.topics.length + 1,
    },
  };
}

function removeTopicFromPlan(plan: LearningPlan, topic: Topic): LearningPlan {
  const filteredTopics = plan.topics.filter(
    (t) =>
      !(
        t.leitidee === topic.leitidee &&
        t.thema === topic.thema &&
        t.unterthema === topic.unterthema
      )
  );

  if (filteredTopics.length === plan.topics.length) {
    throw new APIError('Topic not found in learning plan', 404);
  }

  // Reorder remaining topics
  const reorderedTopics = filteredTopics.map((t, index) => ({
    ...t,
    order: index,
  }));

  const completedCount = reorderedTopics.filter((t) => t.status === 'completed').length;

  return {
    ...plan,
    topics: reorderedTopics,
    progress: {
      ...plan.progress,
      totalTopics: reorderedTopics.length,
      completedTopics: completedCount,
    },
  };
}

function prioritizeTopics(plan: LearningPlan): LearningPlan {
  // Simple prioritization: sort by difficulty estimation based on topic names
  const prioritizedTopics = [...plan.topics].sort((a, b) => {
    // Basic topics first
    const basicKeywords = ['einführung', 'grundlagen', 'basis', 'einfach'];
    const aIsBasic = basicKeywords.some((k) => a.unterthema.toLowerCase().includes(k));
    const bIsBasic = basicKeywords.some((k) => b.unterthema.toLowerCase().includes(k));

    if (aIsBasic && !bIsBasic) return -1;
    if (!aIsBasic && bIsBasic) return 1;

    // Then by current order
    return a.order - b.order;
  });

  // Reassign order numbers
  const reorderedTopics = prioritizedTopics.map((t, index) => ({
    ...t,
    order: index,
  }));

  return {
    ...plan,
    topics: reorderedTopics,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleManageLearningPlan(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<Partial<ManageLearningPlanRequest>>();

    // Validate required fields
    const { action, userId } = body;
    if (!action || !userId) {
      throw new APIError('Missing required fields: action, userId', 400);
    }

    const validActions: LearningPlanAction[] = [
      'create', 'get', 'update', 'delete', 'add-topic', 'remove-topic', 'prioritize'
    ];
    if (!validActions.includes(action)) {
      throw new APIError(`Invalid action: must be one of ${validActions.join(', ')}`, 400);
    }

    // Verify Firebase config
    const { firebaseConfig } = body;
    if (!firebaseConfig?.projectId || !firebaseConfig?.accessToken) {
      throw new APIError('Missing firebaseConfig with projectId and accessToken', 400);
    }

    console.log('[manage-learning-plan] Action:', { action, userId });

    // =======================================================================
    // HANDLE ACTIONS
    // =======================================================================

    switch (action) {
      case 'create': {
        const plan = await createLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          body.planData || {}
        );

        return c.json({
          success: true,
          action: 'create',
          plan,
        });
      }

      case 'get': {
        let plan: LearningPlan | null;

        if (body.planId) {
          plan = await getLearningPlan(
            firebaseConfig.projectId,
            firebaseConfig.accessToken,
            userId,
            body.planId
          );
        } else {
          // Get active plan
          plan = await getActiveLearningPlan(
            firebaseConfig.projectId,
            firebaseConfig.accessToken,
            userId
          );
        }

        if (!plan) {
          return c.json({
            success: true,
            action: 'get',
            plan: null,
            message: 'No active learning plan found',
          });
        }

        return c.json({
          success: true,
          action: 'get',
          plan,
        });
      }

      case 'update': {
        if (!body.planId || !body.planData) {
          throw new APIError('Missing planId or planData for update action', 400);
        }

        const existingPlan = await getLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          body.planId
        );

        if (!existingPlan) {
          throw new APIError('Learning plan not found', 404);
        }

        const updatedPlan: LearningPlan = {
          ...existingPlan,
          ...body.planData,
          id: existingPlan.id, // Prevent ID change
          userId: existingPlan.userId, // Prevent userId change
        };

        await updateLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          updatedPlan
        );

        return c.json({
          success: true,
          action: 'update',
          plan: updatedPlan,
        });
      }

      case 'delete': {
        if (!body.planId) {
          throw new APIError('Missing planId for delete action', 400);
        }

        await deleteLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          body.planId
        );

        return c.json({
          success: true,
          action: 'delete',
          planId: body.planId,
        });
      }

      case 'add-topic': {
        if (!body.topic) {
          throw new APIError('Missing topic for add-topic action', 400);
        }

        // Get or create active plan
        let plan = await getActiveLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId
        );

        if (!plan) {
          plan = await createLearningPlan(
            firebaseConfig.projectId,
            firebaseConfig.accessToken,
            userId,
            { name: 'Mein Lernplan' }
          );
        }

        const updatedPlan = addTopicToPlan(plan, body.topic);

        await updateLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          updatedPlan
        );

        return c.json({
          success: true,
          action: 'add-topic',
          plan: updatedPlan,
        });
      }

      case 'remove-topic': {
        if (!body.topic) {
          throw new APIError('Missing topic for remove-topic action', 400);
        }

        const plan = await getActiveLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId
        );

        if (!plan) {
          throw new APIError('No active learning plan found', 404);
        }

        const updatedPlan = removeTopicFromPlan(plan, body.topic);

        await updateLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          updatedPlan
        );

        return c.json({
          success: true,
          action: 'remove-topic',
          plan: updatedPlan,
        });
      }

      case 'prioritize': {
        const plan = await getActiveLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId
        );

        if (!plan) {
          throw new APIError('No active learning plan found', 404);
        }

        const updatedPlan = prioritizeTopics(plan);

        await updateLearningPlan(
          firebaseConfig.projectId,
          firebaseConfig.accessToken,
          userId,
          updatedPlan
        );

        return c.json({
          success: true,
          action: 'prioritize',
          plan: updatedPlan,
        });
      }

      default:
        throw new APIError(`Unhandled action: ${action}`, 500);
    }

  } catch (error) {
    console.error('[manage-learning-plan] Error:', error);

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
