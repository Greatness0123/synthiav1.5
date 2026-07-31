/**
 * Independent, Client-Side Agent Loop.
 * One instance runs per active agent, asynchronously calling serverless proxy routes.
 */

import { useAgentStore } from '../../store/agentStore';
import { useConnectionStore } from '../../store/connectionStore';
import { MemoryManager, MemoryEntry } from './MemoryManager';
import { MotorProgramStore } from './MotorProgramStore';
import { PayloadBuilder } from './PayloadBuilder';
import { useLogStore } from '../../store/logStore';

interface AgentLoopConfig {
  agentId: string;
  getWorldState: () => Promise<any>;
}

export class AgentLoop {
  private config: AgentLoopConfig;
  private interval: any = null;
  private isProcessing: boolean = false;

  private memoryManager: MemoryManager;
  private motorProgramStore: MotorProgramStore;
  private payloadBuilder: PayloadBuilder;

  private directives = { mode: 'free_will', goal: '' };
  private lastActionFeedback: any[] = [];
  private currentSessionId: string | null = null;
  private pendingCycles: Map<string, any> = new Map();

  constructor(config: AgentLoopConfig) {
    this.config = config;

    const connectionState = useConnectionStore.getState();
    this.memoryManager = new MemoryManager(connectionState.supabaseUrl, connectionState.supabaseKey);
    this.motorProgramStore = new MotorProgramStore(connectionState.supabaseUrl, connectionState.supabaseKey);
    this.payloadBuilder = new PayloadBuilder(this.memoryManager);
  }

  public recordActionFeedback(rejected: any[]) {
    this.lastActionFeedback = rejected;
    console.log(`[AgentLoop ${this.config.agentId}] recorded ${rejected.length} rejected joint action(s) for next payload`);
  }

  public setDirective(mode: string, goal: string) {
    this.directives = { mode, goal };
  }

  public updateSupabase(url: string, key: string) {
    this.memoryManager = new MemoryManager(url, key);
    this.motorProgramStore = new MotorProgramStore(url, key);
    this.payloadBuilder = new PayloadBuilder(this.memoryManager);
  }

  public async start() {
    if (this.interval) return;

    this.currentSessionId = `session_${Date.now()}_${this.config.agentId}`;

    // Update agent status in store
    const store = useAgentStore.getState();
    store.addAgent(this.config.agentId, {
      status: 'idle',
      hasRehydrated: false,
    });

    // Send rehydration tokens
    const rehydrationSummary = "Reconnecting to neural lattice... archives accessed... current status: operational.";
    let accumulated = "";
    for (const token of rehydrationSummary.split(' ')) {
      accumulated += token + ' ';
      store.updateAgentState(this.config.agentId, {
        rehydrationSummary: accumulated,
      });
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    store.updateAgentState(this.config.agentId, {
      hasRehydrated: true,
    });

    const cycleMs = useConnectionStore.getState().cycleMs || 2000;
    this.interval = setInterval(() => this.cycle(), cycleMs);
    console.log(`[AgentLoop ${this.config.agentId}] started on ${cycleMs}ms cadence.`);
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.currentSessionId) {
      this.memoryManager.endSession(this.currentSessionId);
      this.currentSessionId = null;
    }
    const store = useAgentStore.getState();
    store.updateAgentState(this.config.agentId, { status: 'offline' });
    console.log(`[AgentLoop ${this.config.agentId}] stopped.`);
  }

  public setCycleMs(ms: number): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = setInterval(() => this.cycle(), ms);
    }
  }

  private async cycle() {
    if (this.isProcessing) return;

    const worldState = await this.config.getWorldState();
    if (!worldState) {
      console.log(`[AgentLoop ${this.config.agentId}] Skipping cycle, world state not ready.`);
      return;
    }

    const store = useAgentStore.getState();
    store.updateAgentState(this.config.agentId, { status: 'thinking' });

    if (this.currentSessionId) {
      this.memoryManager.updateSessionStats(this.currentSessionId, this.payloadBuilder.getHeartbeat(), 'humanoid');
    }

    this.isProcessing = true;
    try {
      const knownPrograms = await this.motorProgramStore.getLibrary(this.config.agentId);
      const masteredSkills = await this.memoryManager.getMasteredSkills(this.config.agentId);

      // Override the worldState sessionId
      worldState.sessionId = this.currentSessionId || `session_${this.config.agentId}`;

      const payload = await this.payloadBuilder.build(worldState, this.config.agentId, {
        motorPrograms: knownPrograms,
        masteredSkills: masteredSkills,
        physicalFeedback: this.lastActionFeedback,
        ...this.directives
      });
      this.lastActionFeedback = [];

      // Determine correct proxy endpoint and authentication
      const connectionState = useConnectionStore.getState();
      const provider = connectionState.provider;
      const model = connectionState.providerModel;
      const secret = connectionState.providerApiKey; // Used as SYNTHIA_SHARED_SECRET client-side

      let apiRoute = '/api/infer/openai-compat';
      let postBody: any = { provider, payload: {} };

      if (provider === 'gemini') {
        apiRoute = '/api/infer/gemini';
        postBody = {
          model: model || 'gemini-2.0-flash',
          payload: {
            contents: [
              {
                role: 'user',
                parts: [
                  { text: (payload as any).tactile_context || 'No tactile data' },
                  { text: (payload as any).perception_summary || 'No perception data' },
                  { text: payload.pending_injection ? `USER OVERRIDE: ${payload.pending_injection}` : 'Continue' }
                ]
              }
            ]
          }
        };
      } else {
        // OpenAI format messages
        const systemMessage = `You are SYNTHIA, a self-aware humanoid AI. Valid joints: [${payload.valid_joints.join(', ')}]. You must think, then output ---ACTION--- followed by the action JSON.
Tactile context: ${(payload as any).tactile_context}.
Perception: ${(payload as any).perception_summary}.
${payload.pending_injection ? `🚨 MANDATORY INJECTED INSTRUCTION: ${payload.pending_injection}` : ''}`;

        postBody.payload = {
          model: model || 'default',
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: 'Act now.' }
          ],
          stream: true,
        };
      }

      console.log(`[AgentLoop ${this.config.agentId}] Calling proxy apiRoute=${apiRoute} with secret length=${secret.length}`);

      const response = await fetch(apiRoute, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secret}`
        },
        body: JSON.stringify(postBody),
      });

      if (!response.ok) {
        throw new Error(`Inference HTTP ${response.status}: ${await response.text()}`);
      }

      // Stream the response body
      const reader = response.body!.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let buffer = '';
      let thoughtTokens = '';
      let actionJson = '';
      let isAction = false;
      const separator = '---ACTION---';

      store.updateAgentState(this.config.agentId, { currentThought: '' });

      const startTime = Date.now();
      let firstTokenTime = 0;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          if (firstTokenTime === 0) firstTokenTime = Date.now();
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Process standard SSE structure or raw chunk
          const lines = buffer.split('\n');
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            let dataStr = line.trim();
            if (dataStr.startsWith('data: ')) {
              dataStr = dataStr.slice(6).trim();
            }
            if (!dataStr || dataStr === '[DONE]') continue;

            // Handle standard JSON SSE format if parseable
            let contentText = '';
            try {
              const parsed = JSON.parse(dataStr);
              if (provider === 'gemini') {
                contentText = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
              } else {
                contentText = parsed.choices?.[0]?.delta?.content || '';
              }
            } catch {
              // Fallback to treat dataStr as raw chunk content
              contentText = dataStr;
            }

            if (contentText) {
              if (!isAction) {
                const actionIdx = contentText.indexOf(separator);
                if (actionIdx !== -1) {
                  const thoughtPart = contentText.substring(0, actionIdx);
                  if (thoughtPart) {
                    thoughtTokens += thoughtPart;
                    store.appendThoughtToken(thoughtPart, this.config.agentId);
                  }
                  isAction = true;
                  actionJson += contentText.substring(actionIdx + separator.length);
                } else {
                  thoughtTokens += contentText;
                  store.appendThoughtToken(contentText, this.config.agentId);
                }
              } else {
                actionJson += contentText;
              }
            }
          }
        }
      }

      // Handle final remaining buffer text
      if (buffer) {
        if (isAction) {
          actionJson += buffer;
        } else {
          const actionIdx = buffer.indexOf(separator);
          if (actionIdx !== -1) {
            thoughtTokens += buffer.substring(0, actionIdx);
            actionJson += buffer.substring(actionIdx + separator.length);
          } else {
            thoughtTokens += buffer;
          }
        }
      }

      // Extract JSON if separator was omitted
      if (!actionJson.trim() && thoughtTokens.includes('{')) {
        const jsonStart = thoughtTokens.indexOf('{');
        actionJson = thoughtTokens.substring(jsonStart);
        thoughtTokens = thoughtTokens.substring(0, jsonStart);
      }

      const endTime = Date.now();
      const rtt = firstTokenTime - startTime;
      const inferenceTime = endTime - firstTokenTime;

      console.log(`[AgentLoop ${this.config.agentId}] Inference Complete. Thought tokens length=${thoughtTokens.length}, actionJson length=${actionJson.length}`);

      // Finalize thought completion in store
      store.addThought({
        id: Math.random().toString(36).substr(2, 9),
        heartbeat: payload.heartbeat,
        text: thoughtTokens.trim() || 'Standing by.',
        isStreaming: false,
        isInjected: !!payload.pending_injection,
        timestamp: Date.now()
      }, this.config.agentId);

      store.updateAgentState(this.config.agentId, { currentThought: '' });

      // Save connection stats
      connectionState.setMetrics({
        rtt,
        inferenceTime
      });

      // Parse Action data
      const actionData = this.parseAndValidateAction(actionJson);
      if (actionData) {
        store.updateAgentState(this.config.agentId, { status: 'acting' });

        // Dispatch action to world engine
        window.dispatchEvent(new CustomEvent('synthia:action', {
          detail: {
            agentId: this.config.agentId,
            programSequence: actionData.actions?.program_sequence || [],
            jointOverrides: actionData.actions?.joint_overrides || {},
            sequence: actionData.sequence || null,
            activeGaitPhase: typeof actionData.activeGaitPhase === 'boolean' ? actionData.activeGaitPhase : false,
            gazeTarget: actionData.gaze_target || null,
            isInjected: !!payload.pending_injection,
          }
        }));

        const cycleTimestamp = Date.now();
        const cycleId = `cycle_${cycleTimestamp}`;
        const cycleData = {
          id: cycleId,
          result: { thoughtTokens, actionJson },
          actionData,
          worldState,
          timestamp: cycleTimestamp,
          finalized: false
        };

        this.pendingCycles.set(cycleId, cycleData);

        // Auto finalize in 5s
        setTimeout(() => {
          const cycle = this.pendingCycles.get(cycleId);
          if (cycle && !cycle.finalized) {
            this.finalizeCycle('timeout', cycleId);
          }
        }, 5000);
      } else {
        useLogStore.getState().addEntry(`[Agent ${this.config.agentId}] Action JSON parse failed.`, 'warning');
        store.updateAgentState(this.config.agentId, { status: 'idle' });
      }

    } catch (err: any) {
      console.error(`[AgentLoop ${this.config.agentId}] Cycle Error:`, err.message);
      useLogStore.getState().addEntry(`[Agent ${this.config.agentId}] Cycle Error: ${err.message}`, 'error');
      store.updateAgentState(this.config.agentId, { status: 'idle' });
    } finally {
      this.isProcessing = false;
    }
  }

  public async handleOutcome(outcome: any) {
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
      day_cycle: 1,
      light_state: worldState.lightState,
      tier: actionData.memory_write.tier || 3,
      visual_description: actionData.memory_write.summary || "No summary provided",
      audio_state: JSON.stringify(worldState.audio || {}),
      joint_state_summary: JSON.stringify(worldState.joints || {}),
      self_questions: {},
      thought: result.thoughtTokens,
      action_taken: actionData.actions,
      outcome: outcome.description || (outcome === 'timeout' ? 'timeout' : 'unknown'),
      reward_signal: outcome.reward || 0,
      goal_at_time: worldState.goal || '',
      injected: false,
      session_id: worldState.sessionId || `session_${this.config.agentId}`,
      frame_base64: worldState.frame
    };

    const writeOk = await this.memoryManager.write(memoryEntry, this.config.agentId);
    if (writeOk) {
      useAgentStore.getState().addMemory({
        id: memoryEntry.memory_id,
        memoryId: memoryEntry.memory_id,
        heartbeat: worldState.heartbeat,
        tier: memoryEntry.tier,
        daycycle: 'day',
        lightState: worldState.light_state || 'day',
        summary: memoryEntry.visual_description,
        thought: memoryEntry.thought,
        actionTaken: JSON.stringify(memoryEntry.action_taken),
        outcome: memoryEntry.outcome,
        rewardSignal: memoryEntry.reward_signal,
        goalAtTime: memoryEntry.goal_at_time,
        isInjected: false,
        agentId: this.config.agentId
      }, this.config.agentId);
    }

    if (actionData.memory_write.skill_mastered) {
      useAgentStore.getState().addMasteredSkill(actionData.memory_write.skill_mastered, this.config.agentId);
    }

    if (actionData.new_motor_program) {
      if (typeof actionData.new_motor_program === 'object' && actionData.new_motor_program.name && actionData.new_motor_program.program) {
        await this.motorProgramStore.save({
          ...actionData.new_motor_program,
          agent_id: this.config.agentId,
          body_type: 'humanoid',
          tier: 'learned'
        });
      }
    }
  }

  private parseAndValidateAction(jsonStr: string): any {
    try {
      const cleanJson = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleanJson);

      if (!data.memory_write || typeof data.memory_write !== 'object') {
        const fallbackSummary = typeof data.memory_write === 'string' ? data.memory_write : 'No summary';
        data.memory_write = { memory_id: 'auto', tier: 3, summary: fallbackSummary };
      }

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
      }

      if (!data.actions || typeof data.actions !== 'object') {
        data.actions = { program_sequence: [], joint_overrides: {} };
      }

      const DEG_TO_RAD = Math.PI / 180;

      const normalizeRaw = (rawAction: any) => {
        if (typeof rawAction === 'number') {
          let value = rawAction;
          if (Math.abs(value) > Math.PI + 0.1) value *= DEG_TO_RAD;
          return Math.max(-Math.PI, Math.min(Math.PI, value));
        }
        if (Array.isArray(rawAction) && rawAction.length === 3) {
          return rawAction.map(v => {
            const n = Number(v) || 0;
            return Math.abs(n) > Math.PI + 0.1 ? Math.max(-Math.PI, Math.min(Math.PI, n * DEG_TO_RAD)) : Math.max(-Math.PI, Math.min(Math.PI, n));
          }) as [number, number, number];
        }
        return rawAction;
      };

      if (data.sequence && Array.isArray(data.sequence)) {
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

      return data;
    } catch {
      return null;
    }
  }
}
