/**
 * Fastify server + WebSocket for communication with the frontend.
 */

import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { AgentLoop } from './agentLoop';
import { injectionQueue } from './injectionQueue';
import { setupSupabasePing } from './supabasePing';
import { DatasetExporter } from './datasetExporter';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Setup file logging
const logFile = path.join(process.cwd(), 'coordinator.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
logStream.write(`\n\n========================================================\n`);
logStream.write(`=== NEW COORDINATOR SESSION: ${new Date().toISOString()} ===\n`);
logStream.write(`========================================================\n\n`);

const wrapConsole = (originalFn: Function, prefix: string) => {
  return function (...args: any[]) {
    const msg = `[${new Date().toISOString()}] ${prefix} ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n';
    logStream.write(msg);
    originalFn.apply(console, args);
  };
};

console.log = wrapConsole(console.log, '[LOG]');
console.warn = wrapConsole(console.warn, '[WARN]');
console.error = wrapConsole(console.error, '[ERROR]');

const fastify = Fastify({ logger: true });
fastify.register(fastifyWebsocket);

// Serve exported files for download
const exportsDir = path.join(process.cwd(), 'exports');
if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
fastify.register(fastifyStatic, {
  root: exportsDir,
  prefix: '/exports/',
  decorateReply: false,
});

const agents = new Map<string, AgentLoop>();

// Default Supabase config (should be updated via WebSocket)
let supabaseUrl = process.env.SUPABASE_URL || '';
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
let kaggleEndpoint = process.env.KAGGLE_ENDPOINT_URL || '';

// Stored provider config — applied to agents when they are created
let storedProviderConfig: { type: string; endpoint: string; apiKey?: string; model?: string } | null = null;
let storedCycleMs: number | null = null;

if (supabaseUrl && supabaseKey) {
  setupSupabasePing(supabaseUrl, supabaseKey);
}

fastify.register(async (fastify) => {
  fastify.get('/ws', { websocket: true }, (connection: any, req: any) => {
    const socket = connection.socket || connection;
    socket.on('message', async (message: Buffer) => {
      try {
        const { type, data } = JSON.parse(message.toString());
        const { agentId } = data || {};

        // GLOBAL messages (no agentId required): set_provider, set_supabase, set_endpoint,
        // set_cycle_ms, export_request — plus inject_thought/set_directive whitelisted for pre-agent bootstrap
        if (!agentId &&
            type !== 'set_supabase' &&
            type !== 'set_endpoint' &&
            type !== 'set_provider' &&
            type !== 'set_directive' &&
            type !== 'inject_thought' &&
            type !== 'set_cycle_ms' &&
            type !== 'export_request' &&
            type !== 'fetch_sessions' &&
            type !== 'action_feedback') return;

        let agent = agents.get(agentId);
        if (agent) {
          agent.updateSendToFrontend((msg) => {
            try {
              socket.send(JSON.stringify(msg));
            } catch (err) {
              console.error(`[Coordinator] Failed to send message to agent ${agentId} socket:`, err);
            }
          });
          agent.syncState();
        }

        switch (type) {
          case 'world_state':
            if (!agent) {
              agent = new AgentLoop({
                agentId,
                cycleMs: storedCycleMs ?? 2000,
                sendToFrontend: (msg) => {
                  try {
                    socket.send(JSON.stringify(msg));
                  } catch (err) {
                    console.error(`[Coordinator] Failed to send message to agent ${agentId} socket:`, err);
                  }
                },
                supabaseUrl,
                supabaseKey
              });
              if (kaggleEndpoint) agent.setEndpoint(kaggleEndpoint);
              // Apply stored provider config (e.g. Gemini, OpenRouter) if the user connected before the world loaded
              if (storedProviderConfig) {
                agent.setProvider(storedProviderConfig.type, storedProviderConfig.endpoint, storedProviderConfig.apiKey, storedProviderConfig.model);
                console.log(`[Coordinator] Applied stored provider config to new agent ${agentId}: ${storedProviderConfig.type}`);
              }
              agent.start();
              agents.set(agentId, agent);
            }
            if (agent) agent.updateWorldState(data);
            break;

          case 'inject_thought':
            const queue = injectionQueue.enqueue(data.text, agentId);
            // Echo queue state immediately so the frontend badge updates right away
            socket.send(JSON.stringify({ type: 'injection_queue_update', data: { queue, agentId } }));
            console.log(`inject_thought queued for ${agentId}: "${data.text}" (queue size: ${queue.length})`);
            break;

          case 'outcome':
            if (agent) agent.handleOutcome(data);
            break;

          case 'action_feedback':
            if (agent && data.rejections?.length) {
              agent.recordActionFeedback(data.rejections);
            }
            break;

          case 'set_endpoint':
            console.log(`Received set_endpoint from frontend: ${data.url}`);
            kaggleEndpoint = data.url;
            // Apply to ALL registered agents (message has no agentId)
            agents.forEach(a => a.setEndpoint(data.url));
            break;

          case 'set_provider':
            console.log(`Received set_provider from frontend: type=${data.type}, endpoint=${data.endpoint}, model=${data.model}`);
            storedProviderConfig = { type: data.type, endpoint: data.endpoint, apiKey: data.apiKey, model: data.model };
            agents.forEach(a => a.setProvider(data.type, data.endpoint, data.apiKey, data.model));
            break;

          case 'set_supabase':
            supabaseUrl = data.url;
            supabaseKey = data.key;
            setupSupabasePing(supabaseUrl, supabaseKey);
            // Apply to ALL registered agents (message has no agentId)
            agents.forEach(a => a.updateSupabase(supabaseUrl, supabaseKey));
            break;

          case 'set_directive':
            if (agent) agent.setDirective(data.mode, data.goal);
            break;

          case 'set_cycle_ms': {
            const { cycleMs } = data;
            if (typeof cycleMs === 'number' && cycleMs >= 500 && cycleMs <= 10000) {
              const cycleAgent = agents.get(agentId);
              if (cycleAgent) cycleAgent.setCycleMs(cycleMs);
              storedCycleMs = cycleMs;
            }
            break;
          }

          case 'export_request':
            if (supabaseUrl && supabaseKey) {
              const exporter = new DatasetExporter(supabaseUrl, supabaseKey);
              const exportConfig = data;
              exporter.export(exportConfig, (percent, rows) => {
                socket.send(JSON.stringify({ type: 'export_progress', data: { percent, rows, exportType: exportConfig.exportType } }));
              }).then((result) => {
                socket.send(JSON.stringify({ type: 'export_complete', data: { ...result, agentId, exportType: exportConfig.exportType } }));
              }).catch((err) => {
                socket.send(JSON.stringify({ type: 'error', data: { code: 'EXPORT_FAILED', message: err.message } }));
              });
            }
            break;

          case 'fetch_sessions':
            if (supabaseUrl && supabaseKey) {
              try {
                const { createClient } = await import('@supabase/supabase-js');
                const sb = createClient(supabaseUrl, supabaseKey);
                const targetAgentId = data.agentId || 'agent_a';
                const { data: sessions, error } = await sb
                  .from('sessions')
                  .select('id, started_at, ended_at, total_heartbeats, body_type, memory_count, estimated_size_bytes')
                  .eq('agent_id', targetAgentId)
                  .order('started_at', { ascending: false });
                if (error) throw error;
                socket.send(JSON.stringify({ type: 'sessions_data', data: { sessions: sessions || [], agentId: targetAgentId } }));
              } catch (err: any) {
                socket.send(JSON.stringify({ type: 'error', data: { code: 'FETCH_SESSIONS_FAILED', message: err.message } }));
              }
            }
            break;

          default:
            console.warn(`server: unrecognized message type '${type}' from client`);
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    console.log('Client connected');

    socket.on('close', () => {
      console.log('Client disconnected');
      agents.forEach((agent, agentId) => {
        // Stop the agent loop if client disconnects to properly close the session
        agent.stop();
        agents.delete(agentId);
      });
    });
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    console.log('Coordinator server running at http://localhost:3001');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
