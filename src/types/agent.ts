/**
 * Types for the agent's internal state, thoughts, memories, and skills.
 */

import { BodyType } from './world';

export interface Thought {
  id: string;
  heartbeat: number;
  text: string;
  isStreaming: boolean;
  isInjected: boolean;
  outcome?: string;
  reward?: number;
  timestamp: number;
}

export interface Memory {
  id: string;
  memoryId: string;
  tier: number;
  heartbeat: number;
  daycycle: string;
  lightState: 'day' | 'night';
  summary: string;
  thought: string;
  actionTaken: string;
  outcome: string;
  rewardSignal: number;
  goalAtTime: string | null;
  isInjected: boolean;
  frameUrl?: string;
  agentId: string;
  sessionId?: string;
}

export interface Skill {
  name: string;
  bodyType: BodyType;
  learnedAtHeartbeat: number;
  attemptsBeforeSuccess: number;
  confidence: number;
}

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'falling' | 'offline';
export type DirectiveMode = 'free_will' | 'training';

export interface RejectedAction {
  joint: string;
  reason: 'unknown_joint' | 'exceeds_anatomical_limit';
  requested: number | number[];
  limit_min?: number;
  limit_max?: number;
}

export interface ActionApplyResult {
  applied: string[];
  rejected: RejectedAction[];
}
