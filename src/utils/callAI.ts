/**
 * Shared AI Provider Helper
 * Supports Claude, Gemini, Mistral, OpenAI, and OpenRouter (backend-managed API keys)
 *
 * OpenAI, Mistral, and OpenRouter all use the same Chat Completions API
 * structure (/v1/chat/completions), so they share a single code path (DRY).
 *
 * Model configuration lives in src/config/models.json — edit that file to
 * change which model/provider handles each task.
 */

import type { Env } from '../index';
import modelsJsonConfig from '../config/models.json';

const AI_ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  openai: 'https://api.openai.com/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
} as const;

export type AIProviderType = 'claude' | 'gemini' | 'openai' | 'mistral' | 'openrouter';

/** Providers that use the OpenAI-compatible Chat Completions API shape */
const OPENAI_COMPAT_PROVIDERS: Set<AIProviderType> = new Set(['openai', 'mistral', 'openrouter']);

export interface CallAIOptions {
  provider: AIProviderType;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  env: Env;
}

/**
 * Get API key for a provider from environment variables
 */
function getApiKey(provider: AIProviderType, env: Env): string {
  switch (provider) {
    case 'claude':
      if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
      throw new Error('ANTHROPIC_API_KEY not configured in environment');
    case 'gemini':
      if (env.GEMINI_API_KEY) return env.GEMINI_API_KEY;
      throw new Error('GEMINI_API_KEY not configured in environment');
    case 'openai':
      if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY;
      throw new Error('OPENAI_API_KEY not configured in environment');
    case 'mistral':
      if (env.MISTRAL_API_KEY) return env.MISTRAL_API_KEY;
      throw new Error('MISTRAL_API_KEY not configured in environment');
    case 'openrouter':
      if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
      throw new Error('OPENROUTER_API_KEY not configured in environment');
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Build extra headers for OpenAI-compatible providers
 */
function getOpenAICompatHeaders(provider: AIProviderType, apiKey: string): Record<string, string> {
  switch (provider) {
    case 'openai':
      return { 'Authorization': `Bearer ${apiKey}` };
    case 'mistral':
      return { 'Authorization': `Bearer ${apiKey}` };
    case 'openrouter':
      return {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://learn-smart.app',
        'X-Title': 'SLAM Lernapp',
      };
    default:
      return {};
  }
}

export async function callAI({
  provider,
  model,
  prompt,
  temperature = 0.7,
  maxTokens = 8000,
  systemPrompt,
  env,
}: CallAIOptions): Promise<string> {
  const apiKey = getApiKey(provider, env);

  // ── Anthropic Claude (Messages API) ──────────────────────────────────
  if (provider === 'claude') {
    const messages: any[] = [{ role: 'user', content: prompt }];
    const body: any = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages,
    };
    if (systemPrompt) body.system = systemPrompt;

    const response = await fetch(AI_ENDPOINTS.claude, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Enable extended output so large batches (20 questions) aren't truncated
        'anthropic-beta': 'output-128k-2025-02-19',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody: any = await response.json().catch(() => null);
      const safeMessage = errorBody?.error?.message || response.statusText;
      throw new Error(`Claude API error (${response.status}): ${safeMessage}`);
    }

    const data: any = await response.json();
    return data.content[0].text;
  }

  // ── Google Gemini (GenerateContent API) ───────────────────────────────
  if (provider === 'gemini') {
    const endpoint = `${AI_ENDPOINTS.gemini}/${model}:generateContent?key=${apiKey}`;
    const contents: any[] = [];
    if (systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: `System: ${systemPrompt}/n/n${prompt}` }] });
    } else {
      contents.push({ parts: [{ text: prompt }] });
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    });

    if (!response.ok) {
      let errorMessage = `Gemini API error (${response.status})`;
      try {
        const errorJson: any = await response.json();
        errorMessage = errorJson?.error?.message || errorMessage;
      } catch { /* use default message */ }
      throw new Error(errorMessage);
    }

    const data: any = await response.json();
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      const blockReason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason;
      throw new Error(`Gemini returned no content. Block reason: ${blockReason || 'unknown'}`);
    }
    return data.candidates[0].content.parts[0].text;
  }

  // ── OpenAI-Compatible Providers (OpenAI, Mistral, OpenRouter) ──────────
  // All three use the same /v1/chat/completions request/response shape
  if (OPENAI_COMPAT_PROVIDERS.has(provider)) {
    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(AI_ENDPOINTS[provider], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getOpenAICompatHeaders(provider, apiKey),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorBody: any = await response.json().catch(() => null);
      const safeMessage = errorBody?.error?.message || response.statusText;
      throw new Error(`${provider} API error (${response.status}): ${safeMessage}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      const finishReason = data.choices?.[0]?.finish_reason || 'unknown';
      throw new Error(`${provider} returned no content. Finish reason: ${finishReason}`);
    }
    return content;
  }

  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Task-specific model configuration
 */
export interface TaskModelConfig {
  description: string;
  provider: AIProviderType;
  model: string;
  temperature: number;
  timeout: number;
  maxTokens: number;
  systemPrompt?: string;
}

export interface ModelConfig {
  version: string;
  providers: {
    [key: string]: {
      name: string;
      endpoint: string;
      envKey: string;
    };
  };
  tasks: {
    [key: string]: TaskModelConfig;
  };
  features: {
    logModelUsage: boolean;
    allowFallbackOnError: boolean;
    fallbackProvider: AIProviderType;
    fallbackModel: string;
  };
}

// Cache for model config
let modelConfigCache: ModelConfig | null = null;

/**
 * Load model configuration from src/config/models.json.
 * The JSON is bundled at build time by Wrangler/esbuild, so there is no
 * filesystem access at runtime — editing models.json and deploying is all
 * that is needed to change models or prompts.
 */
export async function loadModelConfig(): Promise<ModelConfig> {
  if (modelConfigCache) {
    return modelConfigCache;
  }

  modelConfigCache = modelsJsonConfig as unknown as ModelConfig;
  return modelConfigCache;
}

/**
 * Get model configuration for a specific task
 */
export async function getTaskModelConfig(taskName: string): Promise<TaskModelConfig> {
  const config = await loadModelConfig();
  const taskConfig = config.tasks[taskName];

  if (!taskConfig) {
    throw new Error(`Unknown task: ${taskName}`);
  }

  return taskConfig;
}

export interface CallVisionAIOptions {
  provider: AIProviderType;
  model: string;
  imageBase64: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  mimeType?: string;
  env: Env;
}

/**
 * Call AI with vision capabilities (for image analysis)
 */
export async function callVisionAI({
  provider,
  model,
  imageBase64,
  prompt,
  temperature = 0.4,
  maxTokens = 4000,
  mimeType = 'image/png',
  env,
}: CallVisionAIOptions): Promise<string> {
  const apiKey = getApiKey(provider, env);

  // ── Claude Vision ──────────────────────────────────────────────────────
  if (provider === 'claude') {
    const response = await fetch(AI_ENDPOINTS.claude, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errorBody: any = await response.json().catch(() => null);
      const safeMessage = errorBody?.error?.message || response.statusText;
      throw new Error(`Claude Vision API error (${response.status}): ${safeMessage}`);
    }

    const data: any = await response.json();
    return data.content[0].text;
  }

  // ── Gemini Vision ──────────────────────────────────────────────────────
  if (provider === 'gemini') {
    const endpoint = `${AI_ENDPOINTS.gemini}/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64,
              },
            },
          ],
        }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    });

    if (!response.ok) {
      let errorMessage = `Gemini Vision API error (${response.status})`;
      try {
        const errorJson: any = await response.json();
        errorMessage = errorJson?.error?.message || errorMessage;
      } catch { /* use default message */ }
      throw new Error(errorMessage);
    }

    const data: any = await response.json();
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      const blockReason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason;
      throw new Error(`Gemini returned no content. Block reason: ${blockReason || 'unknown'}`);
    }
    return data.candidates[0].content.parts[0].text;
  }

  // ── OpenAI-Compatible Vision (OpenAI, Mistral, OpenRouter) ─────────────
  if (OPENAI_COMPAT_PROVIDERS.has(provider)) {
    const messages: any[] = [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${imageBase64}`,
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ],
    }];

    const response = await fetch(AI_ENDPOINTS[provider], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getOpenAICompatHeaders(provider, apiKey),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorBody: any = await response.json().catch(() => null);
      const safeMessage = errorBody?.error?.message || response.statusText;
      throw new Error(`${provider} Vision API error (${response.status}): ${safeMessage}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      const finishReason = data.choices?.[0]?.finish_reason || 'unknown';
      throw new Error(`${provider} returned no content. Finish reason: ${finishReason}`);
    }
    return content;
  }

  throw new Error(`Vision not supported for provider: ${provider}`);
}

/**
 * Call AI for a specific task using its configured model and system prompt
 *
 * @param taskName - The name of the task (must exist in models.json)
 * @param prompt - The user prompt
 * @param env - Environment variables for API keys
 * @param systemPromptOverride - Optional override for the system prompt from config
 */
export async function callAIForTask(
  taskName: string,
  prompt: string,
  env: Env,
  systemPromptOverride?: string
): Promise<{ response: string; provider: string; model: string }> {
  const config = await getTaskModelConfig(taskName);

  // Use override if provided, otherwise use config's system prompt
  const systemPrompt = systemPromptOverride ?? config.systemPrompt;

  try {
    const response = await callAI({
      provider: config.provider,
      model: config.model,
      prompt,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt,
      env,
    });

    return {
      response,
      provider: config.provider,
      model: config.model,
    };
  } catch (error) {
    // Try fallback if enabled
    const modelConfig = await loadModelConfig();
    if (modelConfig.features.allowFallbackOnError && config.provider !== modelConfig.features.fallbackProvider) {
      console.warn(`[callAIForTask] Primary model failed for ${taskName}, trying fallback`);

      const fallbackResponse = await callAI({
        provider: modelConfig.features.fallbackProvider,
        model: modelConfig.features.fallbackModel,
        prompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        systemPrompt,
        env,
      });

      return {
        response: fallbackResponse,
        provider: modelConfig.features.fallbackProvider,
        model: modelConfig.features.fallbackModel,
      };
    }

    throw error;
  }
}
