/**
 * HTTP client for inference — delegates to provider adapters.
 */

import { InferPayload } from './types/payload';
import { type ProviderConfig, type InferenceProvider, type InferenceResult } from './providers/types';
import { createProvider, getDefaultEndpoint, getDefaultModel } from './providers/providerFactory';

export type { InferenceResult };

export class InferenceClient {
  private provider: InferenceProvider | null = null;
  private config: ProviderConfig = { type: 'kaggle', endpoint: '' };

  setEndpoint(url: string) {
    this.config.endpoint = url;
    this.provider = createProvider(this.config);
  }

  setProvider(type: string, endpoint: string, apiKey?: string, model?: string) {
    this.config = {
      type: type as any,
      endpoint: endpoint || getDefaultEndpoint(type as any),
      apiKey,
      model: model || getDefaultModel(type as any),
    };
    this.provider = createProvider(this.config);
    console.log(`[InferenceClient] Provider set to ${type}, endpoint=${this.config.endpoint}, model=${this.config.model}`);
  }

  hasEndpoint(): boolean {
    return !!this.config.endpoint && this.provider !== null;
  }

  getProviderConfig(): ProviderConfig {
    return { ...this.config };
  }

  async infer(
    payload: InferPayload,
    onToken: (token: string) => void
  ): Promise<InferenceResult> {
    if (!this.provider) {
      throw new Error('Inference provider not configured');
    }
    return this.provider.infer(payload, onToken);
  }
}
