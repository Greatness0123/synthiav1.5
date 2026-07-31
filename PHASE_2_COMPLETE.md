# PHASE 2: Client-Side Multi-Agent Architecture — Complete

## Overview
Phase 2 completes the client-side refactoring of SYNTHIA, porting all active agent coordination loops, payload builders, and direct Supabase database reads/writes with local mock fallbacks directly into the client browser. Multiple autonomous agents are capable of standing, perceiving, thinking, and acting independently in a shared, prefix-isolated MuJoCo simulation environment.

---

## 1. Multi-Agent MJCF Prefixing & Spacing
- **Prefix Scheme**: Prefix is formatted as `agent_${id}_` (e.g. `agent_0_`, `agent_1_`, etc.).
- **Prefix Scope**: Prefixes are applied on body names, freejoints, rigid bones, geoms, hinges, and actuator targets (e.g. `<body name="agent_0_root_capsule">`, `<joint name="agent_0_mixamorigspine_pitch" ...>`, and `<position name="act_agent_0_mixamorigspine_pitch" ...>`).
- **Collisions Prevention**: Prefixes completely guarantee that joints, bodies, and actuators of one agent never collide with those of other agents, preventing any cross-agent AI command bleed.
- **Backwards Compatibility**: When no agent id is provided, the system falls back to empty prefixes (`""`), ensuring all legacy single-agent tests continue compiled exactly as before.
- **Spawn Positioning Offset**:
  - The first spawned agent (`agent_0`) is placed directly at the world origin `(0, 0, 0)`.
  - Every subsequent agent is spawned on a deterministic spacing of **`2.0` meters** apart along the X-axis (e.g. agent 1 at `(2.0, 0, 0)`, agent 2 at `(4.0, 0, 0)`). This establishes enough space to prevent initial body overlap and physical explosion.

---

## 2. Client-Side Agent Loop & Scoped Memory
- **Inference & Streaming**: Each agent runs an independent asynchronous loop (`setInterval`-driven on `cycleMs` cadence). It fetches Phase 1's serverless edge proxy endpoints, streams thought tokens in real-time, and parses action JSON outputs. Slow or stalled calls do not block other agents.
- **Direct Supabase Integration**: Writes/reads memories and saves skills directly from the browser using standard `@supabase/supabase-js` Rest client parameters, query-scoped by the unique `agent_id` of each agent to ensure complete database namespace isolation.
- **In-Memory Mock Fallback**: When no Supabase keys are configured, the systems fall back to an in-memory memory manager and program store with a deterministic local 384-dimensional text embedder.

---

## 3. UI Multi-Agent Integration
- **Spawning Trigger**: Added a floating "+" button in the left tool belt, which calls the global handler `window.spawnAgent()`. Spawns additional agents dynamically at runtime.
- **Active Agent Selector**: Added a custom dropdown in the Agent Details Panel header allowing developers and users to toggle the active agent view and inspect thoughts, memories, and logs of individual agents in real-time.

---

## Instructions for Phase 3 to Begin
Phase 3 will focus on **Camera, Controls, and UI Expansion**.
1. **Dynamic Visual Focus**: Bind the three.js chase/first-person cameras to track whichever agent is selected as the `activeAgentId` in `useAgentStore`.
2. **First-Person View PiPs**: Create independent floating Picture-in-Picture visual panels rendering the first-person perception canvas for each active agent concurrently.
3. **Interactive Possession**: Allow the user to possess a selected agent and manually drive its joints/push its body via keyboard inputs while other agents continue their independent AI loops.
