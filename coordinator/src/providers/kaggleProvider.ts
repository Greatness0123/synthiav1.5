/**
 * Kaggle provider adapter.
 * Wraps the existing raw-POST-to-/infer behavior.
 * The Python server handles prompt building and vision processing.
 */

import fetch from 'node-fetch';
import { AbortController } from 'node-abort-controller';
import { InferPayload } from '../types/payload';
import { type InferenceProvider, type InferenceResult, type ProviderConfig } from './types';

export class KaggleProvider implements InferenceProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async infer(payload: InferPayload, onToken: (token: string) => void): Promise<InferenceResult> {
    const startTime = Date.now();
    let firstTokenTime = 0;

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | null = null;

    const setInactivityTimeout = (ms: number) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), ms);
    };

    setInactivityTimeout(120000);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal as any,
      });

      if (!response.ok) {
        let body = '';
        try { body = await response.text(); } catch (_) {}
        throw new Error(`Kaggle HTTP ${response.status}: ${body}`);
      }

      const reader = response.body!;
      let buffer = '';
      let thoughtTokens = '';
      let actionJson = '';
      let isAction = false;
      const separator = '---ACTION---';

      for await (const chunk of (reader as any)) {
        if (firstTokenTime === 0) firstTokenTime = Date.now();
        setInactivityTimeout(20000);

        const text = chunk.toString();

        if (!isAction) {
          buffer += text;
          const index = buffer.indexOf(separator);
          if (index !== -1) {
            const thoughtPart = buffer.substring(0, index);
            const newThought = thoughtPart.substring(thoughtTokens.length);
            if (newThought) onToken(newThought);
            thoughtTokens = thoughtPart;
            isAction = true;
            actionJson = buffer.substring(index + separator.length);
          } else {
            const safeLength = buffer.length - separator.length + 1;
            if (safeLength > thoughtTokens.length) {
              const newThought = buffer.substring(thoughtTokens.length, safeLength);
              onToken(newThought);
              thoughtTokens = buffer.substring(0, safeLength);
            }
          }
        } else {
          actionJson += text;
        }
      }

      if (!isAction) {
        const jsonStart = buffer.indexOf('{');
        if (jsonStart !== -1) {
          thoughtTokens = buffer.substring(0, jsonStart);
          actionJson = buffer.substring(jsonStart);
        } else {
          thoughtTokens = buffer;
        }
      }

      const endTime = Date.now();
      return {
        thoughtTokens,
        actionJson,
        rtt: firstTokenTime - startTime,
        inferenceTime: endTime - firstTokenTime,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
