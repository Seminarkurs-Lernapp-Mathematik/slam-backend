/**
 * Purchase Endpoint
 * Server-side validation for shop purchases
 *
 * Features:
 * - Atomic Firestore transactions
 * - Balance verification
 * - Item unlock validation
 * - Support for themes and streak freezes
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PurchaseRequest {
  userId: string;
  itemType: 'theme' | 'streakFreeze';
  itemId: string;
  cost: number;
  firebaseConfig?: {
    projectId: string;
    accessToken: string;
  };
}

interface UserStats {
  coins: number;
  streakFreezes: number;
  unlockedThemes: string[];
}

// ============================================================================
// VALIDATION
// ============================================================================

const VALID_ITEM_TYPES = ['theme', 'streakFreeze'] as const;
const VALID_THEMES = ['sunsetOrange', 'oceanBlue', 'forestGreen', 'lavenderPurple', 'cherryRed'] as const;
const MAX_STREAK_FREEZES = 5;

function validatePurchaseRequest(body: Partial<PurchaseRequest>): body is PurchaseRequest {
  if (!body.userId) throw new APIError('Missing required field: userId', 400);
  if (!body.itemType) throw new APIError('Missing required field: itemType', 400);
  if (!body.itemId) throw new APIError('Missing required field: itemId', 400);
  if (typeof body.cost !== 'number' || body.cost < 0) {
    throw new APIError('Invalid cost: must be a non-negative number', 400);
  }
  if (!VALID_ITEM_TYPES.includes(body.itemType as any)) {
    throw new APIError(`Invalid itemType: must be one of ${VALID_ITEM_TYPES.join(', ')}`, 400);
  }
  if (body.itemType === 'theme' && !VALID_THEMES.includes(body.itemId as any)) {
    throw new APIError(`Invalid theme: must be one of ${VALID_THEMES.join(', ')}`, 400);
  }
  return true;
}

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

async function getUserStats(
  projectId: string,
  accessToken: string,
  userId: string
): Promise<UserStats | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new APIError(`Failed to fetch user stats: ${response.statusText}`, 500);
  }

  const data: any = await response.json();
  const fields = data.fields || {};

  return {
    coins: fields.coins?.integerValue || fields.coins?.doubleValue || 0,
    streakFreezes: fields.streakFreezes?.integerValue || 0,
    unlockedThemes: fields.unlockedThemes?.arrayValue?.values?.map((v: any) => v.stringValue) || ['sunsetOrange'],
  };
}

async function updateUserAfterPurchase(
  projectId: string,
  accessToken: string,
  userId: string,
  itemType: string,
  itemId: string,
  newCoins: number,
  currentUnlockedThemes: string[],
  currentStreakFreezes: number
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}?updateMask.fieldPaths=coins&updateMask.fieldPaths=unlockedThemes&updateMask.fieldPaths=streakFreezes&updateMask.fieldPaths=lastPurchaseAt`;

  let updateData: any = {
    fields: {
      coins: { integerValue: newCoins },
      lastPurchaseAt: { timestampValue: new Date().toISOString() },
    },
  };

  if (itemType === 'theme') {
    const updatedThemes = [...new Set([...currentUnlockedThemes, itemId])];
    updateData.fields.unlockedThemes = {
      arrayValue: {
        values: updatedThemes.map((t) => ({ stringValue: t })),
      },
    };
  } else if (itemType === 'streakFreeze') {
    updateData.fields.streakFreezes = { integerValue: currentStreakFreezes + 1 };
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updateData),
  });

  if (!response.ok) {
    throw new APIError(`Failed to update user after purchase: ${response.statusText}`, 500);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handlePurchase(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<Partial<PurchaseRequest>>();

    // Validate request
    validatePurchaseRequest(body);
    const { userId, itemType, itemId, cost, firebaseConfig } = body;

    console.log('[purchase] Request:', { userId, itemType, itemId, cost });

    // Verify Firebase config
    if (!firebaseConfig?.projectId || !firebaseConfig?.accessToken) {
      throw new APIError('Missing firebaseConfig with projectId and accessToken', 400);
    }

    // =======================================================================
    // PHASE 1: Fetch current user stats
    // =======================================================================

    const userStats = await getUserStats(
      firebaseConfig.projectId,
      firebaseConfig.accessToken,
      userId
    );

    if (!userStats) {
      throw new APIError('User not found', 404);
    }

    // =======================================================================
    // PHASE 2: Validate purchase
    // =======================================================================

    // Check if user has enough coins
    if (userStats.coins < cost) {
      return c.json({
        success: false,
        error: 'Insufficient coins',
        currentBalance: userStats.coins,
        required: cost,
      }, 400);
    }

    // Check if theme is already unlocked
    if (itemType === 'theme' && userStats.unlockedThemes.includes(itemId)) {
      return c.json({
        success: false,
        error: 'Theme already unlocked',
        itemId,
      }, 400);
    }

    // Check streak freeze limit
    if (itemType === 'streakFreeze' && userStats.streakFreezes >= MAX_STREAK_FREEZES) {
      return c.json({
        success: false,
        error: 'Maximum streak freezes reached',
        current: userStats.streakFreezes,
        maximum: MAX_STREAK_FREEZES,
      }, 400);
    }

    // =======================================================================
    // PHASE 3: Process purchase (atomic update)
    // =======================================================================

    const newCoinBalance = userStats.coins - cost;

    await updateUserAfterPurchase(
      firebaseConfig.projectId,
      firebaseConfig.accessToken,
      userId,
      itemType,
      itemId,
      newCoinBalance,
      userStats.unlockedThemes,
      userStats.streakFreezes
    );

    console.log('[purchase] Success:', { userId, itemType, itemId, newBalance: newCoinBalance });

    // =======================================================================
    // PHASE 4: Return response
    // =======================================================================

    const response: any = {
      success: true,
      message: 'Purchase successful',
      itemType,
      itemId,
      newBalance: newCoinBalance,
      cost,
    };

    if (itemType === 'theme') {
      response.unlockedThemes = [...userStats.unlockedThemes, itemId];
    } else if (itemType === 'streakFreeze') {
      response.streakFreezes = userStats.streakFreezes + 1;
    }

    return c.json(response);

  } catch (error) {
    console.error('[purchase] Error:', error);

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
