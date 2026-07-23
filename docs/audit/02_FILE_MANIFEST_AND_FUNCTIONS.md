# Repository File Manifest & Functional Specifications

This document catalogs every directory, script, source file, and configuration asset across the entire project repository. It details file responsibilities, classes, and function contracts without embedding raw implementation code.

---

## 1. High-Level Directory Tree

The repository uses a modular, decoupled architecture consisting of an interactive React frontend, a Fastify-based coordinator server, and ML/hosting helper scripts:

```
.
├── coordinator/                     # Fastify Backend Server & LLM Broker
│   ├── models/                      # ML model assets & weights
│   ├── programs/                    # Primitives, gaits, and motion sequences
│   └── src/                         # TypeScript Source Files
│       ├── providers/               # LLM Provider Drivers
│       └── tests/                   # Coordinator Integration Tests
├── docs/                            # Project Documentation
│   └── audit/                       # Codebase Audits & Restart Blueprints
├── public/                          # Static Web Assets (WASM, Models)
│   ├── models/                      # Biped visual mesh (x-bot.glb)
│   └── mujoco/                      # MuJoCo WebAssembly engine binary
├── scripts/                         # Build, synchronization, & setup scripts
└── src/                             # React Frontend Simulation Layer
    ├── assets/                      # Static layout images
    ├── components/                  # UI Components & floating panels
    │   ├── agent/                   # Mind, thought, memory & logs HUDs
    │   ├── export/                  # Dataset generator views
    │   ├── godmode/                 # Physics, Body, & Handshake panels
    │   └── world/                   # Viewport canvas & PIP viewers
    ├── constants/                   # Physics ranges, limits, & constraints
    ├── debug/                       # WebGL & engine helper diagnostics
    ├── store/                       # Zustand application state modules
    ├── types/                       # TypeScript Interface schemas
    ├── utils/                       # Web Storage, loggers, & helper tools
    └── world/                       # World Simulation Engine
        ├── contexts/                # React WebSocket connection provider
        ├── engine/                  # MuJoCo WebAssembly binding classes
        └── hooks/                   # World synchronization hooks
```

---

## 2. Config & Root File Manifest

### `package.json`
*   **Path**: `/package.json`
*   **Responsibility**: Root project configuration listing scripts, devDependencies, and dependencies.
*   **Enclosed Scripts**:
    *   `dev`: Starts the Vite development server.
    *   `build`: Compiles TypeScript and runs the Vite production build.
    *   `lint`: Executes ESLint syntax and style checks.
    *   `preview`: Runs a local server to preview the production build.
    *   `coordinator`: Navigates to the coordinator folder and starts the backend service.
    *   `sync-types`: Runs the node script to synchronize API schemas between the frontend and coordinator.
    *   `test`: Runs Jest verification tests.

### `tsconfig.json`
*   **Path**: `/tsconfig.json`
*   **Responsibility**: Global compiler options and environment targets. It delegates specific configurations to `tsconfig.app.json` and `tsconfig.node.json`.

### `vite.config.ts`
*   **Path**: `/vite.config.ts`
*   **Responsibility**: Vite builder configuration. Sets up dev server ports and asset routing.

### `eslint.config.js`
*   **Path**: `/eslint.config.js`
*   **Responsibility**: Code style linting rules, ignoring build targets and validating TypeScript syntax.

### `postcss.config.js` & `tailwind.config.js`
*   **Path**: `/postcss.config.js` & `/tailwind.config.js`
*   **Responsibility**: Generates styling classes and layout configurations for Tailwind CSS.

### `jest.config.js`
*   **Path**: `/jest.config.js`
*   **Responsibility**: Configures Jest to run tests with VM module support (`--experimental-vm-modules`) under Node ESM environments.

---

## 3. Root Script Inventory

### `kaggle_server.py`
*   **Path**: `/kaggle_server.py`
*   **Responsibility**: Deploys a mock/live FastAPI model server. Serves as the cloud-GPU endpoint for Qwen2.5-VL and LLaVA inference requests.
*   **Enclosed Functions & Methods**:
    *   `infer(payload: InferRequest) -> Response`: Takes image frames, system instructions, and historical context. Returns generated thoughts and action outputs. Supports mock generation to run tests without GPU acceleration.
    *   `health() -> Status`: Verifies server status and returns hardware health metrics.

### `qwen2_vl.py`
*   **Path**: `/qwen2_vl.py`
*   **Responsibility**: Connects raw PyTorch model pipelines to local resources on GPU-enabled instances.
*   **Enclosed Functions & Methods**:
    *   `load_model() -> Pipeline`: Instantiates model weights and processors with low-precision optimization (bfloat16).
    *   `generate(image: PIL.Image, prompt: str) -> str`: Decodes visual inputs, runs tokenizers, and returns model outputs.

### `kaggle_original.py` & `kaggle_new.py`
*   **Path**: `/kaggle_original.py` & `/kaggle_new.py`
*   **Responsibility**: Legacy and utility variations for cloud deployments and testing API endpoint routing.

### `console_walking.js`, `diagnostic_poses.js`, `test_joints.js`, `test_stability.js`
*   **Path**: root directory utilities.
*   **Responsibility**: Node CLI scripts for sending direct, frame-by-frame joint movements and training actions over raw WebSockets to verify the physics binder.

---

## 4. Frontend Codebase Manifest (`src/`)

### 4.1 Application Setup
#### `App.tsx`
*   **Path**: `/src/App.tsx`
*   **Responsibility**: Root React element. Renders floating HUD drawers, toggle buttons, and the WebGL canvas viewport. Handles audio context initialization on user click.

#### `main.tsx`
*   **Path**: `/src/main.tsx`
*   **Responsibility**: Mounts the React application tree inside the document root element.

#### `vite-env.d.ts`
*   **Path**: `/src/vite-env.d.ts`
*   **Responsibility**: Declares global Vite client variables to support asset imports and Tailwind styling.

---

### 4.2 State Store Specifications (`src/store/`)
Stores maintain application state variables and export action setters to modify fields:

*   **`worldStore.ts`**: See [File 1](./01_UI_UX_AND_STATE.md#31-world-store-useworldstore).
*   **`uiStore.ts`**: See [File 1](./01_UI_UX_AND_STATE.md#32-ui-store-useuistore).
*   **`agentStore.ts`**: See [File 1](./01_UI_UX_AND_STATE.md#33-agent-store-useagentstore).
*   **`connectionStore.ts`**: See [File 1](./01_UI_UX_AND_STATE.md#34-connection-store-useconnectionstore).

---

### 4.3 Interface Components (`src/components/`)

#### `AppShell.tsx`
*   **Path**: `/src/components/layout/AppShell.tsx`
*   **Responsibility**: High-level component wrapping the full-viewport container. It includes a global notification system overlay.

#### `StatusBar.tsx`
*   **Path**: `/src/components/layout/StatusBar.tsx`
*   **Responsibility**: Renders the status bar. Displays frame sizes, network latency, and physical loop state.

#### `WorldViewport.tsx`
*   **Path**: `/src/components/world/WorldViewport.tsx`
*   **Responsibility**: Mounts the Three.js viewport and manages client-coordinator WS handshakes. It captures the world state and triggers outcomes (such as piano key contacts) on regular timer intervals.

#### `ModelInputPiP.tsx`
*   **Path**: `/src/components/world/ModelInputPiP.tsx`
*   **Responsibility**: Renders the Picture-in-Picture display showing the AI head-camera view, frame index, and connection indicators.

#### `PianoReward.tsx`
*   **Path**: `/src/components/world/PianoReward.tsx`
*   **Responsibility**: Renders floating positive reward metrics at contact locations when the biped plays notes.

#### `GodModePanel.tsx`
*   **Path**: `/src/components/godmode/GodModePanel.tsx`
*   **Responsibility**: Floating, draggable container that mounts Physics, Body, Directive, and Connection config panels.

#### `PhysicsControls.tsx`
*   **Path**: `/src/components/godmode/PhysicsControls.tsx`
*   **Responsibility**: Renders environment sliders (gravity and friction) and color pickers for the floor and sky.

#### `BodyControls.tsx`
*   **Path**: `/src/components/godmode/BodyControls.tsx`
*   **Responsibility**: Renders body type selection buttons, rigid/ragdoll toggles, and skeletal debug options.

#### `DirectivePanel.tsx`
*   **Path**: `/src/components/godmode/DirectivePanel.tsx`
*   **Responsibility**: Renders training objective controls and objective-setting buttons.

#### `ConnectionPanel.tsx`
*   **Path**: `/src/components/godmode/ConnectionPanel.tsx`
*   **Responsibility**: Renders forms to configure WebSocket addresses, LLM providers, credentials, cycle speeds, and database connection settings.

#### `ObjectSpawner.tsx`
*   **Path**: `/src/components/godmode/ObjectSpawner.tsx`
*   **Responsibility**: Renders shape spawner presets (cube, sphere, cylinder, wedge, slope, ramp, button, piano) and custom model file drop zones.

#### `ModelPreview.tsx`
*   **Path**: `/src/components/godmode/ModelPreview.tsx`
*   **Responsibility**: Mounts a miniature 3D viewer to preview uploaded files before spawning them into the scene.

#### `ExportModal.tsx`
*   **Path**: `/src/components/export/ExportModal.tsx`
*   **Responsibility**: Configures dataset export criteria (CSV, JSON, LeRobot formats) with progress metrics and filters.

#### `RehydrationModal.tsx`
*   **Path**: `/src/components/ui/RehydrationModal.tsx`
*   **Responsibility**: Overlays a loading state during world loads. Displays streaming text summaries during biped state rehydration.

#### `AgentStatus.tsx`, `ThoughtBank.tsx`, `MemoryViewer.tsx`, `StructureViewer.tsx`, `LogViewer.tsx`, `InjectionInput.tsx`
*   **Paths**: `/src/components/agent/` subfolders.
*   **Responsibility**: Side HUD panels displaying streamed text thoughts, memory tables, skeletal node trees, and custom text injectors.

---

### 4.4 Simulation Constants (`src/constants/`)

#### `anatomicalLimits.ts`
*   **Path**: `/src/constants/anatomicalLimits.ts`
*   **Responsibility**: Limits range of motion (in radians) for bipedal limbs and defines world boundaries.
*   **Enclosed Functions & Methods**:
    *   `getAnatomicalLimitForBone(bone: string) -> Limit`: Retrieves joint range limits (minimum and maximum angles) for a given bone name.

#### `bodyTypes.ts`
*   **Path**: `/src/constants/bodyTypes.ts`
*   **Responsibility**: Structural definitions for available agent layouts.

#### `objectPresets.ts`
*   **Path**: `/src/constants/objectPresets.ts`
*   **Responsibility**: Physical constants (mass, friction, dimensions) for spawnable shapes.

#### `physics.ts`
*   **Path**: `/src/constants/physics.ts`
*   **Responsibility**: Base matrix matching Mixamo skeletal structures to standardized weight distributions and dimensions.

#### `rigConstraints.ts`
*   **Path**: `/src/constants/rigConstraints.ts`
*   **Responsibility**: Defines joint degrees of freedom (DOF) and coordinate rotation axes for standard humanoid rigs.

#### `strings.ts`
*   **Path**: `/src/constants/strings.ts`
*   **Responsibility**: Static UI text labels and localized notification templates.

---

### 4.5 World Engine & Binding Logic (`src/world/`)

#### `CoordinatorContext.tsx`
*   **Path**: `/src/world/contexts/CoordinatorContext.tsx`
*   **Responsibility**: Establishes a persistent, auto-reconnecting WebSocket connection to the coordinator. It coordinates incoming actions, streams text thoughts, and parses memory handshakes.
*   **Enclosed Functions & Methods**:
    *   `normalizeWebSocketUrl(url: string) -> string`: Appends websocket transport protocols (e.g., `ws://`) to plain text URLs.
    *   `sendMessage(type: string, data: object) -> void`: Serializes and transmits structured JSON packets to the coordinator.

#### `useWorld.ts`
*   **Path**: `/src/world/hooks/useWorld.ts`
*   **Responsibility**: Hooks Three.js render loops to the biped physics solver. It handles background day/night cycle timers and updates client metrics.
*   **Enclosed Functions & Methods**:
    *   `captureWorldState() -> State`: Compiles joints, proprioceptive indicators, audio PCM buffers, contact arrays, and spawned objects into a single JSON payload.
    *   `detectOutcomes() -> Outcome[]`: Scans state logs (e.g., body falls or piano hits) and returns active reward indicators.
    *   `findSpawnPosition(skipCheck: boolean) -> Vector3`: Computes non-overlapping spawn coordinates for newly created elements.

#### `WorldEngine.ts`
*   **Path**: `/src/world/engine/WorldEngine.ts`
*   **Responsibility**: Instantiates the WebGL renderer, cameras, ambient/directional lights, background colors, and world grids. Manages mouse clicks for gizmo drag selection.
*   **Enclosed Functions & Methods**:
    *   `start(onStep: function) -> void`: Begins the rendering loop and steps the physics solver at a fixed rate ($60\text{ Hz}$).
    *   `updateLighting(state: day/night, progress: number) -> void`: Blends light colors and intensities during environment cycle transitions.
    *   `spawnParticleBurst(position: Vector3) -> void`: Triggers brief visual particle explosions at collision coordinates.

#### `PhysicsEngine.ts`
*   **Path**: `/src/world/engine/PhysicsEngine.ts`
*   **Responsibility**: Manages the MuJoCo WebAssembly compiler. It loads model files and drives physics stepping and contact resolution.
*   **Enclosed Functions & Methods**:
    *   `worldToMuJoCo(vector: Vector3) -> Array`: Converts Three.js coordinates ($X, Y, Z$) to MuJoCo coordinates ($X, -Z, Y$).
    *   `mujocoToWorld(array: Array) -> Vector3`: Converts MuJoCo coordinates to Three.js coordinates.
    *   `threeQuatToMuJoCo(quat: Quaternion) -> Array`: Converts Three.js quaternions to MuJoCo quaternions (scalar-first, conjugated by $90^\circ$ about $X$).
    *   `mujocoQuatToThree(array: Array) -> Quaternion`: Converts scalar-first MuJoCo quaternions back to standard Three.js rotation vectors.
    *   `ensureMuJoCoInitialized() -> Promise<Module>`: Pre-loads the Emscripten binary from absolute server paths.
    *   `loadMJCFModel(xml: string) -> void`: Re-compiles MJCF model files and resets heap data pointers.
    *   `step() -> void`: Executes a physics iteration, clamps velocities, and updates contact arrays.
    *   `clampRegisteredBodyVelocities() -> void`: Standardizes and limits body movement velocities to prevent solver crashes.
    *   `drainContactForceEventsInternal() -> void`: Queries contact forces via WebIDL double-buffers to update contact arrays.

#### `BodyManager.ts`
*   **Path**: `/src/world/engine/BodyManager.ts`
*   **Responsibility**: Maps humanoid skeletal names to physical bodies, geoms, and actuator indexes. Updates target positions from current skeleton transforms.
*   **Enclosed Functions & Methods**:
    *   `activate(boneMap, skeleton, capsule, centerY, root) -> Promise<boolean>`: Generates MJCF files, compiles them, and indexes joints and bodies.
    *   `syncRigidBodiesFromBones(boneMap) -> void`: Updates joint angles and root freejoint positions in `qpos` to match Three.js visual orientations.

#### `MJCFHumanoidTemplate.ts`
*   **Path**: `/src/world/engine/MJCFHumanoidTemplate.ts`
*   **Responsibility**: Procedurally generates the core XML model file for the biped simulation, including body segments, flat sole geoms, actuators, environment slots, and the 88-key piano.
*   **Enclosed Functions & Methods**:
    *   `generateHumanoidMJCF(boneMap, skeleton, centerY) -> string`: Builds a comprehensive MJCF XML string based on visual skeleton coordinates, joint limits, and weight matrices.

#### `MotorController.ts`
*   **Path**: `/src/world/engine/MotorController.ts`
*   **Responsibility**: Converts joint targets to actuator values. It handles neutral stance holds (idle mode), target signal ramping, and capsule balance torques.
*   **Enclosed Functions & Methods**:
    *   `setTargets(targets: Map) -> void`: Computes and applies yaw, pitch, and roll actuator values to `ctrl` memory.
    *   `applyGainsToModel() -> void`: Updates gain coefficients in the model heap.
    *   `applyCapsuleBalance(bodyId: number) -> void`: Calculates stabilizing torques and applies them to the capsule's `xfrc_applied` array.

#### `ObjectManager.ts`
*   **Path**: `/src/world/engine/ObjectManager.ts`
*   **Responsibility**: Tracks spawned shapes and custom models. It maps 3D meshes to physics slots, updates positions, and triggers collision events.
*   **Enclosed Functions & Methods**:
    *   `reloadStateAndRehydrate(newMesh) -> void`: Captures active rigid body states, regenerates the XML, and re-hydrates the state back into the new model heap.
    *   `spawnObject(presetId, position) -> Object`: Claims a pre-allocated environment slot and moves its physical representation to the target coordinates.
    *   `spawnPiano(id, preset, position) -> Object`: Places the 88-key piano and maps collision IDs for note detection.
    *   `deleteObject(id) -> void`: Undergrounds pre-allocated slots or removes custom meshes and triggers a model reload.
    *   `syncVisuals() -> void`: Synchronizes Three.js mesh positions with active physics body coordinates.
    *   `update() -> void`: Monitors contacts and triggers callbacks for interactive objects (piano keys, buttons).

#### `CameraManager.ts`
*   **Path**: `/src/world/engine/CameraManager.ts`
*   **Responsibility**: Manages the main user camera and the offscreen AI perception camera. Controls orbit and drag-and-drop transform gizmos.
*   **Enclosed Functions & Methods**:
    *   `update(headMatrix, targetPos, capsuleQuat, capsulePos) -> void`: Aligns cameras to look targets and positions the point-of-view camera.
    *   `captureAIFrame(scene) -> string`: Renders offscreen views, flips vertical pixel buffers, and returns compressed base64 image strings.

#### `CollisionAdapter.ts`
*   **Path**: `/src/world/engine/CollisionAdapter.ts`
*   **Responsibility**: Helper class that extracts names and contact states for overlapping geoms.
*   **Enclosed Functions & Methods**:
    *   `getCollisionPairs(module, model, data) -> Pair[]`: Scans the active contact heap to build a list of colliding geom names and IDs.

#### `ObservationBuilder.ts`
*   **Path**: `/src/world/engine/ObservationBuilder.ts`
*   **Responsibility**: Encodes joint positions, velocities, gravity vectors, and movement history into numeric arrays for AI perception.
*   **Enclosed Functions & Methods**:
    *   `buildVLMProprioception(rootBody) -> Proprioception`: Compiles biped positions, angles, velocities, and tracking vectors into structured formats.

#### `AudioEngine.ts`
*   **Path**: `/src/world/engine/AudioEngine.ts`
*   **Responsibility**: Handles polyphonic sound synthesis for piano note playback. Captures raw audio waveform data.
*   **Enclosed Functions & Methods**:
    *   `playNote(note: string) -> void`: Triggers MIDI instrument sounds.
    *   `getBuffer() -> ArrayBuffer`: Retrieves captured audio waveforms as PCM bytes.

---

## 5. Coordinator Backend Source Manifest (`coordinator/`)

The coordinator server runs as a background process to coordinate biped decisions, manage memories, and interface with external AI APIs.

### 5.1 Service Entry & Loops (`coordinator/src/`)

#### `server.ts`
*   **Path**: `/coordinator/src/server.ts`
*   **Responsibility**: Initializes Fastify, sets up routes, and manages WebSocket connections. It processes custom client configurations and handles dataset exports.

#### `agentLoop.ts`
*   **Path**: `/coordinator/src/agentLoop.ts`
*   **Responsibility**: Drives the cognitive biped loop. It packages environment states, calls API drivers, and streams actions and thoughts back to the client.
*   **Enclosed Functions & Methods**:
    *   `runCycle() -> void`: Coordinates sensory capture, runs memory retrieval, calls models, and sends joint controls.

#### `payloadBuilder.ts`
*   **Path**: `/coordinator/src/payloadBuilder.ts`
*   **Responsibility**: Compiles prompt templates, physical feedback, and visual inputs into structured JSON payloads for AI models.

#### `memoryManager.ts`
*   **Path**: `/coordinator/src/memoryManager.ts`
*   **Responsibility**: Manages memory retrieval and persistence. Falls back to keyword-based in-memory structures if database configurations are missing.

#### `injectionQueue.ts`
*   **Path**: `/coordinator/src/injectionQueue.ts`
*   **Responsibility**: Manages queues of user commands to inject into active prompt pipelines.

#### `motorProgramStore.ts`
*   **Path**: `/coordinator/src/motorProgramStore.ts`
*   **Responsibility**: Stores and indexes target joint values for standard motor sequences (stand upright, jump, step).

#### `datasetExporter.ts`
*   **Path**: `/coordinator/src/datasetExporter.ts`
*   **Responsibility**: Formats database rows and dumps session history to CSV or JSONL files.

#### `inferenceClient.ts`, `reconnectionManager.ts`, `supabasePing.ts`
*   **Path**: `/coordinator/src/` utilities.
*   **Responsibility**: Helper classes that monitor network status and verify database access.

---

### 5.2 Provider Specifications (`coordinator/src/providers/`)
Providers inherit from a standard base class and implement a common interface:

#### `providerFactory.ts`
*   **Path**: `/coordinator/src/providers/providerFactory.ts`
*   **Responsibility**: Returns the appropriate provider driver based on client handshake configurations.

#### `kaggleProvider.ts`
*   **Path**: `/coordinator/src/providers/kaggleProvider.ts`
*   **Responsibility**: Coordinates connections to custom cloud endpoints running Qwen2.5-VL.

#### `geminiProvider.ts`
*   **Path**: `/coordinator/src/providers/geminiProvider.ts`
*   **Responsibility**: Driver for Google's Gemini models. Formats multimodal inputs (images and text) and returns structured JSON actions.

#### `openaiCompatProvider.ts`
*   **Path**: `/coordinator/src/providers/openaiCompatProvider.ts`
*   **Responsibility**: Standardized adapter for OpenAI-compatible APIs (NVIDIA NIM, Groq, OpenRouter).
