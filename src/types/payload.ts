// Kept in sync with frontend/src/types — update both if schema changes

/**
 * Types for inference payloads and responses.
 */

export interface InferPayload {
  frame: string;
  audio_pcm: string;
  joints: Record<string, any>;
  valid_joints: string[];
  upright_preset: Record<string, any>;
  heartbeat: number;
  light_state: string;
  session_id: string;
  body_type: string;
  current_goal: string | null;
  current_rung: number;
  objects_in_world: any[];
  relevant_memories: any[];
  recent_working_memories: any[];
  known_skills: string[];
  pending_injection: string | null;
  motor_program_library: string[];
  directive_mode: string;
  agent_id: string;
}

export interface InferResponse {
  memory_write: {
    memory_id: 'auto' | string
    tier: 1 | 2 | 3
    summary: string
    skill_mastered: string | null
    name_this_memory: string | null
  }
  actions: {
    program_sequence: string[]
    joint_overrides: Record<string, number>
  }
  new_motor_program: any | null
  flag: 'requesting_object_hint' | null
}
