/**
 * Shared AI Provider Helper
 * Supports Claude, Gemini, and OpenRouter
 */

const AI_ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
} as const;

export type AIProviderType = 'claude' | 'gemini' | 'openrouter';

export interface CallAIOptions {
  provider: AIProviderType;
  apiKey: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export async function callAI({
  provider,
  apiKey,
  model,
  prompt,
  temperature = 0.7,
  maxTokens = 8000,
  systemPrompt,
}: CallAIOptions): Promise<string> {
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

    case 'openrouter': {
      const messages: any[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(AI_ENDPOINTS.openrouter, {
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
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`OpenRouter API error (${response.status}): ${JSON.stringify(error)}`);
      }

      const data: any = await response.json();
      if (!data.choices?.[0]?.message?.content) {
        throw new Error(`OpenRouter returned no content: ${JSON.stringify(data)}`);
      }
      return data.choices[0].message.content;
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export const OPENROUTER_MODELS = {
  fast: 'google/gemini-2.0-flash-exp:free',
  standard: 'google/gemini-2.0-flash-thinking-exp:free',
  smart: 'deepseek/deepseek-r1:free',
} as const;
