# UI/UX and State Management Specification

This document serves as the absolute engineering reference for the frontend interface and state synchronization mechanics of the simulation.

---

## 1. UI Layout & Visual Panels

The application implements a full-screen 3D immersive viewport overlayed with floatable, drag-enabled glassmorphism panels. This enables real-time visual inspection of physics interactions without blocking the user's focus.

```
+─────────────────────────────────────────────────────────────+
| [Synthia Pill]                      [3RD] [1ST] [2ND] (Cam) |
|   (Top Left)                                    (Top Right) |
|                                                             |
|   +─────────────────────+             +─────────────────+   |
|   |                     |             |                 |   |
|   |    God Mode Panel   |             |   Agent Brain   |   |
|   |    (Draggable)      |             |   Tab Panel     |   |
|   |                     |             |   (Draggable)   |   |
|   +─────────────────────+             +─────────────────+   |
|                                                             |
|                         [AI PiP View]                       |
|                          (POV Overlay)                      |
|                                                             |
|                                                             |
|                    [Status Metrics Pill]                    |
|                       (Bottom Center)                       |
+─────────────────────────────────────────────────────────────+
```

### 1.1 Canvas Viewport (`WorldViewport.tsx`)
*   **Role**: Renders the complete WebGL Three.js context, including bipedal humanoid skeletal systems, world terrain, spawned rigid-body colliders, grids, sky configurations, and environmental elements.
*   **Picture-in-Picture (PiP) Overlay (`ModelInputPiP.tsx`)**: Renders a dedicated real-time secondary visual buffer. It displays the biped's point-of-view camera (first-person) rendered at 448 x 448 pixels. It includes a frame-count overlay and connection latency indicators.
*   **Piano Key Overlay (`PianoReward.tsx`)**: Overlays temporary visual indicator elements when a contact event triggers MIDI-note playback from biped-to-piano interaction, reflecting reward signal peaks (+1.0).

### 1.2 Layout Wrappers & Floating Infrastructure (`App.tsx`, `AppShell.tsx`, `StatusBar.tsx`)
*   **Main Container**: Occupies the full width and height of the viewport, with hidden overflows to isolate mouse capturing.
*   **Floating Status Bar (Bottom Center)**: A dedicated persistent display monitoring:
    *   `RTT`: Round-trip time to the coordinator in milliseconds.
    *   `INF`: Cognitive inference completion speed.
    *   `FPS`: Frame-rate performance of the renderer.
    *   `FRAME`: Outgoing visual perception payload size (in Kilobytes).
    *   `HEARTBEAT`: Active simulation iteration index.
    *   `LIGHT`: Current environmental cycle phase (Day/Night).
*   **Logo Pill (Top Left)**: Persistent branding element.
*   **Theme Toggle Button (Top Left, under logo)**: Switches application-wide color palettes between dark and light modes.

### 1.3 Floating God Mode Panel (`GodModePanel.tsx`)
A drag-and-drop enabled configuration interface. It can be collapsed into a trigger button and is split into four configuration modules:
1.  **Physics Controls (`PhysicsControls.tsx`)**: Controls for the core environmental variables (gravity vectors, surface materials, and sky rendering properties).
2.  **Body Controls (`BodyControls.tsx`)**: Configures joints, skeleton styles, motor types, debug markers, visual capsules, and camera aids.
3.  **Directive Panel (`DirectivePanel.tsx`)**: Enables training objective definitions, goals, and mode selection.
4.  **Connection Panel (`ConnectionPanel.tsx`)**: Manages coordinator backend handshakes, ML providers, database keys, and loop speeds.

### 1.4 Agent Brain Tab Panel (`ThoughtBank.tsx`, `MemoryViewer.tsx`, `StructureViewer.tsx`, `LogViewer.tsx`)
A multi-tab draggable panel tracking biped cognitive outputs.
*   **Thoughts Tab**: Tracks streaming token-by-token outputs, injecting ideas into the cognitive pipeline.
*   **Memories Tab**: Details persistent short-term and long-term memory logs with reward badges and environmental triggers.
*   **Structure Tab**: Visualizes interactive hierarchical node listings of active physical geometries and bones.
*   **Logs Tab**: System operation logs with success, warning, or error level alerts.

### 1.5 Dialog Modals (`ExportModal.tsx`, `RehydrationModal.tsx`)
*   **Export Modal**: Enables CSV, LeRobot, and JSONL dataset packaging based on date, sessions, or heartbeats. It calculates projected sizes, handles format configurations, and enables targeted filtering.
*   **Rehydration Modal**: Locks input during scene reloads, displaying token-by-token text rehydration reviews to the user.

---

## 2. Interactive Capabilities

The interface provides rich real-time control, mapped as follows:

| Control Target | UI Input Type | Bound Store / Parameter | Execution Event / Action |
| :--- | :--- | :--- | :--- |
| **Gravity Vector** | Horizontal Slider | `gravity` (Z-axis) | Instantly updates the world gravity values in the physics solver. |
| **Surface Friction** | Horizontal Slider | `globalFriction` | Iterates over and modifies all active material collision contacts. |
| **Sky Color** | Color Picker | `skyColor` | Triggers a Three.js scene background color update. |
| **Floor Visibility** | Toggle Switch | `showFloor` | Toggles rendering of the ground plane mesh. |
| **Floor Surface Color** | Color Picker | `floorColor` | Modifies the material color of the ground plane mesh. |
| **Grid Overlay** | Toggle Switch | `showGrid` | Controls grid-helper visibility. |
| **Body Model Type** | Selection List | `bodyType` | Swaps the model structure (Default: Humanoid). |
| **Body Mode** | Segmented Button | `bodyMode` | Swaps binder between actuated motors (`rigid`) and limp solver (`ragdoll`). |
| **Simplified Skeleton** | Toggle Switch | `simplifiedSkeleton` | Toggles rendering of experimental high-detail bone structures. |
| **Debug Joints** | Toggle Switch | `showDebugJoints` | Renders semi-transparent marker spheres ($r=0.02$) at joint centers. |
| **Capsule Colliders** | Toggle Switch | `showCapsuleDebug` | Overlays a wireframe capsule representing active body bounding limits. |
| **All Camera Vectors** | Toggle Switch | `showAICameraHelper` | Highlights camera cones and projection vectors within the scene. |
| **AI Perception PiP** | Toggle Switch | `showAIPiP` | Renders or collapses the point-of-view camera overlay. |
| **Procedural Model** | Toggle Switch | `useProcedural` | Toggles procedural asset generation instead of GLB models. |
| **Multi-Body Motors** | Toggle Switch | `useMultiBodyPD` | Swaps between single capsule models and multi-body joint solvers. |
| **Movement Smoothing** | Horizontal Slider | `movementSmoothing` | Configures target-tracking interpolation steps. |
| **Reset Pose** | Trigger Button | Window Custom Event | Dispatches `synthia:resetPose` to reset coordinates to upright stance. |
| **Set Spawn Here** | Trigger Button | `spawnPoint` | Caches current coordinates as the default spawn location. |
| **Camera Viewports** | Segmented Button | `cameraMode` | Cycles views between 3rd Person, 1st Person, and Chase Cam. |
| **Training Mode** | Toggle Switch | `directiveMode` | Toggles between AI Free Will and guided Training Goal operations. |
| **Establish Goal** | Submit Button | `currentGoal` | Dispatches objective specifications to the coordinator. |
| **Model Spawner** | Grid Item Trigger | Window Custom Event | Spawns primitive shapes or custom models into the scene. |

---

## 3. State Store Slice Variables and Setter Actions

The Zustand state layer is organized into decoupled stores to isolate UI modifications from high-frequency simulation ticks.

### 3.1 World Store Slices (`useWorldStore`)
Focuses on physical simulation and environmental parameters. It automatically writes modified properties to the browser storage namespace `synthia_world_session` to persist environments.

#### Complete Variable Manifest
*   `objects` (Type: `WorldObject[]`): Catalog of spawned primitives and custom shapes within the active world space.
*   `gravity` (Type: `number`): Core vertical gravity force ($Z$), defaults to $-9.81$.
*   `globalFriction` (Type: `number`): Material surface friction coefficient, defaults to $0.5$.
*   `bodyType` (Type: `BodyType`): Selected skeletal rig layout, standardizes to `'humanoid'`.
*   `bodyMode` (Type: `BodyMode`): Control mode, toggling between `'rigid'` and `'ragdoll'`.
*   `spawnPoint` (Type: `Vector3`): Base position used for pose resets and spawn point offsets.
*   `cameraMode` (Type: `CameraMode`): Active camera perspective (`'third_person'`, `'first_person'`, `'model_input'`).
*   `godModeOpen` (Type: `boolean`): Toggle for the God Mode panel overlay.
*   `simplifiedSkeleton` (Type: `boolean`): Simplifies joint tracking during visual renders.
*   `showDebugJoints` (Type: `boolean`): Joint marker visibility.
*   `sessionName` (Type: `string`): Text descriptor representing the active recording session.
*   `lightState` (Type: `'day' | 'night'`): Sun cycle state.
*   `dayNightCycleMs` (Type: `number`): Environmental day-to-night transitions.
*   `showFloor` (Type: `boolean`): Ground plane visibility state.
*   `floorColor` (Type: `string`): Hexadecimal color code representing the ground mesh.
*   `skyColor` (Type: `string`): Hexadecimal color code representing the sky background.
*   `showGrid` (Type: `boolean`): Floor grid overlay display toggle.
*   `showAICameraHelper` (Type: `boolean`): Projection cone visibility within the viewport.
*   `showAIPiP` (Type: `boolean`): Point-of-view picture-in-picture window visibility.
*   `showCapsuleDebug` (Type: `boolean`): Core bounding-capsule rendering state.
*   `movementSmoothing` (Type: `number`): Interpolation rates for target-tracking.
*   `useMultiBodyPD` (Type: `boolean`): Activates multi-body kinematic motor joints.
*   `useProcedural` (Type: `boolean`): Activates procedural biped skeletons.
*   `lastAIFrameForDisplay` (Type: `string | null`): Latest base64 point-of-view capture frame.
*   `useMuJoCo` (Type: `boolean`): Activates the MuJoCo engine solver.

#### Setter Actions
*   `setUseMultiBodyPD(enable)`: Updates the joint mode and saves the session.
*   `setUseProcedural(enable)`: Updates procedural skeleton states and saves the session.
*   `setGravity(gravity)`: Sets gravity and saves the session.
*   `setGlobalFriction(friction)`: Updates friction parameters across all materials.
*   `setBodyType(type)`: standardizes layout to humanoid biped.
*   `setBodyMode(mode)`: Swaps active physics strategy between rigid motors and ragdoll.
*   `setSimplifiedSkeleton(simplified)`: Sets bone rendering complexity.
*   `setShowDebugJoints(show)`: Toggles debug joint spheres.
*   `setCameraMode(mode)`: Focuses rendering views.
*   `setGodModeOpen(open)`: Toggles God Mode drawer.
*   `setLightState(state)`: Updates sun state.
*   `setDayNightCycleMs(ms)`: Sets light progression speeds.
*   `setShowFloor(show)`: Sets floor rendering.
*   `setFloorColor(color)`: Sets floor color.
*   `setSkyColor(color)`: Updates sky color.
*   `setShowGrid(show)`: Sets grid rendering.
*   `setShowAICameraHelper(show)`: Toggles visual camera helpers.
*   `setShowCapsuleDebug(show)`: Toggles capsule overlay.
*   `setShowAIPiP(show)`: Sets PiP visibility.
*   `setMovementSmoothing(speed)`: Sets interpolation rates.
*   `setLastAIFrameForDisplay(frame)`: Caches base64 frames.
*   `setUseMuJoCo(enable)`: Switches the physics engine solver.
*   `addObject(obj)`: Adds a spawned shape.
*   `removeObject(id)`: Removes a shape.
*   `saveSession()`: Serializes core variables to `localStorage`.
*   `loadSession()`: Restores serialized variables from local storage.

---

### 3.2 UI Store Slices (`useUIStore`)
Coordinates HUD drawers, modal layers, and dataset generation progress states.

#### Variable Manifest
*   `activeRightPanelTab` (Type: `'thoughts' | 'memories' | 'structure' | 'logs'`): Visible sidebar tab.
*   `rightPanelOpen` (Type: `boolean`): Right-hand panel drawer visibility state.
*   `theme` (Type: `'dark' | 'light'`): General CSS color theme.
*   `exportModalOpen` (Type: `boolean`): Export overlay state.
*   `objectSpawnerOpen` (Type: `boolean`): Spawner overlay state.
*   `rehydrationModalOpen` (Type: `boolean`): Rehydration overlay state.
*   `exportProgress` (Type: `number`): Dataset generation progress ($0 \to 100$).
*   `selectedEntityId` (Type: `string | null`): UUID of the selected 3D asset or bone.

#### Actions
*   `setActiveRightPanelTab(tab)`: Updates the visible sidebar tab.
*   `setRightPanelOpen(open)`: Toggles sidebar drawer.
*   `toggleTheme()`: Swaps system-wide theme modes.
*   `setSelectedEntityId(id)`: Highlights and focuses on the selected item.
*   `setExportModalOpen(open)`: Toggles the export view.
*   `setObjectSpawnerOpen(open)`: Toggles the spawner overlay.
*   `setRehydrationModalOpen(open)`: Toggles the rehydration lock.
*   `setExportProgress(progress)`: Increments data generation percentages.

---

### 3.3 Agent Store Slices (`useAgentStore`)
Manages the cognitive output layers, memory catalogs, and skills achieved by the agent.

#### Variable Manifest
*   `thoughts` (Type: `Thought[]`): Logged thoughts, containing unique ID, text content, heartbeat index, and injection status.
*   `memories` (Type: `Memory[]`): Recorded memories, containing memory ID, heartbeat, tier index, summaries, actions taken, reward metrics, and goals.
*   `skills` (Type: `string[]`): Full list of available skills.
*   `currentRung` (Type: `number`): Level on the progression ladder.
*   `currentGoal` (Type: `string | null`): Training objective specifications.
*   `directiveMode` (Type: `DirectiveMode`): Mode selection (`'free_will'` / `'training'`).
*   `heartbeat` (Type: `number`): Simulation clock tick.
*   `status` (Type: `AgentStatus`): General biped status (idle, walking, falling).
*   `pendingInjection` (Type: `string | null`): Injected text queued for processing.
*   `currentThought` (Type: `string`): Real-time text buffer for the streaming thought.
*   `rehydrationSummary` (Type: `string`): Streaming text buffer for rehydration summary.
*   `hasRehydrated` (Type: `boolean`): Rehydration completion flag.
*   `masteredSkills` (Type: `string[]`): Unlocked achievements.
*   `injectionQueue` (Type: `string[]`): Queued custom directions.
*   `injectionQueueCount` (Type: `number`): Size of the direction queue.

#### Actions
*   `addThought(thought)`: Appends an item to the thoughts log.
*   `addMemory(memory)`: Logs a persistent memory entry.
*   `setDirectiveMode(mode)`: Sets directive configurations.
*   `setCurrentGoal(goal)`: Sets active training goals.
*   `setPendingInjection(text)`: Caches directions for delivery.
*   `setStatus(status)`: Sets body states.
*   `setCurrentThought(text)`: Overwrites the thought buffer.
*   `appendThoughtToken(token)`: Appends incoming characters to the thought stream.
*   `setRehydrationSummary(text)`: Overwrites rehydration targets.
*   `appendRehydrationToken(token)`: Appends characters to the rehydration stream.
*   `setHasRehydrated(val)`: Sets rehydration state.
*   `addMasteredSkill(skill)`: Appends unlocked achievements.
*   `setInjectionQueue(queue)`: Overwrites the injection queue list.
*   `setInjectionQueueCount(count)`: Sets queue sizes.
*   `incrementInjectionQueueCount()`: Increments queue metrics.
*   `decrementInjectionQueueCount()`: Decrements queue metrics.
*   `setRung(rung)`: Updates biped progression levels.
*   `incrementHeartbeat()`: Increments the clock ticks.
*   `setHeartbeat(hb)`: Updates clock metrics.

---

### 3.4 Connection Store Slices (`useConnectionStore`)
Configures addresses and credentials, tracking network and API performance.

#### Variable Manifest
*   `endpoint` (Type: `string`): Coordinator WebSocket address, defaults to `'ws://localhost:3001/ws'`.
*   `inferenceEndpoint` (Type: `string`): API base address for the active LLM provider.
*   `provider` (Type: `ProviderType`): Provider identifier (`'kaggle'`, `'gemini'`, `'groq'`, etc.).
*   `providerModel` (Type: `string`): LLM model identifier.
*   `providerApiKey` (Type: `string`): Secure API credentials (kept in memory, never persisted).
*   `supabaseUrl` (Type: `string`): Database address.
*   `supabaseKey` (Type: `string`): Secure database anon key.
*   `status` (Type: `'disconnected' | 'connecting' | 'connected' | 'error'`): WS connection state.
*   `rtt` (Type: `number`): Message round-trip latency in milliseconds.
*   `inferenceTime` (Type: `number`): LLM processing latency in milliseconds.
*   `frameSize` (Type: `number`): Transmitted perception frame size in Kilobytes.
*   `fps` (Type: `number`): Client rendering frame-rate.
*   `cycleMs` (Type: `number`): Polling interval for coordinator-client loops.

#### Actions
*   `setEndpoint(url)`: Caches target WS locations.
*   `setInferenceEndpoint(url)`: Caches model processing targets.
*   `setProvider(provider)`: Changes active ML providers.
*   `setProviderModel(model)`: Changes model strings.
*   `setProviderApiKey(key)`: Registers secure session keys.
*   `setCycleMs(ms)`: Sets loop timing intervals.
*   `setSupabaseConfig(url, key)`: Updates database configurations.
*   `setStatus(status)`: Updates connection states.
*   `setMetrics(metrics)`: Caches performance metrics.

---

## 4. State Synchronization Mechanics

Synchronizing state between UI controls, Zustand data stores, the WebGL loop, and the 3D physics solver requires an event-driven architecture to keep rendering lightweight.

```
                  ┌──────────────────────┐
                  │   UI Interaction /   │
                  │   Zustand Action     │
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
 ┌─────────────────────┐            ┌────────────────────┐
 │  Local State Sync   │            │   Custom Events    │
 │ (localStorage, etc) │            │   (Event Bus)      │
 └─────────────────────┘            └─────────┬──────────┘
                                              │
                                              ▼
                                    ┌────────────────────┐
                                    │  Window Listeners  │
                                    │    (useWorld.ts)   │
                                    └─────────┬──────────┘
                                              │
                                              ▼
                                    ┌────────────────────┐
                                    │ Physics/3D Engine  │
                                    │    Modification    │
                                    └────────────────────┘
```

### 4.1 UI to 3D Physics Engine (Downward Propagation)
UI changes propagate to the physics engine via direct property bindings or custom DOM events:
*   **Direct Bindings (`useWorld.ts` subscribers)**:
    React state-effect listeners monitor the Zustand store for slider or toggle updates and apply them directly to the physics engine, such as adjusting the physics engine gravity vectors or updating object material friction properties.
*   **Decoupled Custom Events (Event Bus)**:
    To prevent unnecessary re-renders during high-frequency updates, interactive events are dispatched over a custom event bus to bypass the React component tree:
    *   `synthia:resetPose`: Resets the humanoid qpos positions and target motor angles to the upright stance.
    *   `synthia:deleteObject`: Notifies `ObjectManager` to detach transform gizmos and clean up mesh allocations.
    *   `synthia:spawn` / `synthia:spawnCustom`: Requests mesh loading, physical slot allocation, and XML model rebuilds.
    *   `synthia:push`: Applies push forces directly to the humanoid body's `qvel` velocity arrays.

### 4.2 WebGL Render Loop to Zustand Stores (Upward Propagation)
Visual properties must propagate back up to the UI to update dashboards and PIP displays:
*   **Per-Frame AI Frame Capture**:
    During each WebGL loop execution, the offscreen camera manager grabs the head-camera view, encodes it as a base64 string, and updates the Zustand store at a throttled rate (5 Hz) for display.
*   **Real-Time Diagnostics**:
    Performance metrics (such as frame size in KB and network RTT) are pushed into the status store during active frames.

### 4.3 Client-Coordinator Loop Synchronization
*   **Status Capture and Transmission**:
    At intervals configured by `cycleMs`, `WorldViewport` queries the physics engine, packages all active joints, proprioceptive indicators, audio PCM buffers, contact arrays, and spawned objects, and dispatches them to the coordinator.
*   **Outcome Handshakes**:
    Collision events (like piano key contact) append rewards to the pending outcome queue. These are processed and cleared during the next status capture loop to ensure correct reinforcement learning metrics.
