# BUGFIXES

## Initial Cleanup

- **`package.json`** — Fixed `coordinator` script path to `cd coordinator && npm run dev`.
- **`package.json`** — Removed `geist` npm package in favor of `@fontsource` packages as per memory.
- **`scripts/sync-types.mjs`** — Created script to synchronize types and motor programs between frontend and coordinator.
- **`package.json`** — Added `sync-types` script.
- **`.env.example`** & **`coordinator/.env.example`** — Created example environment files.

## Mock Kaggle Server

- **`kaggle_server.py`** — Added `MOCK_MODE` support to skip GPU-heavy model loading and return mock streaming responses for integration testing.
- **`kaggle_server.py`** — Commented out Jupyter-style `!pip` command and added try/except blocks for heavy dependencies (`torch`, `PIL`, `numpy`) to allow the server to start in basic environments.
- **Environment** — Installed `fastapi`, `uvicorn`, `pydantic`, `numpy`, `schedule` in the sandbox to support the mock server.

## Frontend

- **`src/types/export.ts`** — Added missing `ExportFormat` type.
- **`src/types/payload.ts`** — Updated `InferPayload` schema to match Phase 4/5 requirements (including frame, audio_pcm, etc.).
- **`src/world/engine/AudioEngine.ts`** — Fixed `MediaStreamDestination` type error by casting `rawContext` to `AudioContext`.
- **`src/world/engine/ObjectManager.ts`** — Updated `update` method to use `drainContactEvents` from `EventQueue` instead of `contactPairEvents` on `World` for better stability and to avoid Rapier 'recursive use' errors.
- **`src/world/hooks/useWorld.ts`** — Correctly passing `EventQueue` to `ObjectManager.update`.
- **`src/world/engine/WorldEngine.ts`** — Fixed `animate()` call to pass initial timestamp.
- **Multiple Components** — Fixed `useCoordinator` calls to not pass `null` as it expects no arguments.
- **TypeScript** — Resolved multiple unused variable and missing type errors to allow successful production build.
- **Dependencies** — Installed missing `tone` dependency.

## Coordinator

- **`src/embeddingEngine.ts`** — Implemented lazy dynamic import for `@xenova/transformers` to resolve ESM/CommonJS mismatch in `ts-node`.
- **`src/memoryManager.ts`** — Implemented in-memory fallback store and keyword-based retrieval for environments where Supabase is not configured.
- **`src/motorProgramStore.ts`** — Implemented in-memory fallback store that pre-loads primitive motor programs from disk (`programs/primitives/*.json`).
- **`src/payloadBuilder.ts`** — Updated to correctly construct the Phase 4/5 `InferPayload` and fixed destructuring error when dequeuing from `injectionQueue`.
- **`src/server.ts`** — Fixed import paths (removed `.js` extensions) to work correctly with `ts-node` in CommonJS mode.
- **`src/server.ts`** — Fixed WebSocket connection handling to support both Fastify's wrapper and raw `ws` objects.
- **`src/server.ts`** — Fixed logic to allow `AgentLoop` to start even without Supabase configuration.
- **`src/server.ts`** — Ensured `KAGGLE_ENDPOINT_URL` environment variable is passed to the `AgentLoop`.
- **`src/agentLoop.ts`** — Added more logging to track the cognitive loop steps.
- **`src/tests/coordinator.test.ts`** — Updated tests to match the new `InjectionQueue.dequeue` return signature.
- **`tsconfig.json`** — Verified configuration for `ts-node` compatibility.

## Functionality Wiring Pass

- **`ExportModal.tsx`** — Fully implemented format selection, scope selection (All, Date Range, Session Picker, Heartbeat Range), filter options, and dynamic row/size estimation. Integrated with real `export_progress` and `export_complete` WebSocket messages.
- **`ObjectSpawner.tsx`** & **`ObjectManager.ts`** — Wired spawner tabs to filter presets and implemented `handleSpawn` via a window event bus to `WorldViewport`.
- **`PhysicsControls.tsx`** — Wired gravity and friction sliders to update `PhysicsEngine` immediately.
- **`PhysicsEngine.ts`** — Added `setGlobalFriction` to update all existing rigid bodies in the Rapier world.
- **`BodyControls.tsx`** — Added "SET SPAWN HERE" and "RESET POSE" buttons wired to the engine.
- **`RagdollBuilder.ts`** — Implemented `setBodyMode` to toggle between static (Fixed) and dynamic (Dynamic) rigid bodies.
- **`DirectivePanel.tsx`** — Fully wired training mode toggle, goal definition input, and goal establishment WebSocket messages.
- **`ConnectionPanel.tsx`** — Wired "CONNECT" button and editable fields for endpoint, Supabase, and cycle speed.
- **`MemoryViewer.tsx`** — Wired to display real memory history from `agentStore`, with tier filtering, reward badges, and AI-named detection (non-UUID logic).
- **`InjectionInput.tsx`** & **`agentStore.ts`** — Implemented injection queue tracking with a visual "queued" badge updated via coordinator `injection_consumed` messages.
- **`WorldViewport.tsx`** & **`WorldEngine.ts`** — Implemented full viewport replacement for `MODEL` camera mode, rendering the head-camera target fullscreen with a distinctive border.
- **`StatusBar.tsx`** — Wired all metrics (RTT, FPS, Heartbeat, Frame Size, Light) to update in real-time from live data.
- **`useWorld.ts`** — Implemented frame size calculation and event listeners for UI-to-Engine cross-component communication.

## Core Reliability Pass

- **`CoordinatorContext.tsx`** — Implemented `normalizeWebSocketUrl` and fixed connection path to `/ws` to match Fastify route. Fixed file download trigger on export completion.
- **`connectionStore.ts`** — Updated default endpoint to `ws://localhost:3001/ws` and fixed persistence key to `synthia_connection_config`.
- **`ObjectManager.ts` & `PhysicsEngine.ts`** — Fixed Rapier crash by updating `drainContactEvents` to `drainCollisionEvents` for compatibility with v0.19.3.
- **`App.tsx` & `AudioEngine.ts`** — Resolved AudioContext blocking by moving Tone.js and Sampler initialization to a post-user-interaction lazy load pattern.

## Needs User Input

- `.env` files for frontend and coordinator are missing. Created `.env.example` in both locations. User must provide: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `KAGGLE_ENDPOINT_URL`.

## Known Warnings — Non-Blocking
- **`ts-jest` hybrid module warning** — Minor configuration warning in coordinator tests, does not affect test execution.

## Physics Realism & Embodiment Session (Jul 2026)

### Section 1 — Anatomical Limits & Physics Safety
- **`src/constants/anatomicalLimits.ts`** — Created human range-of-motion limits in radians; velocity/boundary constants.
- **`HumanoidPhysicsBinder.ts`** — `setMotorTargets()` validates and rejects out-of-limit angles; fixed fly-away bug from per-frame velocity accumulation; `resetPose()` and boundary check; rigid mode allows toppling.
- **`RagdollBuilder.ts`** — Rapier revolute/spherical joint limits enforced at creation time.
- **`PhysicsEngine.ts`** — Post-step linear/angular velocity clamp (8 m/s, 12 rad/s) on registered bodies.
- **`useWorld.ts`** — Auto-triggers reset when humanoid exceeds 50-unit radius from origin.

### Section 2 — Action Rejection Feedback
- **`useWorld.ts`** — Sends `action_feedback` when joints rejected.
- **`coordinator/agentLoop.ts`** + **`payloadBuilder.ts`** — Stores rejections, injects `physical_feedback` into next inference payload once.
- **`kaggle_server.py`**, **`geminiProvider.ts`**, **`openaiCompatProvider.ts`** — Physical feedback and environmental awareness prompt blocks.

### Section 3 — Reset Pose Button
- **`BodyControls.tsx`** — Fixed to dispatch `synthia:resetPose` instead of a stand_upright action.
- **`HumanoidPhysicsBinder.resetPose()`** — Resets capsule + joints to spawn/upright_preset.
- **`RagdollBuilder.resetToSpawn()`** — Added for non-humanoid body types.
- **`useWorld.ts`** — Shift+R full reset clears all spawned objects and resets pose.

### Section 4 — TransformControls Dragging
- **`CameraManager.ts`** — OrbitControls disabled during gizmo drag; per-frame `updateMatrixWorld()`.
- **`ObjectManager.ts`** — Skips physics sync for actively dragged object (root cause of "gizmo visible but object doesn't move").
- **`WorldEngine.ts`** — Selection attaches to object with `userData.objectId`.

### Section 5 — Model Input PiP
- **`worldStore.ts`** + **`WorldEngine.ts`** — Throttled reactive frame store replaces DOM polling.
- **`ModelInputPiP.tsx`** — Rewritten with `<img src={data:image/webp;base64,...}>`.
- **`StatusBar.tsx`** — Fixed "undefineds" display when metrics not yet received.

### Section 6 — System Prompt
- **`kaggle_server.py`** + API providers — Void-world awareness and T-pose warning blocks added.

### Section 7 — 3D Model Upload
- **`idb-keyval`** dependency added for IndexedDB storage.
- **`uploadedModelsStore.ts`**, **`ModelPreview.tsx`**, **`ObjectSpawner.tsx`** — Custom tab with upload, preview, terrain flag, persistence, re-spawn.
- **`ObjectManager.spawnCustomModel()`** — Trimesh (terrain) or convex hull (objects) colliders.

### Section 8 — Export Audit
- **`datasetExporter.ts`** — CSV format implemented; LeRobot `stats.json` + `tasks.jsonl`; JSONL includes `session_id`.
- **`ExportModal.tsx`** — Real Supabase session picker (disabled when not connected).
