/**
 * OpenRouter API Utilities
 * Handles API calls to OpenRouter for accessing free models
 */

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
  };
}

/**
 * Call OpenRouter API
 */
export async function callOpenRouter({
  apiKey,
  model,
  messages,
  temperature = 0.4,
  maxTokens = 4000,
}: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://learn-smart.app',
      'X-Title': 'SLAM Learning App',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    } as OpenRouterRequest),
  });

  if (!response.ok) {
    const errorData: any = await response.json().catch(() => ({}));
    throw new Error(
      `OpenRouter API error: ${(errorData as any)?.error?.message || response.statusText}`
    );
  }

  const data: OpenRouterResponse = await response.json();
  
  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message}`);
  }

  if (!data.choices?.[0]?.message?.content) {
    throw new Error('OpenRouter returned empty response');
  }

  return data.choices[0].message.content;
}

/**
 * Check if a provider string is OpenRouter
 */
export function isOpenRouter(provider: string): boolean {
  return provider === 'openrouter';
}

/**
 * Convert model ID to OpenRouter format if needed
 */
export function toOpenRouterModel(modelId: string): string {
  // If already in OpenRouter format, return as-is
  if (modelId.includes('/')) {
    return modelId;
  }
  
  // Map common model names to OpenRouter equivalents
  const modelMap: Record<string, string> = {
    'gemini-2.0-flash': 'google/gemini-2.0-flash-exp:free',
    'gemini-2.0-flash-lite': 'google/gemini-2.0-flash-exp:free',
    'claude-sonnet': 'anthropic/claude-3.5-sonnet',
    'claude-haiku': 'anthropic/claude-3.5-haiku',
  };

  return modelMap[modelId] || 'google/gemini-2.0-flash-exp:free';
}
