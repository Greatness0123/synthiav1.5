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
    *   `infer`: Takes image frames, system instructions, and historical context. Returns generated thoughts and action outputs. Supports mock generation to run tests without GPU acceleration.
        *   *Inputs*: JSON request payload conforming to `InferRequest`.
        *   *Calculations*: Checks model configuration. If in mock mode, streams custom template thought strings and action schemas. If in GPU mode, runs the PyTorch tokenizer and generates visual language actions.
        *   *Outputs*: Streams text responses containing thoughts and action structures.
    *   `health`: Verifies server status and returns hardware health metrics.
        *   *Inputs*: None.
        *   *Calculations*: Inspects system load and GPU state metrics.
        *   *Outputs*: JSON status block.

### `qwen2_vl.py`
*   **Path**: `/qwen2_vl.py`
*   **Responsibility**: Connects raw PyTorch model pipelines to local resources on GPU-enabled instances.
*   **Enclosed Functions & Methods**:
    *   `load_model`: Instantiates model weights and processors with low-precision optimization (bfloat16).
        *   *Inputs*: None.
        *   *Calculations*: Loads Qwen2.5-VL weights using Hugging Face AutoClasses.
        *   *Outputs*: Instantiated model and processor pipelines.
    *   `generate`: Decodes visual inputs, runs tokenizers, and returns model outputs.
        *   *Inputs*: Image file, text prompt string.
        *   *Calculations*: Pre-processes image inputs, encodes text prompt tokens, and runs model auto-regressive generation.
        *   *Outputs*: Generated text string.

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
    *   `getAnatomicalLimitForBone`: Retrieves joint range limits (minimum and maximum angles) for a given bone name.
        *   *Inputs*: Canonical bone name string.
        *   *Calculations*: Inspects rig constraints for matching anatomical ranges.
        *   *Outputs*: Limits structure containing minimum and maximum angles.

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
    *   `normalizeWebSocketUrl`: Appends websocket transport protocols (e.g., `ws://`) to plain text URLs.
        *   *Inputs*: Raw address string.
        *   *Calculations*: Regex matches transport patterns.
        *   *Outputs*: Sanitized URL string.
    *   `sendMessage`: Serializes and transmits structured JSON packets to the coordinator.
        *   *Inputs*: Message identifier, payload data object.
        *   *Calculations*: Transforms data objects into string formats.
        *   *Outputs*: Dispatches network bytes.

#### `useWorld.ts`
*   **Path**: `/src/world/hooks/useWorld.ts`
*   **Responsibility**: Hooks Three.js render loops to the biped physics solver. It handles background day/night cycle timers and updates client metrics.
*   **Enclosed Functions & Methods**:
    *   `captureWorldState`: Compiles joints, proprioceptive indicators, audio PCM buffers, contact arrays, and spawned objects into a single JSON payload.
        *   *Inputs*: None.
        *   *Calculations*: Accumulates 3D coordinate transformations, grabs offscreen pixels, and serializes audio arrays.
        *   *Outputs*: Complete state payload conforming to `InferPayload`.
    *   `detectOutcomes`: Scans state logs (e.g., body falls or piano hits) and returns active reward indicators.
        *   *Inputs*: None.
        *   *Calculations*: Validates active contact logs and thresholds.
        *   *Outputs*: Outcome metrics array.
    *   `findSpawnPosition`: Computes non-overlapping spawn coordinates for newly created elements.
        *   *Inputs*: None.
        *   *Calculations*: Tests candidate positions in a spiral path relative to the character.
        *   *Outputs*: Vector location.

#### `WorldEngine.ts`
*   **Path**: `/src/world/engine/WorldEngine.ts`
*   **Responsibility**: Instantiates the WebGL renderer, cameras, ambient/directional lights, background colors, and world grids. Manages mouse clicks for gizmo drag selection.
*   **Enclosed Functions & Methods**:
    *   `start`: Begins the rendering loop and steps the physics solver at a fixed rate ($60\text{ Hz}$).
        *   *Inputs*: Callback trigger on physical solve.
        *   *Calculations*: Accumulates time deltas, stepping the physics solver when thresholds are met.
        *   *Outputs*: Frame updates.
    *   `updateLighting`: Blends light colors and intensities during environment cycle transitions.
        *   *Inputs*: Sunlight mode, progress value ($0 \to 1$).
        *   *Calculations*: Linear interpolates ambient and directional light values.
        *   *Outputs*: Modified lighting values.
    *   `spawnParticleBurst`: Triggers brief visual particle explosions at collision coordinates.
        *   *Inputs*: Vector coordinate.
        *   *Calculations*: Builds a particle buffer around the coordinates and animates their ascent.
        *   *Outputs*: Modifies the visible 3D scene.

#### `PhysicsEngine.ts`
*   **Path**: `/src/world/engine/PhysicsEngine.ts`
*   **Responsibility**: Manages the MuJoCo WebAssembly compiler. It loads model files and drives physics stepping and contact resolution.
*   **Enclosed Functions & Methods**:
    *   `worldToMuJoCo`: Converts Three.js coordinates ($X, Y, Z$) to MuJoCo coordinates ($X, -Z, Y$).
        *   *Inputs*: Three.js Vector3.
        *   *Calculations*: Map coordinates: $Y \to Z, Z \to -Y$.
        *   *Outputs*: MuJoCo coordinate array.
    *   `mujocoToWorld`: Converts MuJoCo coordinates to Three.js coordinates.
        *   *Inputs*: MuJoCo coordinate array.
        *   *Calculations*: Map coordinates: $Z \to Y, -Y \to Z$.
        *   *Outputs*: Three.js Vector3.
    *   `threeQuatToMuJoCo`: Converts Three.js quaternions to MuJoCo quaternions (scalar-first, conjugated by $90^\circ$ about $X$).
        *   *Inputs*: Three.js quaternion.
        *   *Calculations*: Converts scale formats and conjugating offset vectors.
        *   *Outputs*: MuJoCo scalar-first quaternion.
    *   `mujocoQuatToThree`: Converts scalar-first MuJoCo quaternions back to standard Three.js rotation vectors.
        *   *Inputs*: MuJoCo scalar-first quaternion array.
        *   *Calculations*: Reverses conjugation and scale order formats.
        *   *Outputs*: Three.js quaternion.
    *   `ensureMuJoCoInitialized`: Pre-loads the Emscripten binary from absolute server paths.
        *   *Inputs*: None.
        *   *Calculations*: Resolves local or remote WASM binary locations and instantiates modules.
        *   *Outputs*: Promise of initialized MainModule.
    *   `loadMJCFModel`: Re-compiles MJCF model files and resets heap data pointers.
        *   *Inputs*: XML config string.
        *   *Calculations*: Writes XML strings to virtual file systems and loads them into solver configurations.
        *   *Outputs*: Refreshes memory pointers.
    *   `step`: Executes a physics iteration, clamps velocities, and updates contact arrays.
        *   *Inputs*: None.
        *   *Calculations*: Steps physics simulation heap, updates bounding values, and scans active collision nodes.
        *   *Outputs*: Increments simulation clock.
    *   `clampRegisteredBodyVelocities`: Standardizes and limits body movement velocities to prevent solver crashes.
        *   *Inputs*: None.
        *   *Calculations*: Inspects registered free-joint speed thresholds and scales velocity values if limits are exceeded.
        *   *Outputs*: Modifies `qvel` values.
    *   `drainContactForceEventsInternal`: Queries contact forces via WebIDL double-buffers to update contact arrays.
        *   *Inputs*: None.
        *   *Calculations*: Queries contact points in the active physics data structure, reads normal/tangential forces, and updates contacts.
        *   *Outputs*: Contact force map.

#### `BodyManager.ts`
*   **Path**: `/src/world/engine/BodyManager.ts`
*   **Responsibility**: Maps humanoid skeletal names to physical bodies, geoms, and actuator indexes. Updates target positions from current skeleton transforms.
*   **Enclosed Functions & Methods**:
    *   `activate`: Generates MJCF files, compiles them, and indexes joints and bodies.
        *   *Inputs*: Bone maps, joint structures, root models, vertical offsets.
        *   *Calculations*: Generates XML structures, compiles them into solver configurations, and maps names to system IDs.
        *   *Outputs*: Setup status.
    *   `syncRigidBodiesFromBones`: Updates joint angles and root freejoint positions in `qpos` to match Three.js visual orientations.
        *   *Inputs*: Bone transform map.
        *   *Calculations*: Converts local bone rotations to Euler angles and maps them to respective joint positions in `qpos`.
        *   *Outputs*: Modifies solver heap values.

#### `MJCFHumanoidTemplate.ts`
*   **Path**: `/src/world/engine/MJCFHumanoidTemplate.ts`
*   **Responsibility**: Procedurally generates the core XML model file for the biped simulation, including body segments, flat sole geoms, actuators, environment slots, and the 88-key piano.
*   **Enclosed Functions & Methods**:
    *   `generateHumanoidMJCF`: Builds a comprehensive MJCF XML string based on visual skeleton coordinates, joint limits, and weight matrices.
        *   *Inputs*: Bone transforms, parent mappings, weight configurations.
        *   *Calculations*: Generates XML elements for bodies, joints, geoms, pre-allocated slots, and actuators.
        *   *Outputs*: XML configuration string.

#### `MotorController.ts`
*   **Path**: `/src/world/engine/MotorController.ts`
*   **Responsibility**: Converts joint targets to actuator values. It handles neutral stance holds (idle mode), target signal ramping, and capsule balance torques.
*   **Enclosed Functions & Methods**:
    *   `setTargets`: Computes and applies yaw, pitch, and roll actuator values to `ctrl` memory.
        *   *Inputs*: Joint target maps.
        *   *Calculations*: Resolves joint structures, scales angles based on active ramping parameters, and updates `ctrl` elements.
        *   *Outputs*: Modifies `ctrl` array.
    *   `applyGainsToModel`: Updates gain coefficients in the model heap.
        *   *Inputs*: None.
        *   *Calculations*: Updates stiffness ($k_p$) and damping ($k_d$) parameters in the model structure.
        *   *Outputs*: Modifies active configurations.
    *   `applyCapsuleBalance`: Calculates stabilizing torques and applies them to the capsule's `xfrc_applied` array.
        *   *Inputs*: Capsule body ID.
        *   *Calculations*: Computes tilt angles, scales corrective feedback with PD coefficients, and writes them to the applied force array.
        *   *Outputs*: Modifies forces.

#### `ObjectManager.ts`
*   **Path**: `/src/world/engine/ObjectManager.ts`
*   **Responsibility**: Tracks spawned shapes and custom models. It maps 3D meshes to physics slots, updates positions, and triggers collision events.
*   **Enclosed Functions & Methods**:
    *   `reloadStateAndRehydrate`: Captures active rigid body states, regenerates the XML, and re-hydrates the state back into the new model heap.
        *   *Inputs*: New custom mesh configurations.
        *   *Calculations*: Serializes active joint coordinates and velocities, appends new custom elements to the XML configuration, compiles, and restores state values.
        *   *Outputs*: Reload status.
    *   `spawnObject`: Claims a pre-allocated environment slot and moves its physical representation to the target coordinates.
        *   *Inputs*: Preset shape identifier, vector location.
        *   *Calculations*: Resolves empty slots, configures slot dimensions and material properties, and sets spawn coordinates.
        *   *Outputs*: Created object structure.
    *   `spawnPiano`: Places the 88-key piano and maps collision IDs for note detection.
        *   *Inputs*: Piano ID, preset properties, spawn location.
        *   *Calculations*: Positions key geoms in the world space and maps key colliders.
        *   *Outputs*: Piano object structure.
    *   `deleteObject`: Undergrounds pre-allocated slots or removes custom meshes and triggers a model reload.
        *   *Inputs*: Object UUID.
        *   *Calculations*: Clears collision parameters, moves geoms deep underground, and triggers model reloads if the mesh is custom.
        *   *Outputs*: None.
    *   `syncVisuals`: Synchronizes Three.js mesh positions with active physics body coordinates.
        *   *Inputs*: None.
        *   *Calculations*: Converts body translations and rotations from MuJoCo coordinates and updates Three.js mesh transforms.
        *   *Outputs*: Synchronizes visualizations.
    *   `update`: Monitors contacts and triggers callbacks for interactive objects (piano keys, buttons).
        *   *Inputs*: None.
        *   *Calculations*: Iterates over collision pairs, triggering audio feedback or material color updates when buttons or keys are pressed.
        *   *Outputs*: Dispatches contact callbacks.

#### `CameraManager.ts`
*   **Path**: `/src/world/engine/CameraManager.ts`
*   **Responsibility**: Manages the main user camera and the offscreen AI perception camera. Controls orbit and drag-and-drop transform gizmos.
*   **Enclosed Functions & Methods**:
    *   `update`: Aligns cameras to look targets and positions the point-of-view camera.
        *   *Inputs*: Head matrix transforms, target positions, capsule orientations.
        *   *Calculations*: Positions cameras relative to the head coordinates and points them at target vectors.
        *   *Outputs*: Updates camera matrices.
    *   `captureAIFrame`: Renders offscreen views, flips vertical pixel buffers, and returns compressed base64 image strings.
        *   *Inputs*: World scene.
        *   *Calculations*: Renders scenes into render targets, reads color pixels into temporary arrays, flips buffers vertically, and encodes them as WebP format data.
        *   *Outputs*: WebP base64 image string.

#### `CollisionAdapter.ts`
*   **Path**: `/src/world/engine/CollisionAdapter.ts`
*   **Responsibility**: Helper class that extracts names and contact states for overlapping geoms.
*   **Enclosed Functions & Methods**:
    *   `getCollisionPairs`: Scans the active contact heap to build a list of colliding geom names and IDs.
        *   *Inputs*: MuJoCo MainModule, solver model, solver data.
        *   *Calculations*: Queries active collision structures, looks up geom identifiers, and extracts body names.
        *   *Outputs*: List of colliding pair structures.

#### `ObservationBuilder.ts`
*   **Path**: `/src/world/engine/ObservationBuilder.ts`
*   **Responsibility**: Encodes joint positions, velocities, gravity vectors, and movement history into numeric arrays for AI perception.
*   **Enclosed Functions & Methods**:
    *   `buildVLMProprioception`: Compiles biped positions, angles, velocities, and tracking vectors into structured formats.
        *   *Inputs*: Root body proxy.
        *   *Calculations*: Projects gravity vectors onto local coordinate frames, maps velocities, computes joint-to-parent offsets, and compiles history buffers.
        *   *Outputs*: Proprioceptive data conforming to VLMProprioception schemas.

#### `AudioEngine.ts`
*   **Path**: `/src/world/engine/AudioEngine.ts`
*   **Responsibility**: Handles polyphonic sound synthesis for piano note playback. Captures raw audio waveform data.
*   **Enclosed Functions & Methods**:
    *   `playNote`: Triggers MIDI instrument sounds.
        *   *Inputs*: Pitch descriptor (e.g. "C4").
        *   *Calculations*: Updates polyphonic synth triggers.
        *   *Outputs*: Synthesizes audio.
    *   `getBuffer`: Retrieves captured audio waveforms as PCM bytes.
        *   *Inputs*: None.
        *   *Calculations*: Grabs frequency data from active analyzers.
        *   *Outputs*: PCM wave buffer.

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
    *   `runCycle`: Coordinates sensory capture, runs memory retrieval, calls models, and sends joint controls.
        *   *Inputs*: Active world states.
        *   *Calculations*: Queries database matrices, compiles prompt packages, dispatches requests to providers, and normalizes output actions.
        *   *Outputs*: Directs biped controls.
    *   `parseAndValidateAction`: Normalizes action strings returned by models into rad-friendly targets.
        *   *Inputs*: Text action JSON string.
        *   *Calculations*: Strips markdown syntax, parses JSON attributes, normalizes angles into radian units, and translates gaze vectors into head joint angles.
        *   *Outputs*: Sanitized joint rotation target map.
    *   `finalizeCycle`: Writes cognitive cycle details (including visual buffers, actions, and rewards) to active memory databases.
        *   *Inputs*: Outcome descriptions, cycle identifiers.
        *   *Calculations*: Packages visual image buffers, joints, thoughts, and actions into unified entries and writes them to database schemas.
        *   *Outputs*: DB update status.

#### `payloadBuilder.ts`
*   **Path**: `/coordinator/src/payloadBuilder.ts`
*   **Responsibility**: Compiles prompt templates, physical feedback, and visual inputs into structured JSON payloads for AI models.
*   **Enclosed Functions & Methods**:
    *   `build`: Compiles full payload objects including visual frames, audio PCM, joint states, memories, and user instructions.
        *   *Inputs*: World state, agent ID, configuration options.
        *   *Calculations*: Strips prefix tags from images, queries vector database matrices, and formats qualitative sensory summaries.
        *   *Outputs*: Complete payload matching `InferPayload`.

#### `memoryManager.ts`
*   **Path**: `/coordinator/src/memoryManager.ts`
*   **Responsibility**: Manages memory retrieval and persistence. Falls back to keyword-based in-memory structures if database configurations are missing.
*   **Enclosed Functions & Methods**:
    *   `retrieveRelevant`: Performs vector similarity queries against active database records.
        *   *Inputs*: Target embedding array, agent ID, maximum count.
        *   *Calculations*: Runs cosine-similarity queries over database collections. If database keys are missing, falls back to keyword matching over in-memory caches.
        *   *Outputs*: Relevant memories array.

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
*   **Enclosed Functions & Methods**:
    *   `infer`: Sends visual content and prompt strings to Gemini endpoints and processes streamed outputs.
        *   *Inputs*: Sensory payload, token output stream callback.
        *   *Calculations*: Encodes raw visual frames, structures system instructions, initiates connections to Gemini endpoints, parses Server-Sent Events (SSE), and isolates thoughts and action payloads.
        *   *Outputs*: Cognitive result structure containing thoughts and actions.

#### `openaiCompatProvider.ts`
*   **Path**: `/coordinator/src/providers/openaiCompatProvider.ts`
*   **Responsibility**: Standardized adapter for OpenAI-compatible APIs (NVIDIA NIM, Groq, OpenRouter).
*   **Enclosed Functions & Methods**:
    *   `infer`: Connects to OpenAI-compliant endpoints and handles token streams.
        *   *Inputs*: Sensory payload, token output stream callback.
        *   *Calculations*: Formats chat roles (system, user), attaches visual frames, initiates streaming requests, parses event buffers, and isolates thoughts and action JSON blocks.
        *   *Outputs*: Cognitive result structure.
