# UI/UX and State Management Specification

This document serves as the absolute engineering reference for the frontend interface and state synchronization mechanics of the simulation.

---

## 1. UI Layout & Visual Panels

The application implements a full-screen 3D immersive viewport overlayed with floatable, drag-enabled glassmorphism panels. This enables real-time visual inspection of physics interactions without blocking the user's focus.

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
*   **Export Modal**: Enables CSV, LeRobot, and JSONL dataset packaging based on date, sessions, or heartbeats.
*   **Rehydration Modal**: Locks input during scene reloads, displaying token-by-token text rehydration reviews.

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

## 3. State Management (`worldStore` / `uiStore` / `agentStore` / `connectionStore`)

State management uses **Zustand** to decouple UI, simulation logic, and WebSocket communication layers.

The frontend is built around four central store modules:
*   **World Store**: Maintains physical environment variables, rendering options, and biped characteristics. Saves settings to `localStorage` under `synthia_world_session` on changes.
*   **UI Store**: Coordinates HUD overlays, tabs, panel drawers, and download progress states.
*   **Agent Store**: Tracks incoming streaming data, goal parameters, and biped achievements.
*   **Connection Store**: Manages WebSocket addresses, database configurations, and performance diagnostics.

---

## 4. State Synchronization Mechanics

Synchronizing state between UI controls, Zustand data stores, the WebGL loop, and the 3D physics solver requires an event-driven architecture to keep rendering lightweight.

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
