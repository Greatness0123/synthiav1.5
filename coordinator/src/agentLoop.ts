/**
 * Main cycle loop per agent.
 */

import { PayloadBuilder } from './payloadBuilder';
import { injectionQueue } from './injectionQueue';
import { InferenceClient } from './inferenceClient';
import { MemoryManager, MemoryEntry } from './memoryManager';
import { MotorProgramStore } from './motorProgramStore';
import { ReconnectionManager } from './reconnectionManager';

interface AgentLoopConfig {
  agentId: string;
  cycleMs: number;
  sendToFrontend: (message: any) => void;
  supabaseUrl: string;
  supabaseKey: string;
}

export class AgentLoop {
  private config: AgentLoopConfig;
  private lastWorldState: any = null;
  private interval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  private payloadBuilder: PayloadBuilder;
  private inferenceClient: InferenceClient;
  private memoryManager: MemoryManager;
  private motorProgramStore: MotorProgramStore;
  private reconnectionManager: ReconnectionManager;

  private directives = { mode: 'free_will', goal: '' };
  private heartbeat = 0;
  private lastActionFeedback: any[] = [];

  constructor(config: AgentLoopConfig) {
    this.config = config;
    this.memoryManager = new MemoryManager(config.supabaseUrl, config.supabaseKey);
    this.motorProgramStore = new MotorProgramStore(config.supabaseUrl, config.supabaseKey);
    this.payloadBuilder = new PayloadBuilder(this.memoryManager);
    this.inferenceClient = new InferenceClient();
    this.reconnectionManager = new ReconnectionManager((status, message) => {
      this.config.sendToFrontend({ type: 'connection_status', data: { status, agentId: this.config.agentId } });
      if (status === 'error') {
        this.config.sendToFrontend({ type: 'error', data: { code: 'CONNECTION_ERROR', message } });
      }
    });
  }

  updateWorldState(state: any) {
    this.lastWorldState = state;
    this.heartbeat = state.heartbeat;
  }

  setDirective(mode: string, goal: string) {
    this.directives = { mode, goal };
  }

  recordActionFeedback(rejected: any[]) {
    this.lastActionFeedback = rejected;
    console.log(`AgentLoop: recorded ${rejected.length} rejected joint action(s) for next payload`);
  }

  setEndpoint(url: string) {
    this.inferenceClient.setEndpoint(url);
    this.reconnectionManager.updateConfig({ endpoint: url });
  }

  syncState() {
    this.config.sendToFrontend({ type: 'connection_status', data: { status: this.reconnectionManager.getStatus() === 'connected' ? 'connected' : 'disconnected', agentId: this.config.agentId } });
    this.config.sendToFrontend({
      type: 'heartbeat_sync',
      data: { 
        heartbeat: this.payloadBuilder.getHeartbeat(),
        agentId: this.config.agentId 
      }
    });
  }

  setProvider(type: string, endpoint: string, apiKey?: string, model?: string) {
    this.inferenceClient.setProvider(type, endpoint, apiKey, model);
    this.reconnectionManager.updateConfig({ endpoint, providerType: type });
  }

  setCycleMs(ms: number): void {
    this.config.cycleMs = ms;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = setInterval(() => this.cycle(), ms);
    }
  }

  private currentSessionId: string | null = null;

  updateSupabase(url: string, key: string) {
    this.config.supabaseUrl = url;
    this.config.supabaseKey = key;
    this.memoryManager = new MemoryManager(url, key);
    this.motorProgramStore = new MotorProgramStore(url, key);
    this.payloadBuilder = new PayloadBuilder(this.memoryManager);
  }

  updateSendToFrontend(sendToFrontend: (message: any) => void) {
    this.config.sendToFrontend = sendToFrontend;
  }

  async start() {
    if (this.interval) return;

    this.currentSessionId = `session_${Date.now()}_${this.config.agentId}`;

    // Send rehydration tokens
    const rehydrationSummary = "Reconnecting to neural lattice... archives accessed... current status: operational.";
    for (const token of rehydrationSummary.split(' ')) {
      this.config.sendToFrontend({ type: 'rehydration_token', data: { token: token + ' ', agentId: this.config.agentId } });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.config.sendToFrontend({ type: 'rehydration_complete', data: { agentId: this.config.agentId } });

    this.interval = setInterval(() => this.cycle(), this.config.cycleMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.currentSessionId) {
      this.memoryManager.endSession(this.currentSessionId);
      this.currentSessionId = null;
    }
  }

  private async cycle() {
    console.log(`AgentLoop: Cycle triggered. isProcessing=${this.isProcessing}, hasWorldState=${!!this.lastWorldState}`);
    if (this.isProcessing || !this.lastWorldState) return;

    if (!this.inferenceClient.hasEndpoint()) {
      console.log('AgentLoop: Skipping cycle, inference endpoint not set yet.');
      return;
    }

    if (this.currentSessionId) {
      this.memoryManager.updateSessionStats(this.currentSessionId, this.payloadBuilder.getHeartbeat(), 'humanoid');
    }

    // Dequeue any pending injection and stamp it onto the world state.
    // payloadBuilder reads it from worldState.injected_thought.
    const { item: injectedThought, queue: remainingQueue } = injectionQueue.dequeue(this.config.agentId);
    if (injectedThought) {
      this.lastWorldState.injected_thought = injectedThought;
      // Tell the frontend the injection was consumed so the badge count drops
      this.config.sendToFrontend({ type: 'injection_queue_update', data: { queue: remainingQueue, agentId: this.config.agentId } });
      console.log(`AgentLoop: Injection consumed: "${injectedThought}" — ${remainingQueue.length} remaining`);
    }

    this.isProcessing = true;
    try {
      const knownPrograms = await this.motorProgramStore.getLibrary(this.config.agentId);
      const masteredSkills = await this.memoryManager.getMasteredSkills(this.config.agentId);

      // Override the worldState sessionId with the generated true session ID
      this.lastWorldState.sessionId = this.currentSessionId || `session_${this.config.agentId}`;

      const payload = await this.payloadBuilder.build(this.lastWorldState, this.config.agentId, {
        motorPrograms: knownPrograms,
        masteredSkills: masteredSkills,
        physicalFeedback: this.lastActionFeedback,
        ...this.directives
      });
      this.lastActionFeedback = [];

      let result;
      let retries = 0;
      let actionData: any = null;

      console.log('AgentLoop: Sending inference request...');
      console.log(`AgentLoop: Payload summary — frame_len=${payload.frame?.length ?? 0}, audio_len=${payload.audio_pcm?.length ?? 0}, joints=${Object.keys(payload.joints || {}).length}, memories=${(payload.relevant_memories?.length ?? 0) + (payload.recent_working_memories?.length ?? 0)}, hasEndpoint=${this.inferenceClient.hasEndpoint()}`);
      while (retries < 3) {
        try {
          result = await this.inferenceClient.infer(payload, (token) => {
            this.config.sendToFrontend({ type: 'thought_token', data: { token, agentId: this.config.agentId } });
          });

          if (!result) {
            retries++;
            continue;
          }
          this.config.sendToFrontend({ type: 'thought_complete', data: { agentId: this.config.agentId } });

          this.config.sendToFrontend({
            type: 'heartbeat_sync',
            data: { 
              heartbeat: this.payloadBuilder.getHeartbeat(),
              agentId: this.config.agentId 
            }
          });

          // Forward connection status
          this.config.sendToFrontend({
            type: 'connection_status',
            data: {
              status: 'connected',
              rtt: result.rtt,
              inferenceTime: result.inferenceTime,
              agentId: this.config.agentId
            }
          });

          console.log('AgentLoop: Inference result received. Parsing action...');
          console.log(`AgentLoop: Raw actionJson (${result.actionJson.length} chars): ${result.actionJson.substring(0, 500)}`);
          actionData = this.parseAndValidateAction(result.actionJson);
          if (actionData) {
            console.log('AgentLoop: Action parsed successfully:', JSON.stringify(actionData).substring(0, 200));
            break;
          }
          console.warn(`AgentLoop: Action parse failed on attempt ${retries + 1}. Raw JSON was: ${result.actionJson.substring(0, 300)}`);

          retries++;
          // If invalid, we could modify payload to ask for correction,
          // but for now we just retry or skip.
          console.warn(`Invalid action JSON, retry ${retries}`);
        } catch (err) {
          this.reconnectionManager.handleFailure(err);
          break; // Exit retry loop on fetch error, reconnectionManager handles it
        }
      }

    if (actionData) {
      // Forward full timeline if provided by the model, otherwise fallback to single-frame joint_overrides
      this.config.sendToFrontend({
        type: 'action',
        data: {
          programSequence: actionData.actions?.program_sequence || [],
          jointOverrides: actionData.actions?.joint_overrides || {},
          sequence: actionData.sequence || null,
          activeGaitPhase: typeof actionData.activeGaitPhase === 'boolean' ? actionData.activeGaitPhase : false,
          gazeTarget: actionData.gaze_target || null,
          isInjected: !!this.lastWorldState.injected_thought,
          agentId: this.config.agentId
        }
      });

      const cycleTimestamp = Date.now();
      const cycleId = `cycle_${cycleTimestamp}`;
      const cycleData = {
        id: cycleId,
        result,
        actionData,
        worldState: this.lastWorldState,
        timestamp: cycleTimestamp,
        finalized: false
      };
      
      this.pendingCycles.set(cycleId, cycleData);

      // If no outcome in 5s, we proceed to write memory anyway with 'unknown' outcome
      setTimeout(() => {
        const cycle = this.pendingCycles.get(cycleId);
        if (cycle && !cycle.finalized) {
            this.finalizeCycle('timeout', cycleId);
        }
      }, 5000);

    } else {
      this.config.sendToFrontend({ type: 'error', data: { code: 'INVALID_ACTION', message: 'Failed to get valid action from AI' } });
    }

  } catch (err: any) {
    this.config.sendToFrontend({ type: 'error', data: { code: 'CYCLE_ERROR', message: err.message } });
  } finally {
    this.isProcessing = false;
  }
}

private pendingCycles: Map<string, any> = new Map();

/**
 * Convert a data URL string (data:image/jpeg;base64,...) to a Buffer for Supabase storage.
 */
private convertFrameToBuffer(frame: any): Buffer | undefined {
  if (!frame || typeof frame !== 'string') return undefined;
  try {
    const base64 = frame.includes(',') ? frame.split(',')[1] : frame;
    return Buffer.from(base64, 'base64');
  } catch {
    return undefined;
  }
}

async handleOutcome(outcome: any) {
  // Finalize the most recent pending cycle
  let latestCycleId: string | null = null;
  let latestTs = 0;
  for (const [id, cycle] of this.pendingCycles.entries()) {
    if (!cycle.finalized && cycle.timestamp > latestTs) {
      latestTs = cycle.timestamp;
      latestCycleId = id;
    }
  }
  if (latestCycleId) {
    this.finalizeCycle(outcome, latestCycleId);
  }
}

private async finalizeCycle(outcome: any, cycleId: string) {
  const cycle = this.pendingCycles.get(cycleId);
  if (!cycle || cycle.finalized) return;
  
  cycle.finalized = true;
  this.pendingCycles.delete(cycleId);
  const { result, actionData, worldState } = cycle;

    const memoryEntry: MemoryEntry = {
      memory_id: actionData.memory_write.memory_id === 'auto' ? `mem_${Date.now()}` : actionData.memory_write.memory_id,
      heartbeat: worldState.heartbeat,
      day_cycle: 1, // Default
      light_state: worldState.lightState,
      tier: actionData.memory_write.tier || 3,
      visual_description: actionData.memory_write.summary || "No summary provided",
      audio_state: JSON.stringify(worldState.audio),
      joint_state_summary: JSON.stringify(worldState.joints),
      self_questions: {},
      thought: result.thoughtTokens,
      action_taken: actionData.actions,
      outcome: outcome.description || (outcome === 'timeout' ? 'timeout' : 'unknown'),
      reward_signal: outcome.reward || 0,
      goal_at_time: worldState.goal,
      injected: false, // Set based on payloadBuilder
      session_id: worldState.sessionId || `session_${this.config.agentId}`,
      frame_buffer: this.convertFrameToBuffer(worldState.frame) // Convert data URL to Buffer for storage
    };

    const writeOk = await this.memoryManager.write(memoryEntry, this.config.agentId);
    if (writeOk) {
      this.config.sendToFrontend({ type: 'memory_saved', data: { memoryId: memoryEntry.memory_id, tier: memoryEntry.tier, agentId: this.config.agentId } });
    } else {
      this.config.sendToFrontend({ type: 'error', data: { code: 'MEMORY_WRITE_FAILED', message: `Failed to write memory ${memoryEntry.memory_id} to Supabase`, agentId: this.config.agentId } });
    }

    if (actionData.memory_write.skill_mastered) {
       this.config.sendToFrontend({ type: 'skill_mastered', data: { skillName: actionData.memory_write.skill_mastered, agentId: this.config.agentId } });
    }

    if (actionData.new_motor_program) {
      if (typeof actionData.new_motor_program === 'object' && actionData.new_motor_program.name && actionData.new_motor_program.program) {
        await this.motorProgramStore.save({
          ...actionData.new_motor_program,
          agent_id: this.config.agentId,
          body_type: 'humanoid', // Default
          tier: 'learned'
        });
      } else {
        console.warn(`[AgentLoop] new_motor_program was not a valid object with name/program. Got:`, actionData.new_motor_program);
      }
    }
  }

  private parseAndValidateAction(jsonStr: string): any {
    try {
      const cleanJson = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleanJson);

      // Normalize memory_write
      if (!data.memory_write || typeof data.memory_write !== 'object') {
        const fallbackSummary = typeof data.memory_write === 'string' ? data.memory_write : 'No summary provided';
        data.memory_write = { memory_id: 'auto', tier: 3, summary: fallbackSummary };
      }

      // Normalize actions array to expected format
      if (Array.isArray(data.actions)) {
        const programs = data.actions.map((a: any) => a.program_name || a.program || a.action).filter(Boolean);
        const overrides: Record<string, any> = {};
        data.actions.forEach((a: any) => {
          if (a.joint_overrides) Object.assign(overrides, a.joint_overrides);
          if (a.joint && a.rotation) overrides[a.joint] = a.rotation;
        });
        data.actions = {
          program_sequence: programs,
          joint_overrides: overrides
        };
      } else if (data.actions && Array.isArray(data.actions.motor_sequence)) {
        // Handle {"actions": [{"motor_sequence": [...]}]} inside a nested object or similar
        const overrides: Record<string, any> = {};
        data.actions.motor_sequence.forEach((a: any) => {
          if (a.joint && a.rotation) overrides[a.joint] = a.rotation;
        });
        data.actions.joint_overrides = overrides;
        data.actions.program_sequence = [data.actions.program_name].filter(Boolean);
      }

      // Support sequence outputs nested inside actions.sequence
      if (!data.sequence && data.actions && typeof data.actions === 'object' && Array.isArray(data.actions.sequence)) {
        data.sequence = data.actions.sequence;
      }

      // Validation and fallback handling
      if (!data.actions || typeof data.actions !== 'object') {
        data.actions = { program_sequence: [], joint_overrides: {} };
      }
      if (!Array.isArray(data.actions.program_sequence)) {
        data.actions.program_sequence = [];
      }
      if (!data.actions.joint_overrides || typeof data.actions.joint_overrides !== 'object') {
        data.actions.joint_overrides = {};
      }
      const hasLegacyAction = data.actions.program_sequence.length > 0 || Object.keys(data.actions.joint_overrides).length > 0;
      if (!hasLegacyAction && !Array.isArray(data.sequence)) {
        return null;
      }

      // Normalise & convert joint_overrides OR timeline sequence
      // The LLM may output either the legacy single-frame joint_overrides OR the new timeline schema with `sequence`.
      const DEG_TO_RAD = Math.PI / 180;

      const normalizeRaw = (rawAction: any) => {
        if (typeof rawAction === 'number') {
          let value = rawAction;
          if (Math.abs(value) > Math.PI + 0.1) value *= DEG_TO_RAD;
          return Math.max(-Math.PI, Math.min(Math.PI, value));
        }

        if (Array.isArray(rawAction) && rawAction.length === 3) {
          const x = Number(rawAction[0]) || 0;
          const y = Number(rawAction[1]) || 0;
          const z = Number(rawAction[2]) || 0;
          const converted = [x, y, z].map((v) => {
            const n = Number(v) || 0;
            return Math.abs(n) > Math.PI + 0.1 ? Math.max(-Math.PI, Math.min(Math.PI, n * DEG_TO_RAD)) : Math.max(-Math.PI, Math.min(Math.PI, n));
          }) as [number, number, number];
          return converted;
        }

        if (typeof rawAction === 'object' && rawAction !== null) {
          if (typeof rawAction.scalar === 'number') {
            let scalar = rawAction.scalar;
            if (Math.abs(scalar) > Math.PI + 0.1) scalar *= DEG_TO_RAD;
            return Math.max(-Math.PI, Math.min(Math.PI, scalar));
          }
          const x = Number(rawAction.x ?? rawAction.pitch ?? 0) || 0;
          const y = Number(rawAction.y ?? rawAction.yaw ?? 0) || 0;
          const z = Number(rawAction.z ?? rawAction.roll ?? 0) || 0;
          const converted = [x, y, z].map((v) => {
            const n = Number(v) || 0;
            return Math.abs(n) > Math.PI + 0.1 ? Math.max(-Math.PI, Math.min(Math.PI, n * DEG_TO_RAD)) : Math.max(-Math.PI, Math.min(Math.PI, n));
          }) as [number, number, number];
          return converted;
        }

        return rawAction;
      };

      if (data.sequence && Array.isArray(data.sequence)) {
        // Normalize every frame's overrides into radians-friendly payloads
        for (const frame of data.sequence) {
          if (!frame.overrides || typeof frame.overrides !== 'object') continue;
          for (const joint in frame.overrides) {
            frame.overrides[joint] = normalizeRaw(frame.overrides[joint]);
          }
        }
      }

      if (data.actions && data.actions.joint_overrides) {
        for (const joint in data.actions.joint_overrides) {
          data.actions.joint_overrides[joint] = normalizeRaw(data.actions.joint_overrides[joint]);
        }
      }

      // ── Gaze Target converted to head bone rotation ──────────────
      // The AI controls its first-person view by rotating the head bone
      // (mixamorighead). A gaze_target { yaw, pitch } is converted into
      // a joint override on mixamorighead so it goes through the normal
      // joint validation pipeline (clamping, anatomical limits, etc.)
      // rather than being forwarded as a separate camera offset.
      //
      // gaze_target yaw/pitch are in radians relative to neutral head pose.
      // Range: head can yaw ±45° (0.79 rad) and pitch ±45° (0.79 rad).
      // ──────────────────────────────────────────────────────────────
      const gazeTarget = data.gaze_target || data.actions?.gaze_target || null;
      if (gazeTarget && typeof gazeTarget === 'object') {
        let gtYaw = gazeTarget.yaw ?? 0;
        let gtPitch = gazeTarget.pitch ?? 0;

        // Auto-convert degrees → radians if values are large
        if (Math.abs(gtYaw) > Math.PI + 0.1) gtYaw *= DEG_TO_RAD;
        if (Math.abs(gtPitch) > Math.PI + 0.1) gtPitch *= DEG_TO_RAD;

        // Clamp to reasonable head rotation range (±45° = ±0.79 rad)
        gtYaw = Math.max(-0.79, Math.min(0.79, gtYaw));
        gtPitch = Math.max(-0.79, Math.min(0.79, gtPitch));

        // Inject into joint_overrides as mixamorighead [pitch, yaw, roll]
        // (Head bone uses X=pitch=forward bend, Y=yaw=turn left)
        if (!data.actions.joint_overrides['mixamorighead']) {
          data.actions.joint_overrides['mixamorighead'] = [gtPitch, gtYaw, 0];
        }
      }

      return {
        ...data,
        gaze_target: null, // No longer forwarded — was merged into joint_overrides
      };
    } catch (e: any) {
      console.error(`AgentLoop: JSON parse error — ${e.message}`);
      console.error(`AgentLoop: Full actionJson that failed: ${jsonStr}`);
      return null;
    }
  }
}
