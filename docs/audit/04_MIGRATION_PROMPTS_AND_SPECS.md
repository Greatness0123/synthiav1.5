# Migration Prompts, Architecture Lessons & Rebuild Blueprint

This document archives the prompts and development phases of the project, details the architectural lessons learned from previous iterations, and provides a step-by-step checklist for clean-slate rebuilds.

---

## 1. Prompt & Specification Archive

The development of the simulation progressed through five distinct, structured phases:

### Phase 1: Interactive Physics Sandbox
*   **Objectives**: Set up a basic 3D simulation sandbox using Three.js and Vite. Establish basic environments (directional lighting, sky rendering, floor grid), spawn primitive shapes, and lay down the foundation for the physics loop.
*   **Prompt Directives**: "Design a lightweight, responsive WebGL simulation workspace supporting standard orbital cameras, custom background themes, floor grids, and a basic rendering loop. Structure application state using Zustand for clean separation between UI components and 3D scenes. Build components that decouple visuals from ticking physics solvers."

### Phase 2: Bipedal Skeletal Rigging
*   **Objectives**: Load the 3D humanoid mesh (`x-bot.glb`) and extract its bones. Map the visual rig to physical rigid bodies, establish coordinate transformations, and align visual bones with physics coordinates.
*   **Prompt Directives**: "Load the Mixamo character rig. Traverse skeletal bones, index anatomical names, and map joint coordinates. Create a single core bounding volume representing the trunk, and align its position and orientation with the visual rig across coordinate frames. Ensure rotations are converted cleanly using quaternion conjugate structures."

### Phase 3: Actuator Joint Servos
*   **Objectives**: Implement Proportional-Derivative (PD) motor control loops. Standardize joint limits based on anatomical ranges of motion, handle target angle command sets, and implement a soft-start signal ramping mechanism.
*   **Prompt Directives**: "Implement joint motor servos. Limit movements to biological ranges. Support joint targets (yaw, pitch, and roll) and implement a 20-frame soft-start signal ramping mechanism on startup to prevent joint snaps. Map incoming controls gracefully and clamp excessive target joint velocities."

### Phase 4: Cognitive Handshakes
*   **Objectives**: Build the client-coordinator communication loop. Set up WebSocket protocols to stream visual frames and proprioceptive state vectors to the backend, receive generated joint targets, and log streaming thoughts.
*   **Prompt Directives**: "Establish a real-time, auto-reconnecting WebSocket connection. Capture offscreen AI perception frames ($448 \times 448$ pixels), package joint data and contact state vectors, and send them to the coordinator. Parse incoming cognitive decisions, extract joint targets, and render streamed thought characters in real time. Ensure the loop is robust against high latency spikes."

### Phase 5: Single-Engine Optimization & Interactive Elements
*   **Objectives**: Replace legacy hybrid solvers with a single, optimized MuJoCo WebAssembly engine. Implement terrain collision handling, dynamic mesh uploads, interactive objects (buttons, 88-key piano), and audio waveform captures.
*   **Prompt Directives**: "Remove legacy hybrid engine references and standardize on MuJoCo WebAssembly. Implement flat box foot soles to improve standing balance. procedurally compile MJCF models to support dynamic mesh spawning, incorporate an 88-key piano with audio feedback, and capture PCM waveforms. Wrap memory access pointers safely to prevent Emscripten heap invalidations."

---

## 2. Key Architectural Lessons & Pitfalls

During previous iterations, ten critical architectural traps were uncovered. This section details why they occurred and how the biped resolved them:

### Lesson 1: Single Physics Source of Truth (Rapier vs. MuJoCo)
*   **The Trap**: Early versions used Rapier for world objects and MuJoCo for biped joint solving. This hybrid setup required complex, error-prone synchronization loops to handle collisions and contact forces between the two engines, leading to desynchronizations and biped crashes.
*   **The Solution**: Standardized on **MuJoCo WebAssembly** as the single physics engine. The entire scene—including the biped, spawned objects, and terrain—is procedurally compiled into a single MJCF XML model file, ensuring accurate collision resolution and stable contact solving.

### Lesson 2: Joint Target Ramping & Soft-Start
*   **The Trap**: When spawning the biped or resetting its pose, joint targets were initialized to zero. This caused massive position errors relative to the active pose, resulting in high joint torques that made the character explode or fly out of the world.
*   **The Solution**: Implemented a **20-frame linear ramping mechanism** ($\alpha = \min(1.0, \, n_{\text{step}}/20)$) on startup or resets. In addition, qpos values are pre-initialized directly to the DEFAULT_STANCE_POSE targets, ensuring a smooth transition into active physics.

### Lesson 3: WASM Heap View Invalidation
*   **The Trap**: In the Emscripten binding, array properties (like `data.qpos`, `data.qvel`, and `data.ctrl`) point directly to views on the live WASM heap. When dynamically reloading models or expanding heap memory, these views became invalidated, resulting in silent memory corruptions and page crashes.
*   **The Solution**: Wrapped all access to heap variables in getter methods. These getters query and re-acquire the active heap address on every simulation step, ensuring safe access to active pointers and avoiding memory access faults.

### Lesson 4: The "Rolling Pin" Effect and Foot Sole Geometry
*   **The Trap**: Representing feet with capsule colliders or rounded geometries resulted in single point contacts. Under load, this generated uncontrollable rolling torques at the ground interface ($Z=0$), causing the character to spin and slide.
*   **The Solution**: Swapped capsule foot colliders for **flat box geoms** (`type="box"`). This creates a flat 2D support polygon that provides stable contact distribution and prevents rotational drift.

### Lesson 5: Root Capsule Floor Overlap & Bounding Caps
*   **The Trap**: Giving the main root capsule active collision properties caused it to collide with the legs and feet. This compressed the joint tree and generated phantom contact forces that pushed the character upward.
*   **The Solution**: Disabled active collisions on the root capsule geom (`contype` set to 0, `conaffinity` set to 0). This restricts collision handling to the biped's limbs and foot geoms, allowing the feet to handle all ground contact.

### Lesson 6: Mass Double-Counting & Inertial Override
*   **The Trap**: Specifying both geom density parameters and explicit `<inertial>` tags in MJCF caused MuJoCo to double-count body masses, resulting in unrealistic joint loads and sluggish movements.
*   **The Solution**: Set explicit `<inertial>` tags for each body segment. In MuJoCo, explicit `<inertial>` tags completely override geom density calculations, ensuring accurate mass distribution.

### Lesson 7: `<position>` Actuator Gear Mechanics
*   **The Trap**: Attempting to scale torque limits on position actuators using the `gear` attribute had no effect. This caused actuators to output excessive torque that overpowered joint limits.
*   **The Solution**: Position actuators in MuJoCo ignore the `gear` attribute for torque scaling. Torque limits must be set explicitly using the `forcerange` attribute on the actuator, keeping motor outputs within safe limits.

### Lesson 8: Frame-0 `ctrl` / `qpos` Sync
*   **The Trap**: If the initial joint targets in `ctrl` did not match the skeleton's spawn pose in `qpos` on Frame 0, the biped would snap violently on the first physics step.
*   **The Solution**: Synchronized `ctrl` and `qpos` on Frame 0 before executing the first physics step, aligning joint angles and motor setpoints with the spawn pose.

### Lesson 9: Three.js to MuJoCo Quaternion Alignment
*   **The Trap**: Remapping quaternion axes directly between Three.js (Y-up) and MuJoCo (Z-up) resulted in distorted, unnatural joint rotations.
*   **The Solution**: Swapped direct axis mapping for quaternion conjugation. Rotations are aligned by conjugating with a $+90^\circ$ pitch rotation about the $X$-axis ($\mathbf{Q}_{\text{align}}$), preserving rotational alignment across both coordinate spaces.

### Lesson 10: Dynamic Mesh Spawning without Re-compilation Stutters
*   **The Trap**: Rebuilding and compiling the entire MJCF XML whenever a primitive was spawned caused noticeable frame drops and simulation stutters.
*   **The Solution**: Pre-allocated **20 empty slot bodies** (`env_slot_0` to `env_slot_19`) in the base MJCF. Each slot contains four deactivated sibling geoms (sphere, box, cylinder, capsule) of minimal size ($0.001$). Spawning an object simply claims an empty slot and activates its target geom, avoiding the need for on-the-fly XML re-compilation.

---

## 3. Rebuild Checklist & Blueprint

To rebuild the simulation cleanly from step zero, follow this prioritized sequence:

### Step 1: Environment & Tooling Setup
1.  Initialize a React + TypeScript project bundled with Vite.
2.  Install core dependencies: `@phosphor-icons/react`, `framer-motion`, `idb-keyval`, `tone`, and `three`.
3.  Add development dependencies: `typescript`, `eslint`, and `tailwindcss` (with PostCSS auto-prefixing).
4.  Configure `tsconfig.json` to handle client and node environments, and set up Jest for tests.

### Step 2: Draggable Glassmorphism HUD Panels
1.  Configure Tailwind to handle glassmorphism styling and dark/light theme classes.
2.  Build the primary layout container (`AppShell.tsx`) with hidden overflows to isolate mouse captures.
3.  Implement Zustand stores (`useWorldStore`, `useUIStore`, `useAgentStore`, `useConnectionStore`) to decouple UI state from WebGL loops.
4.  Create the draggable panel wrapper using `framer-motion` for fluid movement.
5.  Build the configuration HUD tabs (Physics, Body, Directives, Connections) and the Agent diagnostics sidebar (Thoughts, Memories, Skeletal Nodes, Logs).

### Step 3: Offscreen Rendering & WebGL Viewport
1.  Build `WorldViewport.tsx` to handle canvas mount points.
2.  Instantiate `WorldEngine.ts` to set up the WebGL renderer, shadow maps, ambient/directional lights, and environment grids.
3.  Configure `CameraManager.ts` with OrbitControls for 3rd-person navigation.
4.  Implement the $448 \times 448$ offscreen rendering pipeline using a custom `WebGLRenderTarget` aligned with the head camera.
5.  Add offscreen pixel capture methods that flip vertical buffers and output compressed base64 strings.

### Step 4: MuJoCo WASM Integration
1.  Place the single-threaded `mujoco.wasm` binary in the public directory `/public/mujoco/mujoco.wasm`.
2.  Implement `PhysicsEngine.ts` to load the WASM binary using absolute server paths.
3.  Write the coordinate transformation helpers (`worldToMuJoCo`, `mujocoToWorld`) and quaternion conjugation converters (`threeQuatToMuJoCo`, `mujocoQuatToThree`).
4.  Implement safety boundaries that clamp joint velocities and trigger auto-resets if the character falls out of the world.
5.  Add contact force sampling using `m_contactForce` with WebIDL double-buffers to update contact arrays.

### Step 5: Biped Rigging & Actuator Mapping
1.  Implement `MJCFHumanoidTemplate.ts` to generate the core XML structure.
2.  Include flat box foot soles, joint ranges, and PD motor gains (Hips: 400, Spine: 300, Arms: 200).
3.  Build `BodyManager.ts` to load the generated MJCF model and map bone names to bodies and geoms.
4.  Implement `syncRigidBodiesFromBones` to initialize joint coordinates directly from bone transforms.
5.  Write `MotorController.ts` to update actuator targets in `ctrl` and implement the 20-frame soft-start ramping mechanism.

### Step 6: Interactive Balance & Contact Mechanics
1.  Implement the upright balance controller (`applyCapsuleBalance`) to apply corrective torques to `xfrc_applied`.
2.  Set up the pre-allocated environment slot pool (slots 0-19) to handle primitive shape spawning.
3.  Build `ObjectManager.ts` to manage spawned shapes and custom model uploads, using IndexedDB for persistence.
4.  Implement model recompilation and state rehydration to support custom mesh uploads without losing active physics states.
5.  Add contact listeners to map piano key collisions to polyphonic synthesis triggers in `AudioEngine.ts`.

### Step 7: Client-Coordinator WS Synchronization
1.  Implement `CoordinatorContext.tsx` with auto-reconnecting WebSockets.
2.  Set up a polling loop (`WorldViewport.tsx`) running at `cycleMs` intervals.
3.  On every tick, capture visual frames, joints, and proprioceptive vectors, and send them as JSON payloads.
4.  Add custom action handlers that validate incoming joint targets and apply them to the motor controller.
5.  Implement dataset export managers (`datasetExporter.ts`) to package session logs into CSV and JSONL formats.
