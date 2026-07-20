/**
 * Zustand store for agent-specific state (thoughts, memories, goals).
 */

import { create } from 'zustand';
import type { Thought, Memory, AgentStatus, DirectiveMode } from '../types/agent';

interface AgentState {
  thoughts: Thought[];
  memories: Memory[];
  skills: string[];
  currentRung: number;
  currentGoal: string | null;
  directiveMode: DirectiveMode;
  heartbeat: number;
  lightState: 'day' | 'night';
  status: AgentStatus;
  pendingInjection: string | null;
  currentThought: string;
  rehydrationSummary: string;
  hasRehydrated: boolean;
  masteredSkills: string[];
  injectionQueue: string[];
  injectionQueueCount: number;

  // Actions
  addThought: (thought: Thought) => void;
  addMemory: (memory: Memory) => void;
  setDirectiveMode: (mode: DirectiveMode) => void;
  setCurrentGoal: (goal: string | null) => void;
  setPendingInjection: (text: string | null) => void;
  setStatus: (status: AgentStatus) => void;
  setCurrentThought: (text: string) => void;
  appendThoughtToken: (token: string) => void;
  setRehydrationSummary: (text: string) => void;
  appendRehydrationToken: (token: string) => void;
  setHasRehydrated: (val: boolean) => void;
  addMasteredSkill: (skill: string) => void;
  setInjectionQueue: (queue: string[]) => void;
  setInjectionQueueCount: (count: number) => void;
  incrementInjectionQueueCount: () => void;
  decrementInjectionQueueCount: () => void;
  setRung: (rung: number) => void;
  incrementHeartbeat: () => void;
  setHeartbeat: (hb: number) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  thoughts: [],
  memories: [],
  skills: [],
  currentRung: 0,
  currentGoal: null,
  directiveMode: 'free_will',
  heartbeat: 0,
  lightState: 'day',
  status: 'idle',
  pendingInjection: null,
  currentThought: '',
  rehydrationSummary: '',
  hasRehydrated: false,
  masteredSkills: [],
  injectionQueue: [],
  injectionQueueCount: 0,

  addThought: (thought) => set((state) => ({ thoughts: [...state.thoughts, thought] })),
  addMemory: (memory) => set((state) => ({ memories: [...state.memories, memory] })),
  setDirectiveMode: (directiveMode) => set({ directiveMode }),
  setCurrentGoal: (currentGoal) => set({ currentGoal }),
  setPendingInjection: (pendingInjection) => set({ pendingInjection }),
  setStatus: (status) => set({ status }),
  setCurrentThought: (currentThought) => set({ currentThought }),
  appendThoughtToken: (token) => set((state) => ({ currentThought: state.currentThought + token })),
  setRehydrationSummary: (rehydrationSummary) => set({ rehydrationSummary }),
  appendRehydrationToken: (token) => set((state) => ({ rehydrationSummary: state.rehydrationSummary + token })),
  setHasRehydrated: (hasRehydrated) => set({ hasRehydrated }),
  addMasteredSkill: (skill) => set((state) => ({ masteredSkills: [...state.masteredSkills, skill] })),
  setInjectionQueue: (injectionQueue) => set({ injectionQueue }),
  setInjectionQueueCount: (injectionQueueCount) => set({ injectionQueueCount }),
  incrementInjectionQueueCount: () => set((state) => ({ injectionQueueCount: state.injectionQueueCount + 1 })),
  decrementInjectionQueueCount: () => set({ injectionQueueCount: Math.max(0, get().injectionQueueCount - 1) }),
  setRung: (currentRung) => set({ currentRung }),
  incrementHeartbeat: () => set((state) => ({ heartbeat: state.heartbeat + 1 })),
  setHeartbeat: (heartbeat) => set({ heartbeat }),
}));
