/**
 * Zustand store for simulation connection and database configuration.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ProviderType = 'kaggle' | 'gemini' | 'nim' | 'openrouter' | 'groq' | 'custom';

interface ConnectionState {
  endpoint: string;
  supabaseUrl: string;
  supabaseKey: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  inferenceEndpoint: string;
  provider: ProviderType;
  providerModel: string;
  providerApiKey: string;
  rtt: number;
  inferenceTime: number;
  frameSize: number;
  fps: number;
  cycleMs: number;

  // Actions
  setEndpoint: (url: string) => void;
  setInferenceEndpoint: (url: string) => void;
  setProvider: (provider: ProviderType) => void;
  setProviderModel: (model: string) => void;
  setProviderApiKey: (key: string) => void;
  setCycleMs: (ms: number) => void;
  setSupabaseConfig: (url: string, key: string) => void;
  setStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;
  setMetrics: (metrics: Partial<Pick<ConnectionState, 'rtt' | 'inferenceTime' | 'frameSize' | 'fps'>>) => void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      endpoint: 'ws://localhost:3001/ws',
      inferenceEndpoint: 'http://localhost:8000/infer',
      provider: 'kaggle',
      providerModel: 'Qwen2.5-VL-3B-Instruct',
      providerApiKey: '',
      supabaseUrl: '',
      supabaseKey: '',
      status: 'disconnected',
      rtt: 0,
      inferenceTime: 0,
      frameSize: 0,
      fps: 0,
      cycleMs: 2000,

      setEndpoint: (endpoint) => set({ endpoint }),
      setInferenceEndpoint: (inferenceEndpoint) => set({ inferenceEndpoint }),
      setProvider: (provider) => set({ provider }),
      setProviderModel: (providerModel) => set({ providerModel }),
      setProviderApiKey: (providerApiKey) => set({ providerApiKey }),
      setCycleMs: (cycleMs) => set({ cycleMs }),
      setSupabaseConfig: (supabaseUrl, supabaseKey) => set({ supabaseUrl, supabaseKey }),
      setStatus: (status) => set({ status }),
      setMetrics: (metrics) => set((state) => ({ ...state, ...metrics })),
    }),
    {
      name: 'synthia_connection_config',
      partialize: (state) => ({
        endpoint: state.endpoint,
        inferenceEndpoint: state.inferenceEndpoint,
        provider: state.provider,
        providerModel: state.providerModel,
        supabaseUrl: state.supabaseUrl,
        supabaseKey: state.supabaseKey,
        cycleMs: state.cycleMs,
      }),
    }
  )
);
