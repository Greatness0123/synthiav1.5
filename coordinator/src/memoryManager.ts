/**
 * Supabase read/write for memories including vector similarity search.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { embeddingEngine } from './embeddingEngine';

export interface MemoryEntry {
  memory_id: string;
  heartbeat: number;
  day_cycle: number;
  light_state: 'day' | 'night';
  tier: 1 | 2 | 3;
  visual_description: string;
  audio_state: string;
  joint_state_summary: string;
  self_questions: any;
  thought: string;
  action_taken: any;
  outcome: string;
  reward_signal: number;
  goal_at_time: string;
  injected: boolean;
  session_id: string;
  frame_buffer?: Buffer;
}

export class MemoryManager {
  private supabase: SupabaseClient | null = null;
  private mockStore: any[] = [];
  private ensuredSessions: Set<string> = new Set();

  // Estimated sizes for session size tracking
  private static readonly MEMORY_TEXT_BYTES = 2048; // ~2KB per memory (thought + metadata)
  private static readonly FRAME_WEBP_BYTES = 51200; // ~50KB per 448x448 WebP frame

  constructor(supabaseUrl: string, supabaseKey: string) {
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      console.log('[MemoryManager] Supabase client created');
    } else {
      console.warn('[MemoryManager] Supabase not configured — using in-memory mock store. Memories will not persist.');
    }
  }

  private async ensureSession(sessionId: string, agentId: string, bodyType: string = 'humanoid'): Promise<void> {
    if (!this.supabase || this.ensuredSessions.has(sessionId)) return;

    try {
      const { error } = await this.supabase
        .from('sessions')
        .upsert(
          { id: sessionId, agent_id: agentId, body_type: bodyType },
          { onConflict: 'id', ignoreDuplicates: true }
        );

      if (error) {
        console.error(`[MemoryManager] Failed to ensure session '${sessionId}':`, error.message, error.code, error.details);
      } else {
        this.ensuredSessions.add(sessionId);
        console.log(`[MemoryManager] Session ensured: ${sessionId}`);
      }
    } catch (err) {
      console.error('[MemoryManager] ensureSession exception:', err);
    }
  }

  async updateSessionStats(sessionId: string, heartbeats: number, bodyType: string = 'humanoid'): Promise<void> {
    if (!this.supabase) return;
    try {
      await this.ensureSession(sessionId, 'agent_a', bodyType);
      await this.supabase
        .from('sessions')
        .update({ total_heartbeats: heartbeats })
        .eq('id', sessionId);
    } catch (err) {
      console.error('[MemoryManager] updateSessionStats exception:', err);
    }
  }

  async endSession(sessionId: string): Promise<void> {
    if (!this.supabase) return;
    try {
      await this.supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', sessionId);
      console.log(`[MemoryManager] Session ended: ${sessionId}`);
    } catch (err) {
      console.error('[MemoryManager] endSession exception:', err);
    }
  }

  async write(entry: MemoryEntry, agentId: string): Promise<boolean> {
    try {
      const embedding = await embeddingEngine.embed(entry.thought);

      if (!this.supabase) {
        this.mockStore.push({ ...entry, agent_id: agentId, embedding: Array.from(embedding) });
        console.log('[MemoryManager] Written to mock store:', entry.memory_id);
        return true;
      }

      // Ensure the session row exists before inserting the memory
      await this.ensureSession(entry.session_id, agentId);

      const { data, error } = await this.supabase
        .from('memories')
        .insert({
          memory_id: entry.memory_id,
          agent_id: agentId,
          session_id: entry.session_id,
          heartbeat: entry.heartbeat,
          day_cycle: entry.day_cycle,
          light_state: entry.light_state,
          tier: entry.tier,
          visual_description: entry.visual_description,
          audio_state: entry.audio_state,
          joint_state_summary: entry.joint_state_summary,
          self_questions: entry.self_questions,
          thought: entry.thought,
          action_taken: entry.action_taken,
          outcome: entry.outcome,
          reward_signal: entry.reward_signal,
          goal_at_time: entry.goal_at_time,
          injected: entry.injected,
          embedding: Array.from(embedding),
        })
        .select()
        .single();

      if (error) {
        console.error('[MemoryManager] Supabase insert error:', error.message, error.code, error.details, error.hint);
        return false;
      }

      console.log(`[MemoryManager] Memory written: ${entry.memory_id} (tier ${entry.tier})`);

      // Increment session memory_count and estimated_size_bytes
      if (entry.session_id) {
        try {
          const { data: session } = await this.supabase
            .from('sessions')
            .select('memory_count, estimated_size_bytes')
            .eq('id', entry.session_id)
            .single();
          if (session) {
            const textBytes = entry.thought ? entry.thought.length * 2 : 0;
            const metaBytes = (entry.visual_description?.length || 0) * 2
              + (entry.joint_state_summary?.length || 0) * 2
              + (entry.action_taken ? JSON.stringify(entry.action_taken).length * 2 : 0);
            const memorySize = Math.max(MemoryManager.MEMORY_TEXT_BYTES, textBytes + metaBytes);
            const frameSize = entry.frame_buffer ? entry.frame_buffer.length : 0;

            await this.supabase
              .from('sessions')
              .update({
                memory_count: (session.memory_count || 0) + 1,
                estimated_size_bytes: (session.estimated_size_bytes || 0) + memorySize + frameSize,
              })
              .eq('id', entry.session_id);
          }
        } catch (e) {
          console.error('[MemoryManager] Failed to update session memory_count:', e);
        }
      }

      if (entry.frame_buffer) {
        this.uploadFrame(data!.id, entry.frame_buffer, agentId, entry.session_id, entry.heartbeat);
      }
      return true;
    } catch (err) {
      console.error('[MemoryManager] write() exception:', err);
      return false;
    }
  }

  private async uploadFrame(memoryId: string, buffer: Buffer, agentId: string, sessionId: string, heartbeat: number) {
    if (!this.supabase) return;
    try {
      // Frame is WebP format (captured as 448×448 WebP from dedicated AI render target)
      const path = `${agentId}/${sessionId}/hb_${heartbeat}.webp`;
      const { error: uploadError } = await this.supabase.storage
        .from('Synthia-frames')
        .upload(path, buffer, { contentType: 'image/webp', upsert: true });

      if (uploadError) {
        console.error('[MemoryManager] Frame upload error:', uploadError.message);
        return;
      }

      const { data: { publicUrl } } = this.supabase.storage
        .from('Synthia-frames')
        .getPublicUrl(path);

      const { error: updateError } = await this.supabase
        .from('memories')
        .update({ frame_url: publicUrl })
        .eq('id', memoryId);

      if (updateError) {
        console.error('[MemoryManager] Frame URL update error:', updateError.message);
      }
    } catch (err) {
      console.error('[MemoryManager] uploadFrame exception:', err);
    }
  }

  async retrieveRelevant(embedding: Float32Array, agentId: string, limit: number = 5): Promise<any[]> {
    if (!this.supabase) {
      return this.mockStore
        .filter(m => m.agent_id === agentId)
        .slice(-limit);
    }

    const { data, error } = await this.supabase.rpc('match_memories', {
      query_embedding: Array.from(embedding),
      match_agent_id: agentId,
      match_count: limit,
    });

    if (error) {
      console.error('[MemoryManager] retrieveRelevant error:', error.message);
      return [];
    }
    return data || [];
  }

  async retrieveRecent(agentId: string, limit: number = 3): Promise<any[]> {
    if (!this.supabase) {
      return this.mockStore
        .filter(m => m.agent_id === agentId)
        .sort((a, b) => b.heartbeat - a.heartbeat)
        .slice(0, limit);
    }

    const { data, error } = await this.supabase
      .from('memories')
      .select('id, memory_id, heartbeat, tier, visual_description, audio_state, thought, action_taken, outcome, reward_signal, goal_at_time, light_state')
      .eq('agent_id', agentId)
      .order('heartbeat', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[MemoryManager] retrieveRecent error:', error.message);
      return [];
    }
    return data || [];
  }

  async pruneOld(): Promise<void> {
    if (!this.supabase) return;
    try {
      const { data: sessions, error: sessionError } = await this.supabase
        .from('sessions')
        .select('id')
        .order('started_at', { ascending: false });

      if (sessionError) throw sessionError;
      if (!sessions || sessions.length === 0) return;

      const sessionIds = sessions.map(s => s.id);

      if (sessionIds.length > 2) {
        const oldSessionsT3 = sessionIds.slice(2);
        await this.supabase
          .from('memories')
          .delete()
          .eq('tier', 3)
          .in('session_id', oldSessionsT3);
      }

      if (sessionIds.length > 20) {
        const oldSessionsT2 = sessionIds.slice(20);
        await this.supabase
          .from('memories')
          .delete()
          .eq('tier', 2)
          .in('session_id', oldSessionsT2);
      }
    } catch (err) {
      console.error('[MemoryManager] pruneOld error:', err);
    }
  }

  async getSessionsWithCounts(agentId: string): Promise<any[]> {
    if (!this.supabase) return [];
    try {
      const { data, error } = await this.supabase
        .from('sessions')
        .select('id, started_at, ended_at, total_heartbeats, body_type, memory_count, estimated_size_bytes')
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false });

      if (error) {
        console.error('[MemoryManager] getSessionsWithCounts error:', error.message);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('[MemoryManager] getSessionsWithCounts exception:', err);
      return [];
    }
  }

  async getMasteredSkills(agentId: string): Promise<any[]> {
    if (!this.supabase) return [];
    try {
      const { data, error } = await this.supabase
        .from('skills')
        .select('name, confidence, description, body_type, learned_at_heartbeat')
        .eq('agent_id', agentId);

      if (error) {
        console.error('[MemoryManager] getMasteredSkills error:', error.message);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('[MemoryManager] getMasteredSkills exception:', err);
      return [];
    }
  }
}
