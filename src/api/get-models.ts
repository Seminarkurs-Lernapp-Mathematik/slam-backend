import { Context } from 'hono';

interface GetModelsRequest {
  provider: 'claude' | 'gemini' | 'openrouter';
}

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  tier: 'fast' | 'standard' | 'smart';
  contextWindow: number;
}

interface GetModelsResponse {
  provider: 'claude' | 'gemini' | 'openrouter';
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

// OpenRouter free models
const OPENROUTER_MODELS: ModelInfo[] = [
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash (Free)',
    description: 'Free tier - Fast responses via OpenRouter',
    tier: 'fast',
    contextWindow: 100000,
  },
  {
    id: 'google/gemini-2.0-flash-thinking-exp:free',
    name: 'Gemini 2.0 Flash Thinking (Free)',
    description: 'Free tier - Enhanced reasoning via OpenRouter',
    tier: 'standard',
    contextWindow: 100000,
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 (Free)',
    description: 'Free tier - Advanced reasoning model',
    tier: 'smart',
    contextWindow: 128000,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B (Free)',
    description: 'Free tier - Meta LLM via OpenRouter',
    tier: 'standard',
    contextWindow: 128000,
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
    name: 'Nemotron 70B (Free)',
    description: 'Free tier - NVIDIA optimized via OpenRouter',
    tier: 'smart',
    contextWindow: 128000,
  },
];

export async function handleGetModels(c: Context): Promise<Response> {
  try {
    const { provider } = await c.req.query() as unknown as GetModelsRequest;

    if (!provider || !['claude', 'gemini', 'openrouter'].includes(provider)) {
      return c.json(
        {
          error: 'Invalid provider. Must be "claude", "gemini", or "openrouter"',
        },
        400
      );
    }

    let models: ModelInfo[];
    switch (provider) {
      case 'claude':
        models = CLAUDE_MODELS;
        break;
      case 'openrouter':
        models = OPENROUTER_MODELS;
        break;
      case 'gemini':
      default:
        models = GEMINI_MODELS;
        break;
    }

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
