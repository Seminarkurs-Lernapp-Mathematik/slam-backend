/**
 * Get Models Endpoint
 *
 * Fetches available models live from the currently selected AI provider.
 * Falls back to a curated hardcoded list if the API call fails or no key
 * is provided (e.g. first load before the user enters a key).
 *
 * GET /api/get-models?provider=gemini&apiKey=xxx
 */

import { Context } from 'hono';

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  tier: 'fast' | 'standard' | 'smart';
  contextWindow: number;
}

interface GetModelsResponse {
  provider: 'claude' | 'gemini' | 'openrouter' | 'openai' | 'mistral';
  models: ModelInfo[];
  source: 'live' | 'fallback';
}

// ============================================================================
// TIER CLASSIFICATION
// ============================================================================

function classifyGeminiTier(modelId: string): 'fast' | 'standard' | 'smart' {
  const id = modelId.toLowerCase();
  if (id.includes('flash-lite') || id.includes('lite') || id.includes('-1b-') || id.includes('-4b-')) return 'fast';
  if (id.includes('pro') || id.includes('opus') || id.includes('-27b-') || id.includes('-12b-')) return 'smart';
  return 'standard'; // flash and others
}

function classifyClaudeTier(modelId: string): 'fast' | 'standard' | 'smart' {
  const id = modelId.toLowerCase();
  if (id.includes('haiku')) return 'fast';
  if (id.includes('opus')) return 'smart';
  return 'standard'; // sonnet
}

function classifyOpenRouterTier(contextLength: number): 'fast' | 'standard' | 'smart' {
  if (contextLength <= 32768) return 'fast';
  if (contextLength >= 200000) return 'smart';
  return 'standard';
}

// ============================================================================
// LIVE FETCH FUNCTIONS
// ============================================================================

/** Fetch live Gemini models from Google's API */
async function fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gemini models API error: ${response.status}`);

  const data: any = await response.json();
  const models: ModelInfo[] = [];

  const EXCLUDE_PATTERNS = ['tts', 'image', 'robotics', 'computer', 'deep-research', 'nano-banana'];

  for (const m of data.models || []) {
    // Must support generateContent for chat generation
    if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
    // Must have enough context window for meaningful use
    if ((m.inputTokenLimit || 0) < 32768) continue;

    const rawId: string = m.name || '';
    const modelId = rawId.replace('models/', ''); // strip "models/" prefix

    // Exclude non-general-purpose models
    if (EXCLUDE_PATTERNS.some(p => modelId.toLowerCase().includes(p))) continue;
    if (EXCLUDE_PATTERNS.some(p => (m.displayName || '').toLowerCase().includes(p))) continue;

    models.push({
      id: modelId,
      name: m.displayName || modelId,
      description: m.description || 'Google AI model',
      tier: classifyGeminiTier(modelId),
      contextWindow: m.inputTokenLimit || 100000,
    });
  }

  // Sort: fast → standard → smart, then alphabetically
  const tierOrder = { fast: 0, standard: 1, smart: 2 };
  models.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || a.name.localeCompare(b.name));
  return models;
}

/** Fetch live Claude models from Anthropic's API */
async function fetchClaudeModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!response.ok) throw new Error(`Claude models API error: ${response.status}`);

  const data: any = await response.json();
  const models: ModelInfo[] = [];

  for (const m of data.data || []) {
    const modelId: string = m.id || '';
    models.push({
      id: modelId,
      name: m.display_name || modelId,
      description: `Anthropic ${m.display_name || modelId}`,
      tier: classifyClaudeTier(modelId),
      contextWindow: 200000, // All current Claude models have 200k context
    });
  }

  // Sort newest first (Anthropic returns newest first already, but be explicit)
  const tierOrder = { fast: 0, standard: 1, smart: 2 };
  models.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.id.localeCompare(a.id));
  return models;
}

/** Fetch live OpenRouter models */
async function fetchOpenRouterModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenRouter models API error: ${response.status}`);

  const data: any = await response.json();
  const all: any[] = data.data || [];

  // Split into free and paid, prefer free
  const free = all.filter((m: any) => m.id?.includes(':free'));
  const paid = all.filter((m: any) => !m.id?.includes(':free'));

  const toModelInfo = (m: any): ModelInfo => ({
    id: m.id || '',
    name: m.name || m.id || '',
    description: m.description
      ? m.description.substring(0, 80)
      : (m.id?.includes(':free') ? 'Free tier via OpenRouter' : 'Via OpenRouter'),
    tier: classifyOpenRouterTier(m.context_length || 0),
    contextWindow: m.context_length || 128000,
  });

  // Return free models + top paid models (by context length as proxy for capability)
  paid.sort((a: any, b: any) => (b.context_length || 0) - (a.context_length || 0));
  const models = [...free, ...paid.slice(0, 30)].map(toModelInfo);

  // Sort free first, then by tier
  const tierOrder = { fast: 0, standard: 1, smart: 2 };
  models.sort((a, b) => {
    const aFree = a.id.includes(':free') ? 0 : 1;
    const bFree = b.id.includes(':free') ? 0 : 1;
    if (aFree !== bFree) return aFree - bFree;
    return tierOrder[a.tier] - tierOrder[b.tier];
  });

  return models;
}

/** Fetch live OpenAI models from OpenAI's API */
async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenAI models API error: ${response.status}`);

  const data: any = await response.json();
  const models: ModelInfo[] = [];

  // Only include chat-capable GPT models
  const INCLUDE_PREFIXES = ['gpt-4', 'gpt-4o', 'o1', 'o3', 'o4'];
  const EXCLUDE_PATTERNS = ['vision', 'audio', 'realtime', 'instruct', 'autocomplete', '0301', '0613'];

  for (const m of data.data || []) {
    const modelId: string = m.id || '';
    if (!INCLUDE_PREFIXES.some(p => modelId.startsWith(p))) continue;
    if (EXCLUDE_PATTERNS.some(p => modelId.toLowerCase().includes(p))) continue;

    let tier: 'fast' | 'standard' | 'smart' = 'standard';
    if (modelId.includes('mini') || modelId.includes('nano')) tier = 'fast';
    if (modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) tier = 'smart';

    models.push({
      id: modelId,
      name: modelId,
      description: `OpenAI ${modelId}`,
      tier,
      contextWindow: 128000,
    });
  }

  const tierOrder = { fast: 0, standard: 1, smart: 2 };
  models.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || a.id.localeCompare(b.id));
  return models;
}

/** Fetch live Mistral models from Mistral's API */
async function fetchMistralModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch('https://api.mistral.ai/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Mistral models API error: ${response.status}`);

  const data: any = await response.json();
  const models: ModelInfo[] = [];

  for (const m of data.data || []) {
    const modelId: string = m.id || '';

    let tier: 'fast' | 'standard' | 'smart' = 'standard';
    if (modelId.includes('ministral') || modelId.includes('nemo') || modelId.includes('tiny')) tier = 'fast';
    if (modelId.includes('large') || modelId.includes('magistral')) tier = 'smart';

    models.push({
      id: modelId,
      name: m.name || modelId,
      description: `Mistral ${m.name || modelId}`,
      tier,
      contextWindow: 128000,
    });
  }

  const tierOrder = { fast: 0, standard: 1, smart: 2 };
  models.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || a.id.localeCompare(b.id));
  return models;
}

// ============================================================================
// FALLBACK LISTS (used when no API key or live fetch fails)
// ============================================================================

const FALLBACK_GEMINI: ModelInfo[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast and capable, latest generation', tier: 'standard', contextWindow: 1048576 },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', description: 'Ultra-fast and efficient', tier: 'fast', contextWindow: 1048576 },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable Gemini model', tier: 'smart', contextWindow: 1048576 },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast and efficient', tier: 'standard', contextWindow: 1048576 },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite', description: 'Fastest Gemini 2.0 model', tier: 'fast', contextWindow: 1048576 },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview', description: 'Latest preview model', tier: 'fast', contextWindow: 1048576 },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', description: 'Latest pro preview', tier: 'smart', contextWindow: 1048576 },
];

const FALLBACK_CLAUDE: ModelInfo[] = [
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: 'Fastest and most compact Claude', tier: 'fast', contextWindow: 200000 },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Balanced performance and intelligence', tier: 'standard', contextWindow: 200000 },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Latest Sonnet — high intelligence', tier: 'standard', contextWindow: 200000 },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', description: 'Most capable Claude model', tier: 'smart', contextWindow: 200000 },
];

const FALLBACK_OPENROUTER: ModelInfo[] = [
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', description: 'Free tier via OpenRouter', tier: 'standard', contextWindow: 1000000 },
  { id: 'google/gemini-2.0-flash-thinking-exp:free', name: 'Gemini 2.0 Flash Thinking (Free)', description: 'Free tier — enhanced reasoning', tier: 'smart', contextWindow: 1000000 },
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', description: 'Free tier — advanced reasoning', tier: 'smart', contextWindow: 128000 },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)', description: 'Free tier — Meta LLM', tier: 'standard', contextWindow: 128000 },
];

const FALLBACK_OPENAI: ModelInfo[] = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable', tier: 'fast', contextWindow: 128000 },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Balanced performance', tier: 'standard', contextWindow: 128000 },
  { id: 'o4-mini', name: 'o4-mini', description: 'OpenAI reasoning model', tier: 'smart', contextWindow: 200000 },
];

const FALLBACK_MISTRAL: ModelInfo[] = [
  { id: 'ministral-3b-latest', name: 'Ministral 3B', description: 'Ultra-fast small model', tier: 'fast', contextWindow: 128000 },
  { id: 'ministral-8b-latest', name: 'Ministral 8B', description: 'Fast and efficient', tier: 'fast', contextWindow: 128000 },
  { id: 'mistral-small-latest', name: 'Mistral Small', description: 'Balanced performance', tier: 'standard', contextWindow: 128000 },
  { id: 'mistral-medium-latest', name: 'Mistral Medium', description: 'High quality', tier: 'standard', contextWindow: 128000 },
  { id: 'mistral-large-latest', name: 'Mistral Large', description: 'Most capable Mistral model', tier: 'smart', contextWindow: 128000 },
];

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleGetModels(c: Context): Promise<Response> {
  try {
    const query = c.req.query();
    const provider = query['provider'] as 'claude' | 'gemini' | 'openrouter' | 'openai' | 'mistral';
    const apiKey = query['apiKey'];

    const VALID_PROVIDERS = ['claude', 'gemini', 'openrouter', 'openai', 'mistral'];
    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return c.json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` }, 400);
    }

    let models: ModelInfo[] = [];
    let source: 'live' | 'fallback' = 'fallback';

    // If an API key is provided, attempt a live fetch
    if (apiKey && apiKey.length > 10) {
      try {
        switch (provider) {
          case 'gemini':
            models = await fetchGeminiModels(apiKey);
            break;
          case 'claude':
            models = await fetchClaudeModels(apiKey);
            break;
          case 'openrouter':
            models = await fetchOpenRouterModels(apiKey);
            break;
          case 'openai':
            models = await fetchOpenAIModels(apiKey);
            break;
          case 'mistral':
            models = await fetchMistralModels(apiKey);
            break;
          default:
            models = FALLBACK_GEMINI;
            break;
        }
        source = 'live';
        console.log(`[get-models] Live fetch OK: ${models!.length} ${provider} models`);
      } catch (liveError) {
        console.warn(`[get-models] Live fetch failed for ${provider}, using fallback:`, liveError);
      }
    }

    // Fallback if live fetch wasn't attempted or failed
    if (source === 'fallback' || !models) {
      switch (provider) {
        case 'gemini': models = FALLBACK_GEMINI; break;
        case 'claude': models = FALLBACK_CLAUDE; break;
        case 'openrouter': models = FALLBACK_OPENROUTER; break;
        case 'openai': models = FALLBACK_OPENAI; break;
        case 'mistral': models = FALLBACK_MISTRAL; break;
        default: models = FALLBACK_GEMINI; break;
      }
    }

    const response: GetModelsResponse = { provider, models, source };
    return c.json(response, 200);

  } catch (error) {
    console.error('[get-models] Error:', error);
    return c.json({ error: 'Failed to fetch models', message: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
}
