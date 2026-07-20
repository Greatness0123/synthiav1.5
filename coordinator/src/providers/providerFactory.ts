/**
 * Factory function to create the appropriate inference provider based on config.
 */

import { type ProviderConfig, type InferenceProvider, type ProviderType } from './types';
import { KaggleProvider } from './kaggleProvider';
import { OpenAICompatProvider } from './openaiCompatProvider';
import { GeminiProvider } from './geminiProvider';

export function createProvider(config: ProviderConfig): InferenceProvider {
  switch (config.type) {
    case 'kaggle':
      return new KaggleProvider(config);

    case 'gemini':
      if (!config.apiKey) throw new Error('Gemini provider requires an API key');
      return new GeminiProvider(config);

    case 'nim':
    case 'openrouter':
    case 'groq':
    case 'custom':
      return new OpenAICompatProvider(config);

    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

/**
 * Get the default base URL for a known provider type.
 */
export function getDefaultEndpoint(type: ProviderType): string {
  switch (type) {
    case 'kaggle':
      return 'http://localhost:8000/infer';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com';
    case 'nim':
      return 'https://integrate.api.nvidia.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'custom':
      return '';
    default:
      return '';
  }
}

/**
 * Get the default model for each provider type.
 */
export function getDefaultModel(type: ProviderType): string {
  switch (type) {
    case 'kaggle':
      return 'Qwen2.5-VL-3B-Instruct';
    case 'gemini':
      return 'gemini-2.0-flash';
    case 'nim':
      return 'meta/llama-3.1-8b-instruct';
    case 'openrouter':
      return 'meta-llama/llama-3.1-8b-instruct';
    case 'groq':
      return 'llama-3.1-8b-instant';
    case 'custom':
      return '';
    default:
      return '';
  }
}
