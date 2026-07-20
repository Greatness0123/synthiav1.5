/**
 * Singleton for @xenova/transformers to run all-MiniLM-L6-v2 locally.
 */

export class EmbeddingEngine {
  private static instance: EmbeddingEngine;
  private pipe: any = null;

  private constructor() {}

  public static getInstance(): EmbeddingEngine {
    if (!EmbeddingEngine.instance) {
      EmbeddingEngine.instance = new EmbeddingEngine();
    }
    return EmbeddingEngine.instance;
  }

  public async init(): Promise<void> {
    if (this.pipe) return;

    const { pipeline } = await import('@xenova/transformers');
    this.pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      cache_dir: './models',
    });
  }

  public async embed(text: string): Promise<Float32Array> {
    if (!this.pipe) {
      await this.init();
    }

    const output = await this.pipe!(text, {
      pooling: 'mean',
      normalize: true,
    });

    return output.data as Float32Array;
  }
}

export const embeddingEngine = EmbeddingEngine.getInstance();
