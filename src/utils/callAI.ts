/**
 * Shared AI Provider Helper
 * Supports Claude and Gemini (backend-managed API keys)
 */

import type { Env } from '../index';

const AI_ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
} as const;

export type AIProviderType = 'claude' | 'gemini';

export interface CallAIOptions {
  provider: AIProviderType;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  env: Env;  // Environment variables for API keys
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
    default:
      throw new Error(`Unknown provider: ${provider}`);
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
  
  switch (provider) {
    case 'claude': {
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
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`Claude API error (${response.status}): ${JSON.stringify(error)}`);
      }

      const data: any = await response.json();
      return data.content[0].text;
    }

    case 'gemini': {
      const endpoint = `${AI_ENDPOINTS.gemini}/${model}:generateContent?key=${apiKey}`;
      const contents: any[] = [];
      if (systemPrompt) {
        contents.push({ role: 'user', parts: [{ text: `System: ${systemPrompt}\n\n${prompt}` }] });
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
        const errorText = await response.text();
        let errorMessage = `Gemini API error (${response.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorMessage;
        } catch { errorMessage = errorText || errorMessage; }
        throw new Error(errorMessage);
      }

      const data: any = await response.json();
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const blockReason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason;
        throw new Error(`Gemini returned no content. Block reason: ${blockReason || 'unknown'}`);
      }
      return data.candidates[0].content.parts[0].text;
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
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
 * Load model configuration
 */
export async function loadModelConfig(): Promise<ModelConfig> {
  if (modelConfigCache) {
    return modelConfigCache;
  }

  // Default configuration embedded for Cloudflare Workers
  // NOTE: Edit config/models.json for easier configuration
  const defaultConfig: ModelConfig = {
    version: "2.1.0",
    providers: {
      gemini: {
        name: "Google Gemini",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
        envKey: "GEMINI_API_KEY"
      },
      claude: {
        name: "Anthropic Claude",
        endpoint: "https://api.anthropic.com/v1/messages",
        envKey: "ANTHROPIC_API_KEY"
      }
    },
    tasks: {
      generateQuestions: {
        description: "Generate math questions for students",
        provider: "claude",
        model: "claude-sonnet-4-6",
        temperature: 0.7,
        timeout: 60000,
        maxTokens: 8000,
        systemPrompt: "Du bist ein erfahrener Mathematiklehrer für deutsche Gymnasien. Du erstellst hochwertige, didaktisch durchdachte Mathematikaufgaben für Schüler. Du kennst die Anforderungsbereiche (AFB) I, II und III des deutschen Bildungssystems. Du nutzt LaTeX für mathematische Formeln. Du antwortest immer auf Deutsch."
      },
      evaluateAnswer: {
        description: "Evaluate student answers and provide feedback",
        provider: "gemini",
        model: "gemini-flash-latest",
        temperature: 0.5,
        timeout: 45000,
        maxTokens: 6000,
        systemPrompt: "Du bist ein geduldiger Mathematiklehrer, der Schülerantworten fair und konstruktiv bewertet. Du erkennst häufige Fehler und Missverständnisse. Du gibst präzises, ermutigendes Feedback. Du nutzt LaTeX für mathematische Formeln. Du antwortest immer auf Deutsch."
      },
      customHint: {
        description: "Generate personalized hints for students",
        provider: "gemini",
        model: "gemini-flash-latest",
        temperature: 0.6,
        timeout: 30000,
        maxTokens: 4000,
        systemPrompt: "Du bist ein einfühlsamer Mathematiklehrer, der gezielte Hinweise gibt, ohne die Lösung zu verraten. Deine Hinweise sind progressiv: Der erste Hinweis ist sanft, der zweite spezifischer, der dritte fast eine vollständige Lösung. Du antwortest immer auf Deutsch."
      },
      generateMiniApp: {
        description: "Generate interactive mini applications",
        provider: "claude",
        model: "claude-sonnet-4-6",
        temperature: 0.7,
        timeout: 60000,
        maxTokens: 8000,
        systemPrompt: "Du bist ein erfahrener Webentwickler und Mathematiklehrer. Du erstellst interaktive HTML/JavaScript-Mini-Apps zum Lernen von Mathematik. Deine Apps sind selbst-contained, modern und funktionieren ohne externe Bibliotheken. Du nutzt LaTeX für mathematische Formeln. Du antwortest immer auf Deutsch."
      },
      generateGeogebra: {
        description: "Generate GeoGebra applets",
        provider: "claude",
        model: "claude-sonnet-4-6",
        temperature: 0.6,
        timeout: 60000,
        maxTokens: 6000,
        systemPrompt: "Du bist ein GeoGebra-Experte und Mathematiklehrer. Du erstellt GeoGebra-Applets, die mathematische Konzepte visualisieren. Du kennst die GeoGebra-Scripting-Syntax und erstellst interaktive, lehrreiche Applets. Du antwortest immer auf Deutsch."
      },
      analyzeImage: {
        description: "Analyze uploaded images for math problems",
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        temperature: 0.5,
        timeout: 45000,
        maxTokens: 6000,
        systemPrompt: "Du bist ein Mathematiklehrer, der Bilder von mathematischen Aufgaben analysiert. Du erkennst Aufgabentypen, Schwierigkeitsgrade und relevante Themen. Du schlägst passende Lerninhalte vor. Du antwortest immer auf Deutsch."
      },
      updateAutoMode: {
        description: "Adjust AI difficulty based on performance",
        provider: "gemini",
        model: "gemini-flash-latest",
        temperature: 0.4,
        timeout: 30000,
        maxTokens: 4000,
        systemPrompt: "Du bist ein adaptives Lernsystem, das den Schwierigkeitsgrad an die Leistung von Schülern anpasst. Du analysierst Lernfortschritte und passt Detailgrad, Hilfestellung und Komplexität an. Du antwortest immer auf Deutsch."
      },
      manageMemories: {
        description: "Manage student learning memories",
        provider: "gemini",
        model: "gemini-flash-latest",
        temperature: 0.5,
        timeout: 30000,
        maxTokens: 4000,
        systemPrompt: "Du bist ein Spaced-Repetition-System für mathematisches Lernen. Du analysierst, welche Themen ein Schüler wiederholen sollte, basierend auf seinen Fehlern und dem Zeitablauf. Du antwortest immer auf Deutsch."
      },
      manageLearningPlan: {
        description: "Generate and update learning plans",
        provider: "gemini",
        model: "gemini-flash-latest",
        temperature: 0.6,
        timeout: 45000,
        maxTokens: 6000,
        systemPrompt: "Du bist ein erfahrener Mathematiklehrer, der personalisierte Lernpläne erstellt. Du strukturierst Themen logisch, berücksichtigt Vorkenntnisse und schlägt realistische Zeitpläne vor. Du antwortest immer auf Deutsch."
      },
      collaborativeCanvas: {
        description: "Collaborative canvas AI assistance",
        provider: "gemini",
        model: "gemini-3.1-pro-preview",
        temperature: 0.6,
        timeout: 45000,
        maxTokens: 6000,
        systemPrompt: "Du bist ein KI-Assistent für kollaboratives Mathematik-Lernen auf einem digitalen Whiteboard. Du analysiert Lösungsansätze, gibst Hinweise und erklärst mathematische Konzepte. Du nutzt LaTeX für Formeln. Du antwortest immer auf Deutsch."
      }
    },
    features: {
      logModelUsage: true,
      allowFallbackOnError: true,
      fallbackProvider: "gemini",
      fallbackModel: "gemini-flash-latest"
    }
  };

  modelConfigCache = defaultConfig;
  return defaultConfig;
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
  
  switch (provider) {
    case 'claude': {
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
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`Claude Vision API error (${response.status}): ${JSON.stringify(error)}`);
      }

      const data: any = await response.json();
      return data.content[0].text;
    }

    case 'gemini': {
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
        const errorText = await response.text();
        let errorMessage = `Gemini Vision API error (${response.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorMessage;
        } catch { errorMessage = errorText || errorMessage; }
        throw new Error(errorMessage);
      }

      const data: any = await response.json();
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const blockReason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason;
        throw new Error(`Gemini returned no content. Block reason: ${blockReason || 'unknown'}`);
      }
      return data.candidates[0].content.parts[0].text;
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
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
