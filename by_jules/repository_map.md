# SYNTHIA Repository Map & Architecture Audit
**Author:** Jules, Principal Systems Architect  
**Accountability Mark:** `by_jules` design series

---

## 1. System-Wide Directory Structure

The Project Synthia repository is organized as a decoupled, multi-runtime simulation platform. It bridges real-time 3D physics, real-time audio capture, a Node.js WebSocket-based cognitive loop coordinator, and a remote/local multi-modal Python inference server.

```
.
├── by_jules/                         # [NEW] Architectural & design audits
├── .agents/                          # Agent-specific guidelines and conventions
│   └── AGENTS.md                     # Codebase-specific rules (quaternion fixes, etc.)
├── coordinator/                      # Machine A: Brain Loop & Supabase Connector
│   ├── src/                          # TypeScript source for the Coordinator
│   │   ├── providers/                # Inference model provider adapters
│   │   ├── tests/                    # Unit & integration tests
│   │   ├── types/                    # Common TS types
│   │   └── ...                       # Main coordinator files
│   ├── programs/                     # Pre-authored motor programs (primitives)
│   ├── package.json                  # Coordinator dependencies & build tools
│   └── tsconfig.json                 # Coordinator TS configurations
├── public/                           # Static assets served by the Vite frontend
│   └── models/                       # 3D GLTF models (e.g., x-bot.glb)
├── scripts/                          # Build & synchronization tooling
│   └── sync-types.mjs                # Types & program schemas sync script
├── src/                              # Machine B: Three.js & Rapier3D Client Client
│   ├── assets/                       # Client assets (images, logos)
│   ├── components/                   # UI components (Zustand-wired panels)
│   ├── constants/                    # Simulation constraints and defaults
│   ├── store/                        # Frontend state stores (Zustand)
│   ├── styles/                       # Tailwind styles and CSS variables
│   ├── types/                        # Core TypeScript declarations
│   └── world/                        # World Simulation Sub-system
│       ├── contexts/                 # React Contexts (Coordinator/WS connection)
│       ├── engine/                   # Engine controllers (Three.js, Rapier)
│       ├── hooks/                    # Hooks (useWorld, useCoordinator)
│       └── programs/                 # Core client motor programs
├── package.json                      # Frontend configuration & root commands
├── tsconfig.json                     # Frontend TypeScript configuration
├── vite.config.ts                    # Vite build configuration
├── tailwind.config.js                # Tailwind CSS layout utility configuration
├── postcss.config.js                 # CSS pre-processing configurations
├── eslint.config.js                  # Frontend code-style rules
├── index.html                        # Main frontend DOM mounting entry
├── supabase_schema.sql               # Supabase database migrations and functions
└── kaggle_server.py                  # Phase 4/5 Kaggle VLM & CLAP Inference Server
```

---

## 2. Document-by-File Operational Roles & Dependencies

### 2.1. Root Level (System & Python Engine)

#### `kaggle_server.py`
- **Operational Role:** Runs as a standalone FastAPI web service designed for high-end GPUs (like Kaggle T4x2). It encapsulates Qwen2.5-VL-7B-Instruct (loaded via 4-bit quantization using `bitsandbytes`) and LAION-CLAP for real-time audio classification. In `MOCK_MODE=true`, it skips heavy GPU weights and streams deterministic mock actions.
- **Dependencies:** `fastapi`, `uvicorn`, `transformers`, `bitsandbytes`, `laion_clap`, `torch`, `Pillow`, `schedule`.
- **Pipeline Role:** Accepts incoming POST requests on `/infer` from the Coordinator, runs multi-modal inference on the frame (WebP base64) and audio (PCM float32), builds the prompt via twelve semantic blocks, and yields a streaming SSE token stream containing thoughts followed by a structured Action JSON under `---ACTION---`.

#### `kaggle_new.py` & `kaggle_original.py` & `qwen2_vl.py`
- **Operational Role:** Historical/experimental iterations of the Kaggle service. `kaggle_new.py` contains experimental updates, while `qwen2_vl.py` contains targeted testing for raw Qwen VL tokens.
- **Dependencies:** Mirror `kaggle_server.py`.
- **Pipeline Role:** Used for isolated pipeline debugging and testing fallback prompts.

#### `supabase_schema.sql`
- **Operational Role:** Defines the relational schema, vector space extensions (`pgvector`), and retrieval routines inside the Supabase database.
- **Pipeline Role:** Configures the `memories` table, index types, and the `match_memories` similarity search RPC function called by the Coordinator's `MemoryManager`.

---

### 2.2. scripts/

#### `scripts/sync-types.mjs`
- **Operational Role:** Code sync tool that reads types and motor program JSON files from the frontend and copies them into the coordinator's subfolders.
- **Dependencies:** Native Node.js `fs` and `path` modules.
- **Pipeline Role:** Ensures TypeScript schemas and default motor programs do not drift between the separate package directories.

---

### 2.3. coordinator/ (Cognitive Loop Server)

The coordinator runs as a Fastify web server on port 3001, acting as Machine A to manage WebSocket client connections, state synchronization, and provider-agnostic LLM/VLM calls.

#### `coordinator/src/server.ts`
- **Operational Role:** Entry point for the coordinator. Mounts a Fastify HTTP/WebSocket server. It accepts WebSocket connections at `/ws` and routes incoming payloads to the active agent's loop.
- **Dependencies:** `fastify`, `@fastify/websocket`, `dotenv`, `ws`, `AgentLoop`.
- **Pipeline Role:** Decodes incoming messages (`world_state`, `action_feedback`, `injection`) from the frontend. It routes states to the agent loop and proxies results back.

#### `coordinator/src/agentLoop.ts`
- **Operational Role:** State machine driving the cognitive loop cycle. Manages session checkpointing, schedules cycles, interacts with the memory database, and processes model outputs.
- **Dependencies:** `InferenceClient`, `PayloadBuilder`, `MemoryManager`, `MotorProgramStore`.
- **Pipeline Role:** Triggers on a set cycle timer (`cycleMs`). It constructs the VLM request payload, invokes `InferenceClient`, parses the SSE stream, merges gaze targets into joint overrides, forwards the action to the frontend, and records the outcome as a persistent memory.

#### `coordinator/src/payloadBuilder.ts`
- **Operational Role:** Constructs the highly specific JSON input format (`InferPayload`) expected by the inference providers.
- **Dependencies:** `MemoryManager`, `stripDataUrlPrefix` utility.
- **Pipeline Role:** Gathers current world objects, proprioceptive joint states, audio, recent memories, and user overrides. It queries the vector database for relevant memories, generates a spatial grounding "perception summary", and builds a unified payload context.

#### `coordinator/src/inferenceClient.ts`
- **Operational Role:** Proxy manager that routes payloads to the active inference provider (Gemini, Kaggle, OpenAI-Compatible).
- **Dependencies:** `providerFactory`, `InferPayload` type.
- **Pipeline Role:** Abstract interface isolating the `AgentLoop` from concrete API HTTP protocols.

#### `coordinator/src/memoryManager.ts`
- **Operational Role:** Dual-mode memory storage. If Supabase keys are configured, it writes to the remote DB and reads via Xenova embeddings. Otherwise, it transparently falls back to an in-memory keyword-based vector mock.
- **Dependencies:** `@supabase/supabase-js`, `@xenova/transformers` (esm-dynamic).
- **Pipeline Role:** Persists every action cycle outcome with its frame buffer to the database. It queries spatial and temporal contexts to provide long-term cognitive continuity.

#### `coordinator/src/motorProgramStore.ts`
- **Operational Role:** Storage layer for reusable motion programs.
- **Dependencies:** Standard Node.js file system.
- **Pipeline Role:** Reads primitives from `coordinator/programs/primitives/` and saves custom synthesized motor programs written by the VLM.

#### `coordinator/src/injectionQueue.ts`
- **Operational Role:** High-priority user instruction buffer.
- **Dependencies:** Synchronized in-memory array.
- **Pipeline Role:** Holds custom prompts sent from the frontend God Mode. Injects them one-by-one into the next cognitive cycle.

#### `coordinator/src/reconnectionManager.ts`
- **Operational Role:** Fault-tolerant connection monitor.
- **Pipeline Role:** Emits connection status events to update the UI panels when network interfaces fail or recover.

#### `coordinator/src/providers/*`
- **Files:** `geminiProvider.ts`, `kaggleProvider.ts`, `openaiCompatProvider.ts`, `providerFactory.ts`, `types.ts`
- **Operational Role:** Adapt various LLM/VLM provider specs into a uniform interface.
- **Pipeline Role:** `geminiProvider.ts` uses Google's SSE format, `openaiCompatProvider.ts` uses OpenAI-compliant formats for NIM/Groq/OpenRouter, and `kaggleProvider.ts` calls our custom FastAPI GPU endpoint.

---

### 2.4. src/ (Frontend / World Simulation Sub-system)

The frontend is a React 18 single-page application that mounts the 3D canvas and provides interactive "God Mode" controls to manage the simulation and inspect the AI's internal state.

#### `src/main.tsx` & `src/App.tsx`
- **Operational Role:** Application bootstrapping. React root mounting, global Tailwind CSS injection, layout rendering, and one-time audio unlock listeners.
- **Dependencies:** `react-dom`, `Tone` (resumed via click listener).

#### `src/store/*`
- **Files:** `worldStore.ts`, `agentStore.ts`, `connectionStore.ts`, `uiStore.ts`, `logStore.ts`
- **Operational Role:** State coordination across disjoint UI panels.
- **Pipeline Role:**
  - `worldStore.ts`: Tracks gravity, body modes (rigid/ragdoll), active camera mode, grid/sky styles, and spawns. Persists parameters to LocalStorage.
  - `agentStore.ts`: Manages AI thought streams, active goals, cognitive ladder progression rungs, and current active joint states.
  - `connectionStore.ts`: Manages WebSocket configurations (`ws://localhost:3001/ws`) and real-time networking metrics.

#### `src/world/engine/WorldEngine.ts`
- **Operational Role:** Core Three.js render loop. Manages scene lights, floor geometry, sky-dome transitions, grid helper rendering, mouse raycast selections, and particles.
- **Dependencies:** `three`, `CameraManager`, `PhysicsEngine`, Zustand stores.
- **Pipeline Role:** Serves as the visual master. Houses the main `requestAnimationFrame` loop that drives the physics step, frame updates, offscreen camera captures, and viewport canvas rendering.

#### `src/world/engine/PhysicsEngine.ts`
- **Operational Role:** Wrapper for the Rapier3D physics solver.
- **Dependencies:** `@dimforge/rapier3d-compat`.
- **Pipeline Role:** Initializes the WASM physics world. Steps the simulation (`world.step()`), manages global friction, clamps velocities on registered rigid bodies, and flushes/drains collision/contact force events from the WASM heap.

#### `src/world/engine/HumanoidPhysicsBinder.ts`
- **Operational Role:** The physical representation of the humanoid character. It implements a **Single-Capsule Movement Model** where the Mixamo skinned mesh rides on top of a single dynamic Rapier capsule collider.
- **Dependencies:** `three`, `GLTFLoader`, `@dimforge/rapier3d-compat`, `SYNTHIA_RIG_CONSTRAINTS`.
- **Pipeline Role:** Tracks bone positions, calculates forward/up vectors from bind pose, and moves the character via capsule linear velocity. It smooths joint rotations via exponential target lerping (`updateMotorTargets()`), translates gait cycles to movement forces using Kinematic Ground Reaction Forces (K-GRF), manages visual ground alignment, and executes chronological action timelines.

#### `src/world/engine/CameraManager.ts`
- **Operational Role:** Unified viewport controller.
- **Dependencies:** `three`, `OrbitControls`, `TransformControls`.
- **Pipeline Role:** Holds three perspectives: Orbit follow (`third_person`), first-person eyes (`first_person`), and stable spectator spectator (`model_input`). Updates orientations, attaches transform gizmos to world objects, and handles offscreen high-res WebP capture (448x448) for the VLM.

#### `src/world/engine/ObjectManager.ts`
- **Operational Role:** Dynamic asset spawner and physics sync.
- **Dependencies:** `@dimforge/rapier3d-compat`, `three`, `AudioEngine`.
- **Pipeline Role:** Spawns interactive physical items (cubes, spheres, piano keys, triggers). Extracts collision impulses to trigger synth sounds, handles custom user gltf uploads, and synchronizes Three.js meshes with Rapier rigid bodies.

#### `src/world/engine/PDController.ts`
- **Operational Role:** Proportional-Derivative joint motor actuation solver.
- **Pipeline Role:** Standard torque computation solver. Replaced in primary humanoid mode by direct kinematic/lerping, but remains in the codebase as the motor actuation solver for pure multi-body procedural ragdolls.

#### `src/world/engine/AudioEngine.ts`
- **Operational Role:** Real-time synthesizer and visualizer source.
- **Dependencies:** `tone`.
- **Pipeline Role:** Triggers piano notes on collision events, captures real-time audio PCM, and feeds it into the coordinator to give the VLM sensory hearing.

#### `src/world/hooks/useWorld.ts`
- **Operational Role:** Orchestrator hook bridging React state, custom event busses, and the low-level rendering/physics loops.
- **Pipeline Role:** Instantiates all engine classes. Feeds the render loop callback to `WorldEngine`, listens for global cross-component actions (`synthia:spawn`, `synthia:push`, `synthia:action`), captures world state to feed the websocket payload, and tracks outcome triggers.

#### `src/world/hooks/useCoordinator.ts` & `src/world/contexts/CoordinatorContext.tsx`
- **Operational Role:** WebSocket communication link to Machine A.
- **Pipeline Role:** Connects to port 3001, handles automatic reconnection, routes incoming WebSocket packets (`action`, `thought_token`, `memory_saved`) to corresponding stores/events, and serializes output frames and states for the coordinator.

#### `src/components/*`
- **Operational Role:** Interactive dashboard HUD.
- **Pipeline Role:** Wired to Zustand stores and the WebSocket bus. `BodyControls.tsx` resets poses; `ConnectionPanel.tsx` sets IP/endpoints; `ThoughtBank.tsx` renders thoughts; `MemoryViewer.tsx` displays database feedback; `StructureViewer.tsx` inspects physics properties of selected items.

---

## 3. Broader Execution Pipeline

The execution sequence operates as a continuous, closed-loop feedback pipeline:

```
[WorldEngine RAF Loop]
       │
       ▼ (Steps Rapier world.step() and syncs visual meshes)
[useWorld.ts / captureWorldState] (Throttled capture of 448x448 WebP image, PCM audio, and joints)
       │
       ▼ (Sends frame and state over WebSocket)
[coordinator/src/server.ts (Fastify)]
       │
       ▼ (Receives state and updates local variables)
[coordinator/src/agentLoop.ts]
       │
       ├─► [MemoryManager] (Queries Supabase or Mock DB for relevant contextual memories)
       │
       ├─► [injectionQueue] (Injects high-priority user prompt overrides if present)
       │
       ▼ (Assembles complete context and sends to model)
[Inference Providers (Gemini / OpenAI-Compat / kaggle_server)]
       │
       ▼ (VLM processes visual + textual state and generates SSE stream)
[Token Streaming] ── thought tokens ──► [ThoughtBank.tsx (Frontend HUD)]
       │
       ▼ (Inference finishes; parses Action JSON under "---ACTION---")
[Action Output Parser]
       │
       ▼ (Sends action packet over WebSocket)
[coordinator/src/server.ts (Fastify)]
       │
       ▼ (Receives action over WebSocket)
[useCoordinator.ts / useWorld.ts (React Event Bus)]
       │
       ├─► [HumanoidPhysicsBinder] (Clamps joint angles, pushes action timeline onto execution queue)
       │
       └─► [ObjectManager] (Spawns items / triggers physical impulses / plays sounds)
       │
       ▼ (Renders next physical frames; loops back)
```

This map establishes the complete, unified architecture of Project Synthia. It details how the separate parts connect, from high-level vision models down to real-time WebGL rendering and physics calculations.
