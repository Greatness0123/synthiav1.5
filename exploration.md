# SYNTHIA: AI Embodiment Platform — Codebase Overview (v0.1.0)

## Summary

SYNTHIA is a research platform for developing and training embodied AI agents within a high-fidelity 3D physical environment. It bridges Large Language Models (LLMs) and physical action through a real-time cognitive loop: the AI perceives the 3D world via egocentric camera frames, joint proprioception, audio, and tactile force sensing; it reasons and produces action commands (joint rotations, motor programs, gaze targets); and those commands are executed in a physics-simulated body using either kinematic lerping or multi-body PD motor control. The platform supports multiple inference providers (Kaggle GPU, Gemini, Groq, OpenRouter, NVIDIA NIM), stores memories/experiences in Supabase, and provides a full God Mode UI for debugging physics, spawning objects, and controlling the cognitive loop.

## Architecture

The system is split into two runtime processes that communicate over WebSocket:

```
┌───────────────────────────────────────────────────┐
│  Machine B (Frontend) — Vite/React + Three.js     │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │  Stores   │  │  Physics    │  │  Coordinator  │ │
│  │ (Zustand) │◄─┤  Engine     │  │  Context      │ │
│  │           │  │ (Rapier)    │  │  (WebSocket)  │ │
│  │ worldStore│  │  WorldEngine │  │               │ │
│  │ agentStore│  │  CameraMgr  │  │  sendMessage()│ │
│  │ connStore │  │  AudioEngine│  │  handleAction │ │
│  │ uiStore   │  │  ObjectMgr  │  └──────────────┘ │
│  │ logStore  │  │  Humanoid   │         │          │
│  └──────────┘  │  Binder      │         │ WebSocket│
│                 └─────────────┘         ▼          │
│                                          ┌────────┐│
│  UI: AppShell, WorldViewport,            │Coord.  ││
│  GodModePanel, ThoughtBank, etc.         │Provider││
│                                          └────────┘│
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket (ws://localhost:3001/ws)
┌──────────────────────▼──────────────────────────────┐
│  Machine A (Coordinator) — Node.js/Fastify           │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │
│  │  server.ts  │  │ AgentLoop  │  │MemoryManager  │ │
│  │  (Fastify + │──┤ (per-agent │──┤(Supabase CRUD)│ │
│  │  WebSocket) │  │  2s cycle) │  │Supabase/InMem │ │
│  └────────────┘  │            │  └───────────────┘ │
│                  │PayloadBldr │  ┌───────────────┐ │
│                  │InferenceCli│──│ Inference     │ │
│                  │MotorProgSt │  │ Providers     │ │
│                  └────────────┘  │ (6 adapters)  │ │
│                                  └───────────────┘ │
│                    ┌──────────────────────────────┐ │
│                    │  Kaggle GPU / Gemini API /    │ │
│                    │  OpenRouter / Groq / NIM     │ │
│                    └──────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 6.0 (strict mode) |
| Frontend Runtime | Vite 8, React 18.3 |
| 3D Rendering | Three.js 0.184 (WebGL 2.0) |
| Physics | Rapier 3D 0.19.3 WASM (Rust physics engine) |
| State Management | Zustand 5 |
| Animation | Framer Motion 12 |
| Audio | Tone.js 15 (piano synthesis via Salamander samples) |
| Backend Runtime | Node.js, Fastify |
| WebSocket | @fastify/websocket |
| Database | Supabase (PostgreSQL + pgvector + Storage) |
| Embeddings | Xenova/all-MiniLM-L6-v2 (384-dim) via Transformers.js |
| CSS | Tailwind CSS 3.4 |
| Icons | Phosphor Icons React |

### Entry Points

**Frontend**: `src/main.tsx` → `App.tsx` renders `AppShell > WorldViewport` (the 3D canvas) + floating UI layer (logo, camera controls, status bar, God Mode panel, right agent panel).

**Backend**: `coordinator/src/server.ts` → starts Fastify on port 3001 with WebSocket at `/ws`. Accepts world_state, inject_thought, set_provider, etc. Manages one `AgentLoop` per agentId.

## Directory Structure

```
synthia/
├── coordinator/                    # Backend cognitive loop (Machine A)
│   ├── src/
│   │   ├── server.ts              # Fastify + WebSocket server
│   │   ├── agentLoop.ts           # Core 2s cycle: infer → parse → send → write memory
│   │   ├── payloadBuilder.ts      # Assembles InferPayload from world state + memories
│   │   ├── inferenceClient.ts     # Delegates to provider adapters
│   │   ├── memoryManager.ts       # Supabase CRUD + vector search for memories
│   │   ├── motorProgramStore.ts   # Supabase CRUD for motor programs
│   │   ├── embeddingEngine.ts     # Singleton for all-MiniLM-L6-v2 embeddings
│   │   ├── injectionQueue.ts      # Per-agent FIFO for thought injections
│   │   ├── datasetExporter.ts     # Exports memories as LeRobot/CSV/JSONL
│   │   ├── reconnectionManager.ts # Exponential backoff retry (1.5×, max 30s)
│   │   ├── supabasePing.ts        # Keepalive ping every 3 days
│   │   └── providers/            # 6 provider adapters
│   │       ├── types.ts           # ProviderConfig, InferenceResult interfaces
│   │       ├── providerFactory.ts # Factory + default endpoints/models
│   │       ├── kaggleProvider.ts  # Direct HTTP to Python inference server
│   │       ├── geminiProvider.ts  # Google Gemini API (inlineData images)
│   │       └── openaiCompatProvider.ts  # NIM/OpenRouter/Groq/Custom OpenAI-compat APIs
│   └── PHASE3_DOCS.md
│
├── src/                           # Frontend (Machine B)
│   ├── main.tsx                   # React DOM mount, CoordinatorProvider
│   ├── App.tsx                    # Root component: layout, UI layer, camera pills
│   ├── world/                     # Core 3D world engine
│   │   ├── engine/
│   │   │   ├── WorldEngine.ts     # Three.js scene + animation loop
│   │   │   ├── PhysicsEngine.ts   # Rapier WASM wrapper (initialization, stepping, events)
│   │   │   ├── CameraManager.ts   # 3 cameras (1st/3rd/AI), TransformControls
│   │   │   ├── HumanoidPhysicsBinder.ts  # #1 largest file: capsule + bone lerping + multi-body PD
│   │   │   ├── HumanoidMultiBodyManager.ts  # Per-bone physics bodies + PD motor control
│   │   │   ├── RagdollBuilder.ts  # Per-bone ragdoll for non-humanoid body types
│   │   │   ├── ObjectManager.ts   # Spawn/despawn objects + collision events
│   │   │   ├── AudioEngine.ts     # Tone.js piano synthesis + PCM capture
│   │   │   ├── AvatarSynchronizer.ts  # Copies RigidBody transforms → skeleton bones
│   │   │   ├── RapierJointMotorController.ts  # PD motor controller for revolute joints
│   │   │   ├── ObservationBuilder.ts  # Local-frame state vectors for AI proprioception
│   │   │   ├── BalanceMonitor.ts  # CoM computation, fall detection
│   │   │   ├── BreakSignalEvaluator.ts  # String condition evaluation for motor phases
│   │   │   ├── MotorProgramExecutor.ts  # Timed motor program execution
│   │   │   ├── PDController.ts    # Proportional-Derivative torque utility
│   │   │   ├── StablePhysicsEngine.ts  # Alternative more stable physics
│   │   │   └── __tests__/rigValidation.test.ts
│   │   ├── contexts/
│   │   │   └── CoordinatorContext.tsx  # WebSocket hub: sendMessage + dispatch actions
│   │   └── hooks/
│   │       └── useWorld.ts        # React hook: initialize, animate, handle actions
│   ├── components/
│   │   ├── world/WorldViewport.tsx  # 3D viewport container + cycle interval
│   │   ├── godmode/               # God Mode panel (PhysicsControls, BodyControls, etc.)
│   │   ├── agent/                 # Right panel (ThoughtBank, MemoryViewer, Logs)
│   │   └── ui/                    # Reusable UI (Button, Slider, Toast, RehydrationModal)
│   ├── store/
│   │   ├── worldStore.ts          # Physics/body/scene state (persisted to localStorage)
│   │   ├── agentStore.ts          # Agent thoughts/memories/goals
│   │   ├── connectionStore.ts     # WebSocket + provider config (persisted)
│   │   ├── uiStore.ts             # UI state (panels, tabs, theme)
│   │   └── logStore.ts            # In-memory log entries
│   ├── constants/
│   │   ├── anatomicalLimits.ts    # Human ROM limits, velocity safety bounds
│   │   ├── rigConstraints.ts      # Per-bone rotational constraints (min/max per axis)
│   │   ├── bodyTypes.ts           # Ragdoll joint hierarchy configs
│   │   ├── physics.ts             # Collision groups, masks
│   │   ├── objectPresets.ts       # Spawnable object physics properties
│   │   ├── progressionLadder.ts   # AI skill progression rungs
│   │   └── strings.ts             # UI strings
│   └── types/
│       ├── world.ts               # CameraMode, BodyType, WorldObject
│       ├── agent.ts               # Thought, Memory, AgentStatus
│       ├── joint.ts               # TimelineSequence, ValidateResult, clampAngle
│       └── payload.ts             # Mirrors coordinator types
│
├── public/models/x-bot.glb       # Mixamo-rigged humanoid model
├── model data/                    # Static + sequenced motor program JSON files
├── scripts/sync-types.mjs        # Type sync script
├── by_jules/                      # External architecture analysis documents
│
├── recorder001-004.mp4           # Demo recordings
├── kaggle_server.py              # Python inference server for Qwen2.5-VL
├── supabase_schema.sql            # Database schema
└── SYNTHIA_README.md             # Project overview
```

## Key Abstractions

### 1. `WorldEngine` (src/world/engine/WorldEngine.ts)
- **File**: `src/world/engine/WorldEngine.ts` (line 16)
- **Responsibility**: Owns the Three.js scene, renderer, and main animation loop. Orchestrates physics stepping, camera updates, AI frame capture, and rendering each frame.
- **Interface**: `start(onStep?)` — begins requestAnimationFrame loop; `getLastAIFrame()` — returns latest 448×448 WebP base64; `getCameraManager()`, `getScene()`, `getRenderer()`
- **Lifecycle**: Created by `useWorld` hook on mount. `start()` called after init. `stop()` on unmount.
- **Key detail**: The animation loop uses a fixed timestep accumulator (1/60s) capped at 0.25s to prevent physics spiral-of-death. On `false→true` ready transition, it resets the accumulator to avoid burst-stepping.
- **Used by**: `useWorld` hook

### 2. `PhysicsEngine` (src/world/engine/PhysicsEngine.ts)
- **File**: `src/world/engine/PhysicsEngine.ts` (line 27)
- **Responsibility**: Rapier WASM wrapper — creates world with gravity (-9.81), static ground plane, EventQueue. Provides guarded `step()` with mutation lock, contact force event draining, velocity clamping, and recovery from broken WASM state.
- **Interface**: `init()` → creates Rapier world; `step()` — single physics tick; `registerVelocityClampBody()` — register bodies for speed limiting; `getContactForceRegistry()` — per-collider contact state map; `flushEventQueue()`, `setMutating()`, `setReady()`
- **Key detail**: Has a three-layer safety system: `isStepping` (re-entrancy guard), `isMutatingWorld` (mutation lock that drops physics frames), and `isPhysicsBroken` (catastrophic failure recovery). Contact force events are drained automatically after each step into a registry map. Velocity clamping is post-step: caps at `MAX_LINEAR_VELOCITY=8` and `MAX_ANGULAR_VELOCITY=12`.
- **Used by**: `WorldEngine`, `HumanoidPhysicsBinder`, `RagdollBuilder`, `ObjectManager`

### 3. `HumanoidPhysicsBinder` (src/world/engine/HumanoidPhysicsBinder.ts)
- **File**: `src/world/engine/HumanoidPhysicsBinder.ts` (line 29) — ~2700 lines, the largest file in the frontend
- **Responsibility**: The central humanoid controller. Manages a single dynamic capsule rigid body (60fps physics) plus per-bone kinematic or PD motor control for 15+ Mixamo skeleton bones. Handles the 4-step build process (A: load model → B: create capsule → C: no-op → D: activate) and then provides continuous joint targeting / sync.
- **Interface**: `loadAndVisualizeBindPose()` — Step A; `createRigidBodiesAndColliders()` — Step B; `activateMultiBody()` — delegates to HumanoidMultiBodyManager; `setMotorTargets()` — accepts {joint: value} with anatomical limit validation, returns {applied, rejected}; `updateMotorTargets()` — per-frame lerp or multi-body PD; `syncVisuals()` — moves modelRoot to follow capsule, dynamic raycast grounding, K-GRF, hip-drop alignment; `executeProgramSequence()` — stand/jump/crouch programs; `resetPose()` — full reset; `validateAndApplyTimeline()` — timeline sequence validation
- **Lifecycle**: Built via `useWorld` useEffect when bodyType='humanoid'. Steps A→D executed sequentially. Multi-body PD activated on-demand.
- **Key detail**: Has a **joint alias system** in `resolveJointAlias()` that maps human-readable names like "neck_yaw" to Mixamo bone names. Has an **ephemeral target cache** that prevents per-frame bone slerp oscillation via `settledBones` set — once a bone reaches within 1e-4 rad of its target, it's skipped until the target changes. Has **dynamic raycast grounding** that fires a Rapier ray downward from capsule center each frame to find the true ground surface (handles slopes, objects). Has **exponential weariness decay** that applies a downward velocity magnet when both feet are airborne >500ms.
- **Used by**: `useWorld` hook (primary), debug console

### 4. `HumanoidMultiBodyManager` (src/world/engine/HumanoidMultiBodyManager.ts)
- **File**: `src/world/engine/HumanoidMultiBodyManager.ts` (line 1)
- **Responsibility**: Creates per-bone Rapier rigid bodies for 15 major Mixamo bones, connects them with impulse joints (revolute for 1-DOF elbows/knees, spherical for multi-DOF shoulders/hips/spine), and provides PD motor control. When active, `HumanoidPhysicsBinder` delegates `updateMotorTargets()` and `syncVisuals()` to it.
- **Interface**: `activate()` — builds bodies + joints; `setTargets()` — applies PD targets from currentTargets map; `syncVisuals()` — copies RigidBody transforms → skeleton via AvatarSynchronizer; `setLimpMode()` — zero effective stiffness for ragdoll; `syncRigidBodiesFromBones()` — snap RigidBodies to match bone quaternions after reset
- **Lifecycle**: Created by `HumanoidPhysicsBinder.activateMultiBody()`. Topological sort ensures parent bones are created before children. Soft-start ramps gains from 10% to 100% over 15 frames. After teleport, holds gains at 10% for 8 settle frames.
- **Key detail**: Spherical joints (shoulders, hips, spine) get **manual quaternion-based PD torque** because Rapier v0.19 SphericalImpulseJoint lacks motor support. The PD equation is axis-angle: τ = Kp * (axis * angle) - Kd * ω_local. Shortest-path correction ensures the joint rotates the minimum distance. Has a **capsule upright spring** (balance controller) that applies restoring torque to keep the capsule vertical.
- **Used by**: `HumanoidPhysicsBinder`

### 5. `AgentLoop` (coordinator/src/agentLoop.ts)
- **File**: `coordinator/src/agentLoop.ts` (line 1)
- **Responsibility**: The cognitive loop for one AI agent. Runs on a configurable interval (default 2000ms). Each cycle: dequeue injection → build payload → infer → parse action → send to frontend → wait for outcome (5s timeout) → write memory to Supabase.
- **Interface**: `start()` — begins interval + sends rehydration tokens; `updateWorldState()` — stores latest state; `setProvider()` — configures inference provider; `handleOutcome()` — finalizes pending cycle with outcome; `setCycleMs()` — dynamic interval adjustment
- **Key detail**: Has a `pendingCycles` map with 5-second timeout. If the frontend doesn't send an outcome within 5s, it finalizes with 'timeout' outcome. The `parseAndValidateAction()` method handles 3+ JSON schemas (legacy single-frame, new timeline with `sequence`, nested motor_sequence) plus auto-degrees-to-radians conversion for values > PI+0.1. Gaze targets are converted to mixamorighead joint overrides.
- **Used by**: `server.ts`

### 6. `PayloadBuilder` (coordinator/src/payloadBuilder.ts)
- **File**: `coordinator/src/payloadBuilder.ts` (line 1)
- **Responsibility**: Assembles the 22-field `InferPayload` sent to the LLM each cycle. Combines world state, memories (top 5 by vector similarity + last 3 recent), motor program library, mastered skills, tactile context, gaze context, and perception summary into a single structured object.
- **Key detail**: `buildPerceptionSummary()` generates a multi-paragraph spatial grounding text that tells the AI its body state (standing/fallen), head orientation (cardinal direction), nearby objects within 5m, contact force analysis, and **detailed locomotion physics instructions** — including concrete joint override examples for forward steps, turns, and jumps. The "anti-stuck" guidance rotates the head when facing a blank surface. Contact forces are converted to qualitative labels ("light touch", "moderate force", "firm contact", "strong ground support").
- **Used by**: `AgentLoop`

### 7. `CoordinatorContext` (src/world/contexts/CoordinatorContext.tsx)
- **File**: `src/world/contexts/CoordinatorContext.tsx` (line 1)
- **Responsibility**: React context provider that manages the WebSocket connection to the coordinator. Handles reconnection with 3-second delay, auto-sends provider config on (re)connect, dispatches incoming messages to the correct state stores and DOM events.
- **Interface**: `sendMessage(type, data)` — sends JSON over WebSocket; `onMessage(listener)` — subscribe to raw messages
- **Key detail**: On connection/reconnection, automatically sends `set_provider`, `set_cycle_ms`, and `set_supabase` messages to the coordinator. Supports `normalizeWebSocketUrl()` that converts http→ws and https→wss. Handles 13 message types from the coordinator including action, thought_token, rehydration, skill_mastered, memory_saved, export_progress, and error.
- **Used by**: `App.tsx` (wraps entire app), `useWorld` hook

### 8. `MemoryManager` (coordinator/src/memoryManager.ts)
- **File**: `coordinator/src/memoryManager.ts` (line 1)
- **Responsibility**: Supabase CRUD for memories with vector similarity search via pgvector. Manages sessions, auto-creates them on first write, tracks memory_count and estimated_size_bytes per session. Falls back to in-memory mock store when Supabase isn't configured.
- **Interface**: `write()` — inserts memory with 384-dim embedding; `retrieveRelevant()` — RPC call to `match_memories` pgvector function; `retrieveRecent()` — last N by heartbeat; `pruneOld()` — deletes tier-3 memories from old sessions; `uploadFrame()` — uploads WebP frame to Supabase Storage
- **Used by**: `AgentLoop`, `PayloadBuilder`

### 9. `useWorld` (src/world/hooks/useWorld.ts)
- **File**: `src/world/hooks/useWorld.ts` (line 1)
- **Responsibility**: React hook that initializes the entire 3D world. Creates PhysicsEngine, AudioEngine, WorldEngine, ObjectManager, HumanoidPhysicsBinder, and manages the build lifecycle. Handles all custom DOM events (spawn, action, resetPose, rootMotion, push, rename, delete). Provides `captureWorldState()` and `detectOutcomes()` for the cycle interval.
- **Key detail**: The `captureWorldState()` function builds the full world state including frame (448×448 WebP base64), joints, proprioception (local-frame state vectors from ObservationBuilder), audio PCM, contact forces, object list, upright preset, grounded status, heartbeat, and more. The `detectOutcomes()` function collects pending outcomes from ObjectManager collision events (piano notes, button presses) and fall detection.
- **Used by**: `WorldViewport`

## Data Flow — Complete Cognitive Cycle

1. **WorldViewport interval** (default 2s) calls `captureWorldState()` and `detectOutcomes()`
2. `captureWorldState()` reads latest 448×448 WebP AI frame from `WorldEngine.getLastAIFrame()`, builds joints state, gathers audio PCM, contact forces, object list, proprioception
3. **Frontend sends** `world_state` via WebSocket to the Coordinator
4. **Server** routes to `AgentLoop.updateWorldState()` (creates AgentLoop on first world_state)
5. **AgentLoop.cycle()** triggers:
   - Dequeue injection from `injectionQueue`
   - `PayloadBuilder.build()` assembles 22-field InferPayload (frame, audio, joints, memories, contact forces, perception summary, etc.)
   - `InferenceClient.infer()` → provider adapter streams response
6. **Provider** (Kaggle/Gemini/OpenRouter/etc.) sends streaming response in format: `<thought tokens>---ACTION---<JSON>`
7. **AgentLoop** streams thought tokens to frontend (`thought_token` messages), then parses action JSON
8. **Coordinator sends** `action` message with joint_overrides, program_sequence, timeline sequence, gaze_target
9. **CoordinatorContext** dispatches `CustomEvent('synthia:action')` on the window
10. **useWorld** handler calls `HumanoidPhysicsBinder.validateAndApplyTimeline()` → `setMotorTargets()`
11. **Each animation frame** (60fps): `updateMotorTargets()` lerps bones toward targets (kinematic) or delegates to multi-body PD control
12. **Next cycle**: frontend sends outcome (success/failure/reward), AgentLoop finalizes the cycle, writes memory to Supabase, broadcasts `memory_saved`

## WebSocket Protocol — Complete Message Map

### Frontend → Coordinator (9 types)

| Type | Data Fields | Trigger |
|------|-------------|---------|
| `world_state` | frame, joints, audio_pcm, contact_forces, lightState, heartbeat, agentId, objects, uprightPreset, isGrounded, proprioception | WorldViewport cycle interval |
| `outcome` | success, reward, description, agentId | Physics fall detection / object interactions |
| `inject_thought` | text, agentId | User types in InjectionInput |
| `set_directive` | mode, goal, agentId | DirectivePanel toggle/button |
| `set_endpoint` | url | Legacy — sets Kaggle endpoint |
| `set_provider` | type, endpoint, apiKey, model | ConnectionPanel connect (all providers) |
| `set_supabase` | url, key | ConnectionPanel connect |
| `export_request` | ExportConfig object | ExportModal start button |
| `action_feedback` | agentId, rejections[], clamping[], injections[] | Joint validation failure in useWorld |

### Coordinator → Frontend (15 types)

| Type | Data Fields | Trigger |
|------|-------------|---------|
| `action` | programSequence, jointOverrides, sequence, gazeTarget, agentId | Successful inference |
| `thought_token` | token, agentId | Streaming inference |
| `thought_complete` | agentId | All tokens received |
| `heartbeat_sync` | heartbeat, agentId | Initial state sync on connect |
| `rehydration_token` | token, agentId | AgentLoop.start() boot sequence |
| `rehydration_complete` | agentId | Boot sequence finished |
| `skill_mastered` | skillName, agentId | AI declares skill mastered |
| `connection_status` | status, rtt, inferenceTime, agentId | Inference result / reconnection |
| `injection_queue_update` | queue, agentId | Injection enqueued / dequeued |
| `injection_consumed` | (none) | Dead code — never sent |
| `memory_saved` | memoryId, tier, agentId | Successful Supabase write |
| `export_progress` | percent, rows, exportType | Dataset export progress |
| `export_complete` | filename, rows, sizeBytes, agentId, exportType | Export zip written |
| `error` | code, message, agentId | Various failure paths |
| `sessions_data` | sessions[], agentId | Response to fetch_sessions |

## Non-Obvious Behaviors & Design Decisions

### 1. Dual Physics Modes: Kinematic vs Multi-Body PD

The system has **two completely different humanoid control modes** that share the same interface:

- **Kinematic mode** (default): A single dynamic capsule RigidBody is the only physics object. Bones are moved by lerping their local quaternions each frame toward the target. "Ground" is found via a Rapier raycast from capsule center downward. Locomotion uses **K-GRF (Kinematic Ground Reaction Forces)** — foot position deltas between frames are converted into capsule impulses. This mode is simple, stable, and doesn't require per-bone physics bodies.

- **Multi-body PD mode** (`useMultiBodyPD=true`): Creates 15 separate RigidBodies (one per major bone) connected by impulse joints (revolute for elbows/knees, spherical for shoulders/hips/spine). PD motors apply torque to reach target angles. The capsule body becomes the root with an **upright spring** (balance controller). Spherical joints use **manual quaternion-based PD torque** because Rapier v0.19 doesn't support spherical joint motors. This mode is more physically realistic and allows limb-ground collisions, but is harder to tune and less stable.

**Why both?** The kinematic mode works well for stable locomotion and is easier to debug. The multi-body mode provides genuine physics interaction (limbs collide with objects, can push against walls) but required significant engineering to make stable. The system can switch between them at runtime via `activateMultiBody()` / `deactivateMultiBody()`.

### 2. The `settledBones` Cache (Anti-Oscillation)

`HumanoidPhysicsBinder` keeps a `settledBones: Set<string>` cache. When a bone's current quaternion is within `LERP_SNAP_EPSILON` (1e-4 rad ≈ 0.006°) of the target, the bone is marked as "settled" and subsequent frames **skip the lerp entirely** — until the target changes. This prevents micro-oscillation where tiny floating-point differences cause continuous slerping that fights against any competing physics/AvatarSynchronizer writes. Without this, bones would jitter permanently even when "at rest" because the lerp would never exactly reach the target.

### 3. Gaze → Head Bone Conversion

AI gaze targets (`gaze_target: { yaw, pitch }`) are **not** forwarded to a camera offset system. Instead, `agentLoop.ts` converts them into `mixamorighead` joint overrides: `[pitch, yaw, 0]` in XYZ Euler order. This means gaze control goes through the same joint validation pipeline (anatomical limits, clamping, timeline interpolation) as any other movement. The head bone has ±0.79 rad (45°) limits on both axes. The first-person camera is attached to the head bone via `CameraManager.update()` with a 0.50m forward offset.

**Why this way?** Keeps the action schema simpler (one less special field) and ensures gaze is subject to the same anatomical constraints as any other joint. The old approach of separate gaze offset in CameraManager was removed because it created a race condition when both head rotation and gaze offset were sent simultaneously.

### 4. Exponential Weariness & Grounding Magnet

When both feet are airborne for >500ms without an explicit AI command, the system applies an exponential downward velocity magnet:
```
groundingMagnetStrength = 1.0 - exp(-0.5 * airborneTimer)
magnetVelocity = -2.0 * groundingMagnetStrength
```
This pulls the capsule down gently, preventing the character from floating in the air after a jump or fall. The magnet strength decays exponentially, so it starts weak and ramps up. AI commands reset both `airborneTimer` and `lastAiCommandTime` (500ms grace window), giving intentional actions time to resolve.

### 5. Timeline Interpolation (Jules Bug 3.2 Fix)

The AI can send a `sequence` array of frames with `timeOffsetMs` values. Instead of snapping to the latest frame, the `syncVisuals()` method finds the two frames bracketing the current elapsed time and **LERP/SLERPS between them** for smooth visual transitions. Each frame's overrides are interpolated independently (scalars lerp, Euler triples lerp per-axis, quaternions slerp). Frames older than `elapsed - 50ms` are removed from the queue. This gives the appearance of continuous motion even at 2s cycle intervals.

### 6. Mutation Lock Drops Physics Frames

`PhysicsEngine.setMutating(true)` sets `isReady = false`, which causes **all physics steps to be skipped**. This is intentional: when adding/removing RigidBodies, Rapier's WASM memory can alias if the step loop runs concurrently. The mutation lock is also a `isMutatingWorld` flag that the step loop checks before proceeding. During mutations (model loading, ragdoll building, object spawning), physics freezes. The accumulator in WorldEngine ensures that after the mutating period ends, there's no burst of catch-up physics steps (accumulator is reset to 0 on the `false→true` transition).

### 7. Contact Force Sensing is Capsule-Only

Only the main capsule collider has `CONTACT_FORCE_EVENTS` enabled by default. In multi-body mode, individual limb colliders also have force events enabled (via `HumanoidMultiBodyManager`). The `buildTactileContext()` method converts raw impulses (N·s) to qualitative labels: <1 = "light touch", 1-5 = "moderate force", 5-20 = "firm contact", >20 = "strong ground support". The normal direction determines what's being touched (ny > 0.7 = floor, ny < -0.7 = ceiling, else = object).

### 8. Action JSON Parser Handles 3+ Schemas

`parseAndValidateAction()` in agentLoop.ts handles multiple schema variants:
1. **Legacy**: `{ actions: { program_sequence: [...], joint_overrides: {...} }, memory_write: {...} }`
2. **Timeline**: `{ sequence: [{ timeOffsetMs, overrides }], actions: { program_sequence: [...] } }`
3. **Nested array**: `{ actions: [{ program_name, joint_overrides }] }` — normalized into program_sequence + merged joint_overrides
4. **Motor_sequence**: `{ actions: { motor_sequence: [{ joint, rotation }] } }` — converted

All values > PI+0.1 radians are auto-converted from degrees. Gaze targets are merged into joint_overrides. The parser tolerates Markdown fences (` ```json `).

### 9. Auto-Reset on World Boundary

When the humanoid's capsule position exceeds `WORLD_BOUNDARY_RADIUS=50` units from origin, or the Y position exceeds 50 units, `useWorld` detects this via `humanoidBinder.isOutOfWorldBounds()` and accumulates a counter. After 5 consecutive frames out of bounds, it auto-resets to the spawn point. This prevents the character from falling forever or walking to infinity.

### 10. Provider API Key Security

API keys for non-Kaggle providers (Gemini, NIM, OpenRouter, Groq, Custom) are stored in **sessionStorage only** — they live in memory for the tab session and are deleted on tab close. The `connectionStore` persist middleware explicitly excludes `providerApiKey` from the partialize function. However, the key is sent over WebSocket to the coordinator, which stores it in memory for the duration of the connection.

### 11. Resolver Chain for Joint Aliases

`resolveJointAlias()` maps ~30 human-readable joint names to Mixamo bone names. Examples: `neck_yaw → mixamorighead`, `right_shoulder_pitch → mixamorigrightarm`, `left_knee_flex → mixamorigleftleg`. This is the critical bridge between the AI's semantic understanding and the actual bone hierarchy. The aliases are not bidirectional — AI output uses canonical names like `mixamorigrightarm`, but the alias system allows user-friendly names as well.

### 12. Procedural Humanoid Path

There's a third humanoid implementation path — the **procedural model** (`useProcedural=true`), built by `ProceduralHumanoidBuilder` with `ProceduralMotorController`. This path uses procedural geometry instead of the GLB model and was intended for scenarios where the pre-built x-bot.glb isn't suitable. It's controlled by the `bodyMode === 'ragdoll'` toggle: switching to ragdoll mode triggers `setUseProcedural(true)`. This path is less mature and may have partial functionality.

## State Management

| Store | Location | Persistence | Key State |
|-------|----------|-------------|-----------|
| `worldStore` | `src/store/worldStore.ts` | localStorage | gravity, friction, bodyType, bodyMode, cameraMode, spawnPoint, showFloor, color, grid, AI helpers, movementSmoothing, multiBodyPD flag, objects |
| `agentStore` | `src/store/agentStore.ts` | None | thoughts[], memories[], heartbeat, currentGoal, directiveMode, injectionQueue, masteredSkills, currentThought, rehydration state |
| `connectionStore` | `src/store/connectionStore.ts` | localStorage (partial) | endpoint, supabase config, provider type/model, cycleMs (API key excluded from persistence) |
| `uiStore` | `src/store/uiStore.ts` | None | rightPanelOpen, activeTab, theme, selectedEntityId, exportProgress |
| `logStore` | `src/store/logStore.ts` | None | in-memory log entries[] |

## Performance-Sensitive Paths

1. **AI frame capture**: `captureAIFrame()` renders the scene to a 448×448 WebGLRenderTarget and reads pixels → WebP base64. This happens every animation frame (60fps) but the PiP store update is throttled to ~200ms. The data URL prefix is stripped by payloadBuilder.

2. **Contact force draining**: `drainContactForceEventsInternal()` runs every physics step (60fps) and iterates all active contacts. For multi-body mode with 15 limbs, this could be 15+ pairs per frame. The event queue is drained in a try/catch with silent failure.

3. **Bone iteration in syncVisuals()**: Each frame, `syncVisuals()` iterates all 15+ tracked bones to sync physics → visuals. In multi-body mode, this also includes the AvatarSynchronizer's per-bone matrix computations.

4. **WebSocket payload size**: The `world_state` message includes a ~50-100KB WebP frame (base64), ~2KB joint state, ~2KB memories, plus text fields. At 2s intervals and ~60KB/message, this is roughly 30KB/s upload. WebP saved ~25-30% vs JPEG.

## Potential Failure Modes

1. **WASM memory corruption**: Physics engine can enter `isPhysicsBroken` state if Rapier encounters a fatal WASM memory issue. The system sets `isPhysicsBroken = true` and `isReady = false`, freezing all physics until re-enabled.

2. **Empty action loop**: If the AI returns empty actions repeatedly (no jointOverrides, no programSequence, no sequence), the frontend shows a toast warning but still forwards the empty action — which wastes a cycle.

3. **Time-synced timeline gaps**: If the AI sends a timeline with frames spaced farther apart than the cycle interval (e.g., frames at 0ms and 5000ms with 2000ms cycle), the animation will complete the first frame, then hold until the next inference arrives.

4. **API key exposure over WebSocket**: The API key is sent in plain text over the WebSocket to the coordinator. If the coordinator runs on an untrusted network, keys could be intercepted. The key is in memory only on both sides.

5. **Supabase frame overflow**: Each memory write uploads a ~50KB WebP frame to Supabase Storage. At 2s cycles, this is ~2.1GB/hour. The `pruneOld()` method deletes old tier-3 memories, but frame storage is not pruned — only the database rows are deleted.

6. **Rapier v0.19 spherical joint motor gap**: Rapier v0.19's SphericalImpulseJoint does not support `configureMotorPosition()`. The multi-body manager implements manual PD torque for these joints, which is less stable than Rapier's built-in motor.

## Module Reference

### Frontend Core

| File | Purpose |
|------|---------|
| `src/world/engine/WorldEngine.ts` | Three.js scene + animation loop with fixed timestep physics |
| `src/world/engine/PhysicsEngine.ts` | Rapier WASM wrapper: init, step, contact events, velocity clamping |
| `src/world/engine/HumanoidPhysicsBinder.ts` | Central humanoid controller: capsule body, bone lerping, multi-body PD delegation, K-GRF, raycast grounding |
| `src/world/engine/HumanoidMultiBodyManager.ts` | Per-bone physics bodies + PD motor control with quaternion-based spherical joint torque |
| `src/world/engine/CameraManager.ts` | 3 cameras (1st/3rd/AI perspective) + TransformControls + gaze offset |
| `src/world/engine/AvatarSynchronizer.ts` | Copies RigidBody transforms → skeleton bones with lerp smoothing |
| `src/world/engine/RapierJointMotorController.ts` | PD motor controller for revolute joints (wraps Rapier configureMotorPosition) |
| `src/world/engine/ObservationBuilder.ts` | Local-frame state vectors for AI proprioception |
| `src/world/engine/ObjectManager.ts` | Spawn/despawn objects, collision event callbacks, TransformControls drag sync |
| `src/world/engine/AudioEngine.ts` | Tone.js piano synthesis + PCM buffer capture |
| `src/world/engine/RagdollBuilder.ts` | Non-humanoid per-bone ragdoll creation |
| `src/world/engine/BalanceMonitor.ts` | CoM computation + fall detection |
| `src/world/engine/BreakSignalEvaluator.ts` | String condition evaluation for motor phase transitions |
| `src/world/engine/MotorProgramExecutor.ts` | Timed motor program execution with phases |
| `src/world/engine/PDController.ts` | Stateless PD torque utility |
| `src/world/engine/StablePhysicsEngine.ts` | Alternative more stable physics implementation |
| `src/world/hooks/useWorld.ts` | React init hook: creates all engines, handles events, provides captureWorldState |
| `src/world/contexts/CoordinatorContext.tsx` | WebSocket hub: sendMessage, auto-reconnect, 13 message handlers |
| `src/constants/anatomicalLimits.ts` | Human ROM limits, velocity bounds, clamping utilities |
| `src/constants/rigConstraints.ts` | Per-bone rotation constraints per axis (min/max) |
| `src/constants/physics.ts` | Collision group definitions and masks |
| `src/store/worldStore.ts` | Physics/body/scene state with localStorage persistence |
| `src/store/agentStore.ts` | Agent thoughts/memories/goals/injection state |
| `src/store/connectionStore.ts` | WebSocket + provider config with localStorage persistence |
| `src/store/uiStore.ts` | Panel state, theme, export progress |
| `src/types/joint.ts` | TimelineSequence, ValidateResult, clampAngle, normalizeBoneKey |

### Backend Coordinator

| File | Purpose |
|------|---------|
| `coordinator/src/server.ts` | Fastify + WebSocket on port 3001, route dispatcher, agent lifecycle |
| `coordinator/src/agentLoop.ts` | Cognitive loop: inject → build payload → infer → parse → send → wait → write memory |
| `coordinator/src/payloadBuilder.ts` | 22-field InferPayload assembly with tactile/perception/gaze contexts |
| `coordinator/src/inferenceClient.ts` | Provider-agnostic inference with timeout/retry |
| `coordinator/src/memoryManager.ts` | Supabase CRUD for memories + sessions + vector search + frame upload |
| `coordinator/src/motorProgramStore.ts` | Supabase CRUD + disk fallback for motor programs |
| `coordinator/src/embeddingEngine.ts` | Singleton: lazy-loads all-MiniLM-L6-v2 for 384-dim embeddings |
| `coordinator/src/injectionQueue.ts` | Per-agent FIFO thought injection queue |
| `coordinator/src/datasetExporter.ts` | LeRobot/CSV/JSONL export pipeline |
| `coordinator/src/reconnectionManager.ts` | Exponential backoff retry handler |
| `coordinator/src/providers/providerFactory.ts` | Factory: creates provider from config type |
| `coordinator/src/providers/types.ts` | ProviderConfig, InferenceResult, InferenceProvider interfaces |
| `coordinator/src/providers/kaggleProvider.ts` | HTTP POST to Kaggle Python inference server |
| `coordinator/src/providers/geminiProvider.ts` | Google Gemini API with inlineData images |
| `coordinator/src/providers/openaiCompatProvider.ts` | OpenAI-compatible APIs (NIM, OpenRouter, Groq, Custom) |

## Suggested Reading Order

1. **`SYNTHIA_README.md`** — Project overview, quick start, system requirements
2. **`coordinator/src/server.ts`** — Entry point for the backend, shows message routing and agent lifecycle
3. **`src/world/hooks/useWorld.ts`** — Shows how all frontend engines are initialized and connected
4. **`src/world/engine/HumanoidPhysicsBinder.ts`** — The most important file: understand the capsule body, motor targeting, kinematic lerping, raycast grounding, K-GRF, and multi-body delegation
5. **`coordinator/src/agentLoop.ts`** — The cognitive cycle: how world state → inference → action → memory
6. **`coordinator/src/payloadBuilder.ts`** — What the AI actually sees each cycle (the 22-field payload with perception context)
7. **`src/world/contexts/CoordinatorContext.tsx`** — The WebSocket bridge: message types and reactive dispatches
8. **`src/world/engine/HumanoidMultiBodyManager.ts`** — Multi-body PD control architecture (quaternion PD, capsule balance spring, soft-start)
9. **`src/constants/rigConstraints.ts`** + **`src/constants/anatomicalLimits.ts`** — The constraint system that governs all AI movement
10. **`coordinator/src/memoryManager.ts`** — Supabase integration, vector search, session management
