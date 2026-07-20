/**
 * Context Provider for the Coordinator WebSocket connection.
 */

import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { useAgentStore } from '../../store/agentStore';
import { useUIStore } from '../../store/uiStore';
import { useLogStore } from '../../store/logStore';
import { SKILL_RUNGS } from '../../constants/progressionLadder';
import { synthiaToast } from '../../components/ui/Toast';
import { logger as Logger } from '../../utils/logger';
import { RagdollBuilder } from '../engine/RagdollBuilder';

type MessageListener = (msg: { type: string; data: any }) => void;

interface CoordinatorContextType {
  sendMessage: (type: string, data: Record<string, any>) => void;
  setRagdoll: (ragdoll: RagdollBuilder | null) => void;
  onMessage: (listener: MessageListener) => () => void;
}

const CoordinatorContext = createContext<CoordinatorContextType | null>(null);

function normalizeWebSocketUrl(url: string): string {
  if (url.startsWith('wss://') || url.startsWith('ws://')) return url;
  if (url.startsWith('https://')) return url.replace('https://', 'wss://');
  if (url.startsWith('http://')) return url.replace('http://', 'ws://');
  return `ws://${url}`;
}

export const CoordinatorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socketRef = useRef<WebSocket | null>(null);
  const ragdollRef = useRef<RagdollBuilder | null>(null);
  const { endpoint, setStatus, setMetrics } = useConnectionStore();
  const { setExportProgress } = useUIStore();
  const {
    appendThoughtToken,
    setCurrentThought,
    addThought,
    addMemory,
    appendRehydrationToken,
    setHasRehydrated,
    addMasteredSkill,
    incrementHeartbeat,
    setInjectionQueue,
    decrementInjectionQueueCount,
    setRung
  } = useAgentStore();

  const setRagdoll = useCallback((ragdoll: RagdollBuilder | null) => {
    ragdollRef.current = ragdoll;
  }, []);

  const lastInjectedRef = useRef(false);
  const messageListenersRef = useRef<Set<MessageListener>>(new Set());

  const onMessage = useCallback((listener: MessageListener) => {
    messageListenersRef.current.add(listener);
    return () => { messageListenersRef.current.delete(listener); };
  }, []);

  const sendMessage = useCallback((type: string, data: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  const [reconnectCounter, setReconnectCounter] = React.useState(0);

  useEffect(() => {
    if (!endpoint) return;

    const normalizedUrl = normalizeWebSocketUrl(endpoint);
    Logger.info(`Connecting to coordinator at ${normalizedUrl}`);
    setStatus('connecting');

    const socket = new WebSocket(normalizedUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      Logger.info('Connected to coordinator');
      setStatus('connected');
      synthiaToast.success('Connected to coordinator');
      useLogStore.getState().addEntry('Connected to coordinator', 'success');

      // Automatically sync full provider config to the coordinator on connection/reconnect.
      // Always send set_provider (not set_endpoint) so storedProviderConfig is set on the server,
      // even for kaggle. This ensures agents get the correct config after server restarts.
      const state = useConnectionStore.getState();
      if (state.provider && state.inferenceEndpoint) {
        const syncMsg = {
          type: 'set_provider',
          data: {
            agentId: 'agent_a',
            type: state.provider,
            endpoint: state.inferenceEndpoint,
            apiKey: state.providerApiKey || undefined,
            model: state.providerModel || undefined,
          }
        };
        Logger.info(`[AutoSync] Sending provider config: type=${state.provider}, endpoint=${state.inferenceEndpoint}`);
        socket.send(JSON.stringify(syncMsg));
      }
      if (state.cycleMs) {
        socket.send(JSON.stringify({
          type: 'set_cycle_ms',
          data: { agentId: 'agent_a', cycleMs: state.cycleMs },
        }));
      }
      if (state.supabaseUrl && state.supabaseKey) {
        socket.send(JSON.stringify({ type: 'set_supabase', data: { url: state.supabaseUrl, key: state.supabaseKey } }));
      }
    };

    socket.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);

        // Dispatch to external listeners (e.g. ExportModal)
        messageListenersRef.current.forEach(listener => {
          try { listener({ type, data }); } catch (e) { /* ignore listener errors */ }
        });

        switch (type) {
          case 'action':
            Logger.info(`[ACTION_PIPELINE] Received action from coordinator: ${JSON.stringify(data.jointOverrides || {}).substring(0, 100)}`);
            lastInjectedRef.current = !!data.isInjected;
            const hasJointOverrides = Object.keys(data.jointOverrides || {}).length > 0;
            const hasProgramSequence = Array.isArray(data.programSequence) && data.programSequence.length > 0;
            const hasTimelineSequence = Array.isArray(data.sequence) && data.sequence.length > 0;
            if (!hasJointOverrides && !hasProgramSequence && !hasTimelineSequence) {
              synthiaToast.warning('AI returned empty action — no movement commanded');
              useLogStore.getState().addEntry('Action: empty (no movement)', 'info');
            } else {
              const jointCount = Object.keys(data.jointOverrides || {}).length;
              const frameCount = hasTimelineSequence ? data.sequence.length : 0;
              synthiaToast.success(`AI moving ${jointCount} joints${frameCount ? ` over ${frameCount} timeline frames` : ''}`);
              useLogStore.getState().addEntry(`Action: moving ${jointCount} joints, sequence frames=${frameCount} — [${data.programSequence?.join(', ') || 'none'}]`, 'success');
            }
            window.dispatchEvent(new CustomEvent('synthia:action', { detail: data }));
            break;

          case 'thought_token':
            appendThoughtToken(data.token);
            break;

          case 'heartbeat_sync':
            useAgentStore.getState().setHeartbeat(data.heartbeat);
            break;

          case 'thought_complete':
            const thoughtText = useAgentStore.getState().currentThought;
            if (thoughtText) {
              useLogStore.getState().addEntry(`Thought: ${thoughtText.substring(0, 200)}`, 'info');
            }
            addThought({
              id: Math.random().toString(36).substr(2, 9),
              heartbeat: useAgentStore.getState().heartbeat,
              text: thoughtText,
              isStreaming: false,
              isInjected: lastInjectedRef.current,
              timestamp: Date.now()
            });
            lastInjectedRef.current = false;
            setCurrentThought('');
            break;

          case 'rehydration_token':
            appendRehydrationToken(data.token);
            break;

          case 'rehydration_complete':
            setHasRehydrated(true);
            break;

          case 'skill_mastered': {
            addMasteredSkill(data.skillName);
            synthiaToast.success(`Skill Mastered: ${data.skillName}`);

            // Rung progression logic — read rung imperatively to avoid WebSocket reconnect
            const rung = useAgentStore.getState().currentRung;
            const next = SKILL_RUNGS[rung + 1];
            if (next && data.skillName.toLowerCase().includes(next.criteria.toLowerCase())) {
              setRung(rung + 1);
              synthiaToast.success(`Rung ${rung + 1} complete: ${next.name}`);
            }
            break;
          }

          case 'connection_status':
            setMetrics({
              rtt: data.rtt,
              inferenceTime: data.inferenceTime
            });
            useLogStore.getState().addEntry(
              `Inference: ${data.inferenceTime}ms (RTT ${data.rtt}ms)`,
              data.inferenceTime > 5000 ? 'warning' : 'success'
            );
            incrementHeartbeat();
            break;

          case 'injection_queue_update':
            setInjectionQueue(data.queue);
            break;

          case 'injection_consumed':
            decrementInjectionQueueCount();
            break;

          case 'memory_saved':
            synthiaToast.success(`Memory saved: ${data.memoryId} (tier ${data.tier})`);
            addMemory({
              id: data.memoryId,
              memoryId: data.memoryId,
              heartbeat: useAgentStore.getState().heartbeat,
              tier: data.tier || 3,
              daycycle: 'day',
              lightState: 'day',
              summary: data.summary || 'Memory saved',
              thought: '',
              actionTaken: '',
              outcome: 'saved',
              rewardSignal: data.reward || 0,
              goalAtTime: null,
              isInjected: false,
              agentId: data.agentId || 'agent_a',
            });
            break;

          case 'export_progress':
            setExportProgress(data.percent);
            break;

          case 'export_complete': {
            setExportProgress(100);
            synthiaToast.success(`Export complete: ${data.filename}`);
            // Logic to trigger real download via the result.filename
            const downloadUrl = `${endpoint.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws')[0]}/exports/${data.filename}`;
            window.open(downloadUrl, '_blank');
            break;
          }

          case 'error':
            synthiaToast.error(data.message);
            useLogStore.getState().addEntry(`Error: ${data.message}`, 'error');
            break;

          default:
            Logger.warn('Unknown message type from coordinator:', type);
        }
      } catch (err) {
        Logger.error('Error parsing coordinator message:', err);
      }
    };

    socket.onclose = () => {
      Logger.info('Disconnected from coordinator. Reconnecting in 3 seconds...');
      setStatus('disconnected');
      useLogStore.getState().addEntry('Disconnected from coordinator — reconnecting...', 'warning');
      
      // Auto-reconnect cleanly by incrementing the counter
      setTimeout(() => {
        setReconnectCounter(c => c + 1);
      }, 3000);
    };

    socket.onerror = () => {
      Logger.error('WebSocket error');
      setStatus('error');
      useLogStore.getState().addEntry('WebSocket connection error', 'error');
    };

    return () => {
      // Remove onclose handler before closing so we don't trigger auto-reconnect on intentional cleanup
      socket.onclose = null;
      socket.close();
    };
  }, [endpoint, reconnectCounter]);

  return (
    <CoordinatorContext.Provider value={{ sendMessage, setRagdoll, onMessage }}>
      {children}
    </CoordinatorContext.Provider>
  );
};

export const useCoordinator = () => {
  const context = useContext(CoordinatorContext);
  if (!context) {
    throw new Error('useCoordinator must be used within a CoordinatorProvider');
  }
  return context;
};
