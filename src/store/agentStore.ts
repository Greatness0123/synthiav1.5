/**
 * Zustand store for agent-specific state (thoughts, memories, goals) supporting multi-agent architecture.
 */

import { create } from 'zustand';
import type { Thought, Memory, AgentStatus, DirectiveMode } from '../types/agent';

export interface SingleAgentState {
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
}

export const createDefaultAgentState = (): SingleAgentState => ({
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
});

interface AgentStoreState extends SingleAgentState {
  agents: Record<string, SingleAgentState>;
  activeAgentId: string;

  // Multi-agent Actions
  setActiveAgentId: (id: string) => void;
  addAgent: (id: string, initialState?: Partial<SingleAgentState>) => void;
  removeAgent: (id: string) => void;
  updateAgentState: (id: string, partial: Partial<SingleAgentState>) => void;

  // Agent-specific Actions (backwards-compatible, defaults to activeAgentId if targetAgentId is omitted)
  addThought: (thought: Thought, targetAgentId?: string) => void;
  addMemory: (memory: Memory, targetAgentId?: string) => void;
  setDirectiveMode: (mode: DirectiveMode, targetAgentId?: string) => void;
  setCurrentGoal: (goal: string | null, targetAgentId?: string) => void;
  setPendingInjection: (text: string | null, targetAgentId?: string) => void;
  setStatus: (status: AgentStatus, targetAgentId?: string) => void;
  setCurrentThought: (text: string, targetAgentId?: string) => void;
  appendThoughtToken: (token: string, targetAgentId?: string) => void;
  setRehydrationSummary: (text: string, targetAgentId?: string) => void;
  appendRehydrationToken: (token: string, targetAgentId?: string) => void;
  setHasRehydrated: (val: boolean, targetAgentId?: string) => void;
  addMasteredSkill: (skill: string, targetAgentId?: string) => void;
  setInjectionQueue: (queue: string[], targetAgentId?: string) => void;
  setInjectionQueueCount: (count: number, targetAgentId?: string) => void;
  incrementInjectionQueueCount: (targetAgentId?: string) => void;
  decrementInjectionQueueCount: (targetAgentId?: string) => void;
  setRung: (rung: number, targetAgentId?: string) => void;
  incrementHeartbeat: (targetAgentId?: string) => void;
  setHeartbeat: (hb: number, targetAgentId?: string) => void;
}

const initialDefault = createDefaultAgentState();

export const useAgentStore = create<AgentStoreState>((set, get) => {
  // Syncs the top-level keys with a specific agent's state from the record
  const syncActiveAgentToTopLevel = (agents: Record<string, SingleAgentState>, activeId: string) => {
    const activeState = agents[activeId] || createDefaultAgentState();
    return {
      thoughts: activeState.thoughts,
      memories: activeState.memories,
      skills: activeState.skills,
      currentRung: activeState.currentRung,
      currentGoal: activeState.currentGoal,
      directiveMode: activeState.directiveMode,
      heartbeat: activeState.heartbeat,
      lightState: activeState.lightState,
      status: activeState.status,
      pendingInjection: activeState.pendingInjection,
      currentThought: activeState.currentThought,
      rehydrationSummary: activeState.rehydrationSummary,
      hasRehydrated: activeState.hasRehydrated,
      masteredSkills: activeState.masteredSkills,
      injectionQueue: activeState.injectionQueue,
      injectionQueueCount: activeState.injectionQueueCount,
    };
  };

  const getTargetId = (targetId?: string) => {
    return targetId || get().activeAgentId;
  };

  const updateAgentStateInternal = (agentId: string, partial: Partial<SingleAgentState>) => {
    const currentAgents = get().agents;
    const existing = currentAgents[agentId] || createDefaultAgentState();
    const updatedAgent = { ...existing, ...partial };
    const updatedAgents = { ...currentAgents, [agentId]: updatedAgent };

    if (agentId === get().activeAgentId) {
      set({
        agents: updatedAgents,
        ...partial,
      });
    } else {
      set({
        agents: updatedAgents,
      });
    }
  };

  const defaultAgents: Record<string, SingleAgentState> = {
    'agent_0': createDefaultAgentState(),
  };

  return {
    ...initialDefault,
    agents: defaultAgents,
    activeAgentId: 'agent_0',

    setActiveAgentId: (id) => set((state) => {
      const activeState = state.agents[id] || createDefaultAgentState();
      return {
        activeAgentId: id,
        ...activeState,
      };
    }),

    addAgent: (id, initialState) => set((state) => {
      const newAgent = { ...createDefaultAgentState(), ...initialState };
      const updatedAgents = { ...state.agents, [id]: newAgent };
      return {
        agents: updatedAgents,
      };
    }),

    removeAgent: (id) => set((state) => {
      const updatedAgents = { ...state.agents };
      delete updatedAgents[id];
      const remainingIds = Object.keys(updatedAgents);
      const nextActiveId = remainingIds.includes(state.activeAgentId)
        ? state.activeAgentId
        : (remainingIds[0] || 'agent_0');

      if (!updatedAgents[nextActiveId]) {
        updatedAgents[nextActiveId] = createDefaultAgentState();
      }

      const activeState = syncActiveAgentToTopLevel(updatedAgents, nextActiveId);

      return {
        agents: updatedAgents,
        activeAgentId: nextActiveId,
        ...activeState,
      };
    }),

    updateAgentState: (id, partial) => {
      updateAgentStateInternal(id, partial);
    },

    // Agent-specific actions (delegates to target ID or activeId, syncing top-level if needed)
    addThought: (thought, targetId) => {
      const id = getTargetId(targetId);
      const current = get().agents[id]?.thoughts || [];
      updateAgentStateInternal(id, { thoughts: [...current, thought] });
    },

    addMemory: (memory, targetId) => {
      const id = getTargetId(targetId);
      const current = get().agents[id]?.memories || [];
      updateAgentStateInternal(id, { memories: [...current, memory] });
    },

    setDirectiveMode: (directiveMode, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { directiveMode });
    },

    setCurrentGoal: (currentGoal, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { currentGoal });
    },

    setPendingInjection: (pendingInjection, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { pendingInjection });
    },

    setStatus: (status, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { status });
    },

    setCurrentThought: (currentThought, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { currentThought });
    },

    appendThoughtToken: (token, targetId) => {
      const id = getTargetId(targetId);
      const current = get().agents[id]?.currentThought || '';
      updateAgentStateInternal(id, { currentThought: current + token });
    },

    setRehydrationSummary: (rehydrationSummary, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { rehydrationSummary });
    },

    appendRehydrationToken: (token, targetId) => {
      const id = getTargetId(targetId);
      const current = get().agents[id]?.rehydrationSummary || '';
      updateAgentStateInternal(id, { rehydrationSummary: current + token });
    },

    setHasRehydrated: (hasRehydrated, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { hasRehydrated });
    },

    addMasteredSkill: (skill, targetId) => {
      const id = getTargetId(targetId);
      const current = get().agents[id]?.masteredSkills || [];
      updateAgentStateInternal(id, { masteredSkills: [...current, skill] });
    },

    setInjectionQueue: (queue, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { injectionQueue: queue });
    },

    setInjectionQueueCount: (count, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { injectionQueueCount: count });
    },

    incrementInjectionQueueCount: (targetId) => {
      const id = getTargetId(targetId);
      const current = get().agents[id]?.injectionQueueCount || 0;
      updateAgentStateInternal(id, { injectionQueueCount: current + 1 });
    },

    decrementInjectionQueueCount: (targetId) => {
      const id = getTargetId(targetId);
      const current = get().agents[id]?.injectionQueueCount || 0;
      updateAgentStateInternal(id, { injectionQueueCount: Math.max(0, current - 1) });
    },

    setRung: (currentRung, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { currentRung });
    },

    incrementHeartbeat: (targetId) => {
      const id = getTargetId(targetId);
      const current = get().agents[id]?.heartbeat || 0;
      updateAgentStateInternal(id, { heartbeat: current + 1 });
    },

    setHeartbeat: (heartbeat, targetId) => {
      const id = getTargetId(targetId);
      updateAgentStateInternal(id, { heartbeat });
    },
  };
});
