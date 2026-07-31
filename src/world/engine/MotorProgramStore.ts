/**
 * Client-Side Motor Program Store with Supabase integration and robust in-memory fallback.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface MotorProgram {
  name: string;
  agent_id: string;
  body_type: string;
  tier: 'primitive' | 'learned';
  session_learned?: string;
  heartbeat_learned?: number;
  program: any;
}

export class MotorProgramStore {
  private supabase: SupabaseClient | null = null;
  private mockStore: Map<string, MotorProgram> = new Map();

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey);
      } catch (err) {
        console.error('[MotorProgramStore] Failed to create Supabase client:', err);
      }
    } else {
      console.warn('[MotorProgramStore] Supabase not configured for MotorProgramStore — using in-memory mock store.');
    }
    this.loadPrimitives();
  }

  private loadPrimitives() {
    // Add default primitive program stand_upright
    this.mockStore.set('stand_upright', {
      name: 'stand_upright',
      agent_id: 'system',
      body_type: 'humanoid',
      tier: 'primitive',
      program: {
        id: 'stand_upright',
        bodyType: 'humanoid',
        tier: 'primitive',
        description: 'Maintain a balanced upright standing posture.',
        totalDurationMs: 1000,
        phases: [
          {
            phaseIndex: 0,
            label: 'stabilize',
            startMs: 0,
            endMs: 1000,
            jointTargets: {
              pelvis: { x: 0, y: 0, z: 0 },
              spine: { x: 0, y: 0, z: 0 },
              left_hip: { x: 0, y: 0, z: 0 },
              right_hip: { x: 0, y: 0, z: 0 }
            },
            breakSignal: {
              condition: 'com_stable',
              timeoutMs: 2000
            }
          }
        ],
        learnedAtHeartbeat: null,
        learnedInSession: null,
        successCount: 0,
        attemptCount: 0
      }
    });
    console.log('[MotorProgramStore] Loaded stand_upright primitive motor program client-side.');
  }

  async save(program: MotorProgram): Promise<void> {
    if (!this.supabase) {
      this.mockStore.set(program.name, program);
      console.log('[MotorProgramStore] Motor program saved to mock store:', program.name);
      return;
    }

    try {
      const { error } = await this.supabase
        .from('motor_programs')
        .upsert(program, { onConflict: 'name, agent_id' });

      if (error) {
        console.error('[MotorProgramStore] Error saving motor program:', error);
      }
    } catch (err) {
      console.error('[MotorProgramStore] save exception:', err);
    }
  }

  async getLibrary(agentId: string): Promise<string[]> {
    if (!this.supabase) {
      return Array.from(this.mockStore.keys());
    }

    try {
      const { data, error } = await this.supabase
        .from('motor_programs')
        .select('name')
        .eq('agent_id', agentId);

      if (error) {
        console.error('[MotorProgramStore] Error getting motor program library:', error);
        return Array.from(this.mockStore.keys());
      }
      return (data || []).map(p => p.name);
    } catch (err) {
      console.error('[MotorProgramStore] getLibrary exception:', err);
      return Array.from(this.mockStore.keys());
    }
  }
}
