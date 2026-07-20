/**
 * Supabase read/write for motor programs.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

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

  constructor(supabaseUrl: string, supabaseKey: string) {
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    } else {
      console.warn('Supabase not configured for MotorProgramStore — using in-memory mock store.');
      this.loadPrimitives();
    }
  }

  private loadPrimitives() {
    try {
      const primitivesDir = path.join(process.cwd(), 'programs/primitives');
      if (fs.existsSync(primitivesDir)) {
        const files = fs.readdirSync(primitivesDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const content = fs.readFileSync(path.join(primitivesDir, file), 'utf-8');
            const program = JSON.parse(content);
            const name = file.replace('.json', '');
            this.mockStore.set(name, {
              name,
              agent_id: 'system',
              body_type: 'humanoid',
              tier: 'primitive',
              program
            });
            console.log(`Loaded primitive motor program: ${name}`);
          }
        }
      }
    } catch (err) {
      console.error('Error loading primitive motor programs:', err);
    }
  }

  async save(program: MotorProgram): Promise<void> {
    if (!this.supabase) {
      this.mockStore.set(program.name, program);
      console.log('Motor program saved to mock store:', program.name);
      return;
    }

    const { error } = await this.supabase
      .from('motor_programs')
      .upsert(program, { onConflict: 'name, agent_id' });

    if (error) {
      console.error('Error saving motor program:', error);
    }
  }

  async getLibrary(agentId: string): Promise<string[]> {
    if (!this.supabase) {
      return Array.from(this.mockStore.keys());
    }

    const { data, error } = await this.supabase
      .from('motor_programs')
      .select('name')
      .eq('agent_id', agentId);

    if (error) {
      console.error('Error getting motor program library:', error);
      return [];
    }
    return data.map(p => p.name);
  }
}
