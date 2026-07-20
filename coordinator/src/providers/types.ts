/**
 * Common interface for all inference providers.
 * Each adapter normalizes its API to stream thought tokens then action JSON.
 */

import { InferPayload } from '../types/payload';

export type ProviderType = 'kaggle' | 'gemini' | 'nim' | 'openrouter' | 'groq' | 'custom';

export interface ProviderConfig {
  type: ProviderType;
  endpoint: string;       // Base URL or full infer URL
  apiKey?: string;        // Not needed for Kaggle
  model?: string;         // Model identifier (Gemini, OpenRouter, etc.)
  headers?: Record<string, string>; // Custom headers for 'custom' type
}

export interface InferenceResult {
  thoughtTokens: string;
  actionJson: string;
  rtt: number;
  inferenceTime: number;
}

export interface InferenceProvider {
  infer(payload: InferPayload, onToken: (token: string) => void): Promise<InferenceResult>;
}
