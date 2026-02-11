import { Context } from 'hono';

interface GetModelsRequest {
  provider: 'claude' | 'gemini';
}

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  tier: 'fast' | 'standard' | 'smart';
  contextWindow: number;
}

interface GetModelsResponse {
  provider: 'claude' | 'gemini';
  models: ModelInfo[];
}

// Model definitions
const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-haiku-4-5-20251022',
    name: 'Claude 4.5 Haiku',
    description: 'Fastest model, great for simple tasks',
    tier: 'fast',
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude 4.5 Sonnet',
    description: 'Balanced performance and intelligence',
    tier: 'standard',
    contextWindow: 200000,
  },
  {
    id: 'claude-opus-4-6-20260508',
    name: 'Claude 4.6 Opus',
    description: 'Most capable model for complex reasoning',
    tier: 'smart',
    contextWindow: 200000,
  },
];

const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.0-flash-lite',
    name: 'Gemini 2.0 Flash Lite',
    description: 'Ultra-fast for quick responses',
    tier: 'fast',
    contextWindow: 100000,
  },
  {
    id: 'gemini-2.0-flash-exp',
    name: 'Gemini 2.0 Flash',
    description: 'Fast and efficient for most tasks',
    tier: 'fast',
    contextWindow: 100000,
  },
  {
    id: 'gemini-exp-1206',
    name: 'Gemini 3.0 Flash (Experimental)',
    description: 'Latest experimental flash model',
    tier: 'standard',
    contextWindow: 200000,
  },
  {
    id: 'gemini-exp-1121',
    name: 'Gemini 3.0 Pro (Experimental)',
    description: 'Advanced reasoning capabilities',
    tier: 'smart',
    contextWindow: 200000,
  },
];

export async function handleGetModels(c: Context): Promise<Response> {
  try {
    const { provider } = await c.req.query() as unknown as GetModelsRequest;

    if (!provider || !['claude', 'gemini'].includes(provider)) {
      return c.json(
        {
          error: 'Invalid provider. Must be "claude" or "gemini"',
        },
        400
      );
    }

    const models = provider === 'claude' ? CLAUDE_MODELS : GEMINI_MODELS;

    const response: GetModelsResponse = {
      provider,
      models,
    };

    return c.json(response, 200);
  } catch (error) {
    console.error('Error in get-models:', error);
    return c.json(
      {
        error: 'Failed to fetch models',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}
