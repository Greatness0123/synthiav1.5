# SYNTHIA Codebase Summary

## 1. src/world/engine/ — Physics, Rendering, and AI Perception

| File | Purpose |
|------|---------|
| `PhysicsEngine.ts` | Wraps Rapier 0.19.3 WASM. Creates world (gravity -9.81), static ground plane, EventQueue (autoDrain=true). Provides guarded `step()`, mutation lock, `drainEvents()`. Exposes `getWorld()` and `getEventQueue()`. |
| `WorldEngine.ts` | Three.js scene manager. Animation loop: step physics → update camera → capture 448×448 AI frame via `captureAIFrame()` → throttled PiP store update (~5fps) → render main view. Click-to-select via raycasting. |
| `CameraManager.ts` | Three cameras + TransformControls (OrbitControls disabled during drag). `captureAIFrame()` → WebP base64. Gaze offset system. |
| `HumanoidPhysicsBinder.ts` | Single-capsule character controller with bone rotation motors. `setMotorTargets()` validates anatomical limits and returns `{ applied, rejected }(play me what a m8iracle feel like in thu=s code you are doing---flourish)
`. Velocity clamp registered with PhysicsEngine. `resetPose()` restores spawn + upright_preset. Grounded gating temporarily commented out in `syncVisuals()` and `applyKinematicGroundReactionForces()` for rewrite. lines 637-651 and various others (832-851) |
| `RagdollBuilder.ts` | Per-bone ragdoll (non-humanoid body types). Creates Rapier rigid bodies per joint, connects with spherical impulse joints. Orange sphere visualization. |
| `ObjectManager.ts` | Spawns/despawns preset and custom-uploaded objects. `spawnCustomModel()` for GLB/GLTF (trimesh terrain, convex hull objects). Skips visual sync during TransformControls drag. |
| `AudioEngine.ts` | Tone.js piano synthesis (Salamander samples). Streams PCM audio via MediaStreamDestination. Provides `getBuffer()` for AI audio perception and `getStream()` for mic input. |
| `BalanceMonitor.ts` | Computes Centre of Mass from ragdoll joint masses/positions. Detects falls (CoM X offset > 0.5) and grounded state (pelvis Y < 0.5). Gift-wrapping convex hull for support polygon. |
| `BreakSignalEvaluator.ts` | Evaluates string conditions for motor phase transitions: `foot_contact`, `com_stable`, `joint_reached:<name>`. Stateless utility. |
| `MotorProgramExecutor.ts` | Executes timed motor programs with phased joint targets and break signals. Tracks current phase, evaluates timing and break conditions each frame. |
| `PDController.ts` | Proportional-Derivative torque controller. Computes rotation error as axis-angle, applies torque impulse clamped to 500 Nm. Stateless utility. |

### Engine Dependency Graph

```
WorldEngine → PhysicsEngine, CameraManager
HumanoidPhysicsBinder → PhysicsEngine
RagdollBuilder → PhysicsEngine
ObjectManager → AudioEngine
BalanceMonitor ← (RagdollJoint type from RagdollBuilder)
BreakSignalEvaluator ← (RagdollJoint, BalanceState)
MotorProgramExecutor ← (RagdollJoint, BreakSignalEvaluator, BalanceState)
```

### External Consumers

- `useWorld.ts` → imports WorldEngine, PhysicsEngine, AudioEngine, ObjectManager, RagdollBuilder, HumanoidPhysicsBinder
- `CoordinatorContext.tsx` → imports RagdollBuilder

---

## 2. coordinator/src/ — Backend Cognitive Loop

| File | Purpose |
|------|---------|
| `server.ts` | Fastify + WebSocket on port 3001. Routes messages to AgentLoop instances. Manages one AgentLoop per agentId. Handles set_endpoint, set_provider, set_supabase, set_directive, inject_thought, export_request. |
| `agentLoop.ts` | Core 2s cognitive cycle. Dequeue injection → build payload → infer → parse action → send to frontend → wait outcome (5s timeout) → write memory to Supabase. Manages rehydration, skill mastery, motor program saving. |
| `inferenceClient.ts` | Delegates to provider adapters (Kaggle, Gemini, NVIDIA NIM, OpenRouter, Groq, Custom). Streams response, splits at `---ACTION---` separator. 120s initial / 20s inactivity timeouts via AbortController. `setProvider(type, endpoint, apiKey, model)` configures the active provider. |
| `payloadBuilder.ts` | Assembles InferPayload from world state + memories + directives. Strips data URL prefix from frame. Embeds context for vector-similarity memory retrieval. Generates `tactile_context` (qualitative force labels from contact forces), `gaze_context`, and `perception_summary` (spatial grounding text: body state, nearby objects, contact forces, anti-stuck guidance). |
| `memoryManager.ts` | Supabase CRUD for memories. Vector similarity search via `match_memories` RPC. Auto-creates session rows. Uploads frame images to storage bucket. In-memory mock fallback. |
| `motorProgramStore.ts` | Supabase CRUD for motor programs. Loads primitives from disk when offline. |
| `embeddingEngine.ts` | Singleton. Lazy-loads `all-MiniLM-L6-v2` for 384-dim text embeddings via @xenova/transformers. |
| `injectionQueue.ts` | Per-agent FIFO queue for thought injections. |
| `reconnectionManager.ts` | Exponential backoff retry (base 1.5×, max 30s). |
| `supabasePing.ts` | Keepalive ping every 3 days to prevent free-tier pause. |
| `datasetExporter.ts` | Exports memories as LeRobot (Parquet+video) or JSONL format. Zips for delivery. |

---

## 3. WebSocket Protocol — Complete Message Map

### Frontend → Coordinator (8 types)

| Type | Data Fields | Trigger |
|------|-------------|---------|
| `world_state` | frame, joints, audio_pcm, contact_forces, lightState, timestamp, agentId | WorldViewport cycle interval |
| `outcome` | success, reward, description, agentId | Physics fall detection / object interactions |
| `inject_thought` | text, agentId | User types in InjectionInput |
| `set_directive` | mode, goal, agentId | DirectivePanel toggle/button |
| `set_endpoint` | url | ConnectionPanel connect / auto-reconnect (Kaggle only) |
| `set_provider` | type, endpoint, apiKey, model | ConnectionPanel connect (all providers) |
| `set_supabase` | url, key | ConnectionPanel connect / auto-reconnect |
| `export_request` | ExportConfig object | ExportModal start button |

### Coordinator → Frontend (13 types)

| Type | Data Fields | Trigger |
|------|-------------|---------|
| `action` | programSequence, jointOverrides, gazeTarget, agentId | Successful inference + valid JSON parse |
| `thought_token` | token, agentId | Streaming inference (per token) |
| `thought_complete` | agentId | All tokens received |
| `rehydration_token` | token, agentId | AgentLoop.start() boot sequence |
| `rehydration_complete` | agentId | Boot sequence finished |
| `skill_mastered` | skillName, agentId | AI declares skill mastered in memory_write |
| `connection_status` | status, rtt, inferenceTime, agentId | Inference result / reconnection state change |
| `injection_queue_update` | queue, agentId | Injection enqueued / dequeued |
| `memory_saved` | memoryId, tier, agentId | Successful Supabase write |
| `export_progress` | percent, rows | Dataset export progress |
| `export_complete` | filename, rows, sizeBytes, agentId | Export zip written |
| `error` | code, message, agentId | Various failure paths |
| `injection_consumed` | (none) | Dead code — never sent by server |

---

## 4. Payload Schema (InferPayload — 22 fields)

| Field | Type | Source | Required |
|-------|------|--------|----------|
| `frame` | string | PiP canvas → webp base64 (data URL prefix stripped by payloadBuilder) | Yes |
| `audio_pcm` | string | AudioEngine PCM buffer → base64 | Yes |
| `joints` | Record<string, any> | HumanoidPhysicsBinder.getJointState() | Yes |
| `valid_joints` | string[] | Object.keys(joints) | No |
| `upright_preset` | object | Hardcoded {} (TODO) | No |
| `heartbeat` | number | Auto-incrementing counter | Yes |
| `light_state` | string | worldStore.lightState | No |
| `session_id` | string | `session_${agentId}` | No |
| `body_type` | string | worldStore.bodyType | No |
| `current_goal` | string \| null | directives.goal | No |
| `current_rung` | number | worldState.currentRung | No |
| `objects_in_world` | any[] | ObjectManager.getObjects() | No |
| `relevant_memories` | any[] | memoryManager.retrieveRelevant() — top 5 by vector sim | No |
| `recent_working_memories` | any[] | memoryManager.retrieveRecent() — last 3 | No |
| `known_skills` | string[] | Hardcoded [] (TODO) | No |
| `pending_injection` | string \| null | injectionQueue.dequeue() | No |
| `motor_program_library` | string[] | Hardcoded [] (TODO) | No |
| `directive_mode` | string | 'free_will' or 'training' | No |
| `agent_id` | string | AgentLoop config | Yes |
| `contact_forces` | Record<string, any> | HumanoidPhysicsBinder.getContactForces() | No |
| `tactile_context` | string | payloadBuilder.buildTactileContext() — qualitative force labels | No |
| `gaze_context` | string | payloadBuilder — current gaze direction hint for AI | No |
| `perception_summary` | string | payloadBuilder.buildPerceptionSummary() — spatial grounding text (body state, nearby objects, contact forces) | No |

---

## 5. Output Schema (Model Response)

**Stream format:** `<thought tokens>---ACTION---<JSON action block>`

**JSON structure:**
```json
{
  "memory_write": {
    "memory_id": "auto | custom_string",
    "tier": 1|2|3,
    "summary": "one sentence",
    "skill_mastered": null | "skill_name",
    "name_this_memory": null | "custom_name"
  },
  "actions": {
    "program_sequence": ["program_name", ...],
    "joint_overrides": { "joint_name": radians_value }
  },
  "gaze_target": null | { "yaw": radians, "pitch": radians },
  "new_motor_program": null | { ... },
  "flag": null | "requesting_object_hint"
}
```

The InferenceClient splits at `---ACTION---`. Fallback: splits at first `{` if separator not found. Coordinator clamps joint_overrides to [-PI, PI].

---

## 6. Component Connection Chain

```
React Component Tree
  └─ WorldViewport
       ├─ useWorld(containerRef)
       │    ├─ PhysicsEngine (Rapier WASM init)
       │    ├─ AudioEngine (Tone.js init)
       │    ├─ WorldEngine(container, physicsEngine)
       │    │    ├─ CameraManager (3 cameras, render target)
       │    │    └─ Animation loop → onStep callback
       │    ├─ ObjectManager (world objects + collision events)
       │    ├─ HumanoidPhysicsBinder (or RagdollBuilder)
       │    │    └─ getHeadTransform() → CameraManager.update(headMatrix)
       │    └─ Returns: { isReady, captureWorldState(), detectOutcomes() }
       ├─ useCoordinator()
       │    └─ CoordinatorContext (WebSocket hub)
       │         ├─ Reads: connectionStore (endpoint, supabase, inference)
       │         ├─ Writes: agentStore (thoughts, heartbeat, skills)
       │         └─ Dispatches: CustomEvent('synthia:action')
       └─ WorldViewport cycle (setInterval at cycleMs)
            ├─ captureWorldState() → sendMessage('world_state', ...)
            └─ detectOutcomes() → sendMessage('outcome', ...)
```

---

## 7. Store Relationships

| Store | Persistence | Reads | Writes |
|-------|------------|-------|--------|
| `agentStore` | None | ThoughtBank, MemoryViewer, AgentStatus, RehydrationModal, StatusBar | CoordinatorContext, DirectivePanel |
| `worldStore` | localStorage | useWorld (physics/render), BodyControls, PhysicsControls | useWorld, BodyControls, PhysicsControls |
| `connectionStore` | zustand/persist | CoordinatorContext, ConnectionPanel, StatusBar, WorldViewport | ConnectionPanel, CoordinatorContext |
| `uiStore` | None | App.tsx, ExportModal, ObjectSpawner | App.tsx, GodModePanel, ExportModal, ObjectSpawner |
| `logStore` | None | LogViewer | synthiaToast (all toast calls across app) |

---

## 8. God Mode Panel — All Controls

### PhysicsControls
- Gravity slider (-20 to 0, step 0.1) → worldStore.gravity
- Friction slider (0 to 1, step 0.01) → worldStore.globalFriction
- Show Floor toggle → worldStore.showFloor
- Floor Color picker → worldStore.floorColor
- Show Grid toggle → worldStore.showGrid

### BodyControls
- Body Type selector (only 'humanoid' active) → worldStore.bodyType
- Body Mode segmented (rigid/ragdoll) → worldStore.bodyMode
- Full Skeleton toggle → worldStore.simplifiedSkeleton (inverted)
- Joint Debug Markers toggle → worldStore.showDebugJoints
- AI Camera Helper toggle → worldStore.showAICameraHelper
- Movement Smoothing slider (0.05–1.0) → worldStore.movementSmoothing
- Reset Pose button → dispatches stand_upright program

### DirectivePanel
- Training Mode toggle → agentStore.directiveMode + WebSocket set_directive
- Goal textarea → agentStore.currentGoal
- Set Goal / Clear Goal buttons → WebSocket set_directive

### ConnectionPanel
- Endpoint URL input → connectionStore.endpoint (coordinator WebSocket)
- Provider dropdown → connectionStore.provider (kaggle/gemini/nim/openrouter/groq/custom)
- API Key input (session-only, never localStorage) → for Gemini/NIM/OpenRouter/Groq/Custom
- Model input → connectionStore.providerModel (auto-filled per provider)
- Inference Endpoint input → connectionStore.inferenceEndpoint (auto-filled per provider)
- Connect button → sends set_provider (or set_endpoint for Kaggle) + set_supabase via WebSocket
- Status badge (color dot + RTT display)
- Cycle Speed slider (500-5000ms) → connectionStore.cycleMs
- Database accordion: Supabase URL + Anon Key → connectionStore

### Footer
- Spawn button → ObjectSpawner modal
- Export button → ExportModal

---

## 9. Recent Changes — Impact Analysis

### Image Format: JPEG → Webp (useWorld.ts, geminiProvider.ts)

**What changed:** Frame capture switched from `canvas.toDataURL("image/jpeg", 0.7)` to `canvas.toDataURL("image/webp", 0.75)`. Gemini provider now auto-detects mime type from data URL prefix.

| Benefit | Detail |
|---------|--------|
| **~25-30% smaller payloads** | Webp at quality 0.75 produces smaller base64 strings than JPEG at 0.7, directly reducing WebSocket transmission time and inference endpoint POST body size. |
| **Faster cycle times** | Smaller frame = faster upload to coordinator → faster inference request → lower RTT per cycle. At 2s cycle intervals, saving 50-100ms per frame compounds significantly. |
| **Lower Supabase storage costs** | Memory frames stored as webp use less storage bandwidth on the free tier. |
| **Better quality at same size** | Webp's compression algorithm handles sharp edges and flat colours (common in 3D renders) more efficiently than JPEG. |

| Downside | Detail |
|----------|--------|
| **Python PIL/Pillow must support webp** | Pillow includes webp support by default via libwebp, but some minimal Docker/Kaggle images may need `pip install Pillow[webp]`. If webp decode fails, the inference server will return an error for that cycle. |
| **Older browsers lack `toDataURL("image/webp")`** | Chrome 32+, Firefox 65+, Safari 14+ support it. If targeting older browsers, the canvas call returns a PNG fallback (much larger). Not a concern for modern dev environments. |
| **Qwen2.5-VL vision encoder trained on JPEG** | The model was likely fine-tuned on JPEG-compressed images. Webp artifacts differ from JPEG artifacts — in practice this is negligible at quality 0.75+, but worth monitoring for visual quality regressions in the model's spatial reasoning. |
| **OpenAI-compat providers may not support webp** | Some OpenAI-compatible APIs only accept JPEG/PNG. The data URL prefix tells the API the format — if it rejects webp, the fallback is raw base64 without prefix (which defaults to JPEG mime type in the provider). |

### Contact Force Sensing (PhysicsEngine.ts, HumanoidPhysicsBinder.ts, ObjectManager.ts, payloadBuilder.ts, kaggle_new.py)

**What changed:** Rapier `drainContactForceEvents()` feeds a registry mapping collider handles → contact state. Humanoid capsule collider has `CONTACT_FORCE_EVENTS` enabled. All spawned objects and the ground plane also have `CONTACT_FORCE_EVENTS`. Forces are converted to qualitative labels ("light touch", "moderate force", "firm contact", "strong ground support") and injected into the AI's system prompt as `TACTILE SENSING`.

| Benefit | Detail |
|---------|--------|
| **AI can reason about physical forces** | Before: the AI only knew joint angles and visual input. Now it knows when it's standing on the floor, pressing against a wall, or colliding with an object. |
| **Qualitative labels > raw numbers** | "Your body is pressing against floor with firm contact (12.3 N·s)" is more useful to a language model than a raw float. |
| **Enables balance-aware behaviour** | The AI can detect when ground contact is lost (falling) or when lateral force is high (about to topple). |

| Downside | Detail |
|----------|--------|
| **~200 bytes extra per payload** | The `contact_forces` and `tactile_context` fields add minor overhead to each inference request. |
| **Only the capsule body is sensed** | Individual limb contact is not tracked — the single-capsule approach means the AI can't distinguish "foot touching floor" from "head hitting ceiling". |
| **Force thresholds are tunable but fixed** | The <1 / 1-5 / 5-20 / >20 N·s breakpoints are hardcoded in `buildTactileContext()`. Different body masses or gravity settings may need different thresholds. |

### Flexible Inference Provider System (coordinator/src/providers/*, connectionStore.ts, ConnectionPanel.tsx)

**What changed:** Single hardcoded Kaggle endpoint replaced with 6 provider adapters: Kaggle, Gemini, NVIDIA NIM, OpenRouter, Groq, Custom. Provider selection via God Mode UI dropdown. API key stored in sessionStorage only (never localStorage).

| Benefit | Detail |
|---------|--------|
| **No vendor lock-in** | Can switch between Kaggle (free GPU), Gemini (fast), Groq (fastest), NIM (NVIDIA hardware), OpenRouter (model variety) without code changes. |
| **API key security** | sessionStorage-only storage means the key lives in memory for the tab session and is deleted on tab close. No persistent key in localStorage. |
| **OpenAI-compat adapter covers 4 providers** | NIM, OpenRouter, Groq, and Custom all share the same chat completions API format — one adapter handles all of them. |
| **Gemini adapter handles inline images** | Converts the frame to `inlineData` format natively instead of wrapping in a data URL, which Gemini's API prefers. |

| Downside | Detail |
|----------|--------|
| **6 adapters to maintain** | Each provider has subtle API differences (SSE format, error shapes, rate limits). The OpenAI-compat adapter is shared, but Gemini and Kaggle are separate code paths. |
| **API key must be re-entered per session** | By design (security), but users may find it inconvenient compared to persistent storage. |
| **Model naming is provider-specific** | `meta/llama-3.1-8b-instruct` on NIM ≠ `meta-llama/llama-3.1-8b-instruct` on OpenRouter. The UI auto-fills defaults but users must know the correct model string for their provider. |

### AI-Controlled Eye Movement (CameraManager.ts, agentLoop.ts, payloadBuilder.ts, kaggle_new.py, CoordinatorContext.tsx, useWorld.ts, ModelInputPiP.tsx)

**What changed:** AI can now output `gaze_target: {"yaw": rad, "pitch": rad}` in its action JSON. CameraManager applies lerp-smoothed (0.1/frame) gaze offsets to the AI perception camera. PiP view has a crosshair reticle.

| Benefit | Detail |
|---------|--------|
| **Active vision** | The AI can look left/right/up/down within ±0.23 rad (≈13°) of centre without rotating its head, mimicking saccadic eye movement. |
| **Smooth natural motion** | Lerp at 0.1/frame produces gradual eye movement, not jerky snaps. At 60fps this takes ~10 frames (167ms) to reach the target — similar to human saccade latency. |
| **Enables visual exploration** | The AI can scan the environment for objects, look at things it wants to interact with, or look away from threatening stimuli. |
| **Crosshair provides feedback** | Users can see where the AI is looking in the PiP view, making the AI's attention observable. |

| Downside | Detail |
|----------|--------|
| **Clamped to ±0.4 rad** | The AI can't look behind itself — eye movement is limited to ~23° from centre. Full head rotation would be needed for wider arcs. |
| **Approximate world-space offset** | `setGazeTarget()` converts a world point to an offset relative to the current head position, but the rotation is applied in the current frame's head space. Fast head movement can desync the gaze target. |
| **Adds 1 field to action JSON** | The model must learn to output `gaze_target` correctly. Invalid JSON (e.g. missing quotes) will cause the action parser to drop the gaze field silently. |
| **Crosshair is static** | The reticle doesn't move with the gaze offset — it's always centred in the PiP. A dynamic crosshair would require passing gaze offset to the PiP component. |

---

### Egocentric VLA Frame Capture (CameraManager.ts, WorldEngine.ts, useWorld.ts)

**What changed:** AI perception camera now renders into a dedicated 448×448 `WebGLRenderTarget` (matching Qwen2.5-VL's native tile size). `captureAIFrame()` reads pixels with vertical flip correction (OpenGL bottom-up → canvas top-down), converts to WebP base64 at quality 0.7. The PiP display continues to use the separate 480×270 render target.

| Benefit | Detail |
|---------|--------|
| **Correct resolution for model** | 448×448 matches Qwen2.5-VL's native tile size — no internal resize needed |
| **Dedicated offscreen buffer** | User's view is never affected by AI frame capture |
| **Vertical flip correction** | Floor appears at bottom of captured image, sky at top |
| **WebP base64 only** | No data URL prefix — providers receive raw base64 |

### Smooth Joint Lerping (HumanoidPhysicsBinder.ts, worldStore.ts, BodyControls.tsx)

**What changed:** Joint targets are now lerped toward their desired values at a configurable speed (default 0.12 = 12% per frame). `setMotorTargets()` stores targets, `updateMotorTargets()` called every animation frame produces smooth continuous movement. Configurable via "Movement Smoothing" slider in God Mode.

| Benefit | Detail |
|---------|--------|
| **Invisible latency** | 2s AI inference gaps appear as smooth 300ms movements |
| **Configurable speed** | 0.05 = dreamy, 0.12 = natural, 1.0 = instant snapping |
| **Rigid mode only** | Ragdoll mode uses physics directly — no lerping |

### Enhanced Perception Context (payloadBuilder.ts, providers, kaggle_new.py)

**What changed:** Added `buildPerceptionSummary()` that generates spatial grounding text from joint state and world state. Includes body orientation, fallen detection, nearby objects within 5m, and contact forces. Sent alongside the image frame to all providers. Added anti-stuck instruction to free will directive.

| Benefit | Detail |
|---------|--------|
| **Spatial grounding** | AI knows where it is even when visual field is empty |
| **Anti-stuck guidance** | AI rotates head when facing a blank surface |
| **Object proximity** | AI knows what's within 5m without relying on vision |

### Export/Supabase Audit Fixes (memoryManager.ts, datasetExporter.ts)

**What changed:** Frame upload path changed from `.jpg` to `.webp`, content type updated to `image/webp`. Dataset exporter downloads frames with correct `.webp` extension. Ensures consistency between capture format and storage format.

### AI Pipeline Fixes (useWorld.ts, payloadBuilder.ts, agentLoop.ts, kaggle_server.py)

**What changed:** Addressed several critical gaps in the AI pipeline identified during the audit:
- Sent `objects_in_world` in the world state.
- Wired `motor_program_library` and `known_skills` correctly into the payload.
- Extracted and forwarded the `upright_preset`.
- Suppressed false positive "empty action" toasts for actions with valid program sequences.
- Synchronized the heartbeat counter to the UI.
- Logged unknown joint names for debugging mismatches.
- Safely parsed nested `gaze_target` data and updated the prompt contract.
- Added graceful fallback for silent audio cycles to prevent CLAP failures.

| Benefit | Detail |
|---------|--------|
| **Fixed AI Blindness** | The AI can now perceive objects to interact with (e.g. pianos). |
| **Accurate Motor Libraries** | The AI knows which motor programs exist rather than seeing an empty list. |
| **Self-Correction** | Supplying the `upright_preset` allows the AI to reference what standing upright looks like. |
| **Stable CLAP Encoding** | Omitting empty audio arrays prevents Python crashes on the inference server. |

---

## Physics Realism & Embodiment Session (Jul 2026)

### Anatomical Joint Limits & Velocity Safety (Section 1)

| File | Change |
|------|--------|
| `src/constants/anatomicalLimits.ts` | **NEW** — Human ROM limits per joint category (knee, elbow, hip, shoulder, etc.), `clampToAnatomicalLimit()`, `getRagdollJointLimits()`, `MAX_LINEAR_VELOCITY=8`, `MAX_ANGULAR_VELOCITY=12`, `WORLD_BOUNDARY_RADIUS=50` |
| `HumanoidPhysicsBinder.ts` | `setMotorTargets()` returns `{ applied, rejected }`; clamps targets; removed per-frame velocity accumulation bug; `resetPose()`, `isOutOfWorldBounds()`; capsule no longer locked in rigid mode (allows toppling) |
| `RagdollBuilder.ts` | Revolute joints use `limitsEnabled` + `limits`; spherical joints get swing/twist limits via `getRagdollJointLimits()` |
| `PhysicsEngine.ts` | Post-step velocity clamp on registered humanoid/ragdoll bodies |
| `useWorld.ts` | Auto-reset when humanoid exceeds world boundary radius |

### Action Rejection Feedback Loop (Section 2)

| File | Change |
|------|--------|
| `useWorld.ts` | Sends `action_feedback` WebSocket message when joints rejected |
| `coordinator/agentLoop.ts` | `recordActionFeedback()`, included once in next payload as `physical_feedback` |
| `coordinator/payloadBuilder.ts` | Builds human-readable rejection strings |
| `coordinator/server.ts` | Handles `action_feedback` message type |
| `kaggle_server.py`, `geminiProvider.ts`, `openaiCompatProvider.ts` | Physical feedback + environmental awareness prompt blocks |

### Reset Pose & Full Reset (Section 3)

| File | Change |
|------|--------|
| `BodyControls.tsx` | Dispatches `synthia:resetPose` (was incorrectly sending stand_upright action) |
| `HumanoidPhysicsBinder.resetPose()` | Resets capsule translation/rotation/velocities + bind pose + motor targets to upright_preset |
| `RagdollBuilder.resetToSpawn()` | Resets ragdoll root position and zeroes velocities |
| `useWorld.ts` | Shift+R full reset: reset pose + delete all spawned objects |

### TransformControls Dragging (Section 4)

| File | Change |
|------|--------|
| `CameraManager.ts` | OrbitControls disabled during drag; `onDragChanged` callback; `updateMatrixWorld()` each frame |
| `ObjectManager.ts` | Skips `syncVisuals()` for object being dragged (prevents physics overwriting gizmo movement) |
| `WorldEngine.ts` | Selection prefers objects with `userData.objectId` |
| `useWorld.ts` | Walks parent chain to find objectId; syncs Rapier body on drag end |

### Model Input PiP Rebuild (Section 5)

| File | Change |
|------|--------|
| `worldStore.ts` | `lastAIFrameForDisplay` + `setLastAIFrameForDisplay()` |
| `WorldEngine.ts` | Throttled store update (~200ms) after `captureAIFrame()`; removed DOM polling / `_synthia_has_frame` hack |
| `ModelInputPiP.tsx` | React `<img>` bound to store — proper reactive data flow |
| `StatusBar.tsx` | Guards on `inferenceTime`, `rtt`, `frameSize`, `fps`, `cycleMs` — fixes "undefineds" bug |

### 3D Model Upload (Section 7)

| File | Change |
|------|--------|
| `src/utils/uploadedModelsStore.ts` | **NEW** — IndexedDB persistence via `idb-keyval` |
| `ModelPreview.tsx` | **NEW** — Mini Three.js preview pane with bounding box dimensions |
| `ObjectSpawner.tsx` | **Custom** tab: upload .glb/.gltf, preview, terrain toggle, save & spawn, My Uploaded Models list |
| `ObjectManager.spawnCustomModel()` | Trimesh collider for terrain, convex hull for dynamic objects |
| `useWorld.ts` | Handles `synthia:spawnCustom` with placement logic (skips humanoid overlap check for terrain) |

### Export Audit (Section 8)

| File | Change |
|------|--------|
| `datasetExporter.ts` | LeRobot now writes `meta/stats.json` + `meta/tasks.jsonl`; **CSV export implemented** (`heartbeat,tier,thought,action_json,outcome,reward,session_id`); JSONL includes `session_id` |
| `ExportModal.tsx` | Session picker queries Supabase REST API; disabled with tooltip when Supabase not configured |

### WebSocket Additions

| Type | Direction | Purpose |
|------|-----------|---------|
| `action_feedback` | Frontend → Coordinator | Reports rejected joint actions with anatomical limit details |
