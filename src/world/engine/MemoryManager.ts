/**
 * Client-Side Memory Manager with direct Supabase integration and robust in-memory fallback.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
  frame_base64?: string; // Client-side passes base64 instead of raw node Buffer
}

export class MemoryManager {
  private supabase: SupabaseClient | null = null;
  private mockStore: any[] = [];
  private ensuredSessions: Set<string> = new Set();

  private static readonly MEMORY_TEXT_BYTES = 2048;
  private static readonly FRAME_WEBP_BYTES = 51200;

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        console.log('[MemoryManager] Supabase client created client-side');
      } catch (err) {
        console.error('[MemoryManager] Failed to create Supabase client:', err);
      }
    } else {
      console.warn('[MemoryManager] Supabase not configured — using in-memory mock store. Memories will not persist.');
    }
  }

  /**
   * Generates a fast, deterministic 384-dimensional embedding from a text string.
   * Completely local, instant, and zero-dependency, avoiding heavy ONNX/Transformer downloads in browser.
   */
  public getDeterministicEmbedding(text: string): Float32Array {
    const vector = new Float32Array(384);
    const clean = (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.length === 0) {
      vector[0] = 1.0;
      return vector;
    }

    for (let i = 0; i < clean.length; i++) {
      const charCode = clean.charCodeAt(i);
      // Pseudo-random index generation
      const index = (charCode * (i + 1) + 17) % 384;
      vector[index] += 1;
    }

    // L2 Normalize
    let sumSq = 0;
    for (let i = 0; i < 384; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < 384; i++) {
        vector[i] /= norm;
      }
    } else {
      vector[0] = 1.0;
    }
    return vector;
  }

  private async ensureSession(sessionId: string, agentId: string, bodyType: string = 'humanoid'): Promise<void> {
    if (!this.supabase || this.ensuredSessions.has(sessionId)) return;

    try {
      const { error } = await this.supabase
        .from('sessions')
        .upsert(
          { id: sessionId, agent_id: agentId, body_type: bodyType },
          { onConflict: 'id' }
        );

      if (error) {
        console.error(`[MemoryManager] Failed to ensure session '${sessionId}':`, error.message);
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
      const embedding = this.getDeterministicEmbedding(entry.thought);

      if (!this.supabase) {
        this.mockStore.push({
          ...entry,
          agent_id: agentId,
          embedding: Array.from(embedding),
          frame_url: entry.frame_base64 ? `data:image/webp;base64,${entry.frame_base64}` : undefined,
        });
        console.log('[MemoryManager] Written to mock store:', entry.memory_id);
        return true;
      }

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
        console.error('[MemoryManager] Supabase insert error:', error.message);
        return false;
      }

      console.log(`[MemoryManager] Memory written to Supabase: ${entry.memory_id} (tier ${entry.tier})`);

      // Update sessions metadata sizes
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
            const frameSize = entry.frame_base64 ? (entry.frame_base64.length * 0.75) : 0;

            await this.supabase
              .from('sessions')
              .update({
                memory_count: (session.memory_count || 0) + 1,
                estimated_size_bytes: (session.estimated_size_bytes || 0) + memorySize + frameSize,
              })
              .eq('id', entry.session_id);
          }
        } catch (e) {
          console.error('[MemoryManager] Failed to update session metadata:', e);
        }
      }

      if (entry.frame_base64) {
        await this.uploadFrame(data!.id, entry.frame_base64, agentId, entry.session_id, entry.heartbeat);
      }
      return true;
    } catch (err) {
      console.error('[MemoryManager] write() exception:', err);
      return false;
    }
  }

  private async uploadFrame(memoryRowId: string, base64: string, agentId: string, sessionId: string, heartbeat: number) {
    if (!this.supabase) return;
    try {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/webp' });

      const path = `${agentId}/${sessionId}/hb_${heartbeat}.webp`;
      const { error: uploadError } = await this.supabase.storage
        .from('Synthia-frames')
        .upload(path, blob, { contentType: 'image/webp', upsert: true });

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
        .eq('id', memoryRowId);

      if (updateError) {
        console.error('[MemoryManager] Frame URL update error:', updateError.message);
      }
    } catch (err) {
      console.error('[MemoryManager] uploadFrame exception:', err);
    }
  }

  async retrieveRelevant(embedding: Float32Array, agentId: string, limit: number = 5): Promise<any[]> {
    if (!this.supabase) {
      // Direct client-side similarity comparison on mock store
      const mapped = this.mockStore
        .filter(m => m.agent_id === agentId)
        .map(m => {
          let dotProduct = 0;
          for (let i = 0; i < 384; i++) {
            dotProduct += (m.embedding?.[i] || 0) * embedding[i];
          }
          return { ...m, similarity: dotProduct };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return mapped;
    }

    try {
      const { data, error } = await this.supabase.rpc('match_memories', {
        query_embedding: Array.from(embedding),
        match_agent_id: agentId,
        match_count: limit,
      });

      if (error) {
        console.error('[MemoryManager] retrieveRelevant RPC error:', error.message);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('[MemoryManager] retrieveRelevant exception:', err);
      return [];
    }
  }

  async retrieveRecent(agentId: string, limit: number = 3): Promise<any[]> {
    if (!this.supabase) {
      return this.mockStore
        .filter(m => m.agent_id === agentId)
        .sort((a, b) => b.heartbeat - a.heartbeat)
        .slice(0, limit);
    }

    try {
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
    } catch (err) {
      console.error('[MemoryManager] retrieveRecent exception:', err);
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
