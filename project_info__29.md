# Synthia-1 — MuJoCo WASM Migration: Complete Codebase Analysis & 5-Phase Refactor Prompts

## Analysis Date: July 20, 2026
## Purpose: Provide Jules with phased, comprehensive prompts to migrate Synthia from Rapier3D to MuJoCo WASM while maintaining codebase stability as priority "a".

---

# PART 0: EXECUTIVE ASSESSMENT & TECHNICAL VULNERABILITY AUDIT

## 0.1 Executive Assessment

The provided refactor plan is **exceptionally well-structured, methodical, and architecturally sound** in its high-level design. It correctly identifies the core issue in Synthia-1: Rapier's impulse-based solver fighting manual external PD torques at high stiffness values. The proposed 5-phase incremental approach—building a parallel engine under a feature flag (`useMuJoCo`) before deprecating Rapier—is the gold standard for zero-downtime refactoring.

However, a critical review reveals several **hidden technical landmines, WASM API misunderstandings, and physics formulation gaps** that will cause failure or severe performance degradation during execution if not corrected in the prompts before handing off to Jules.

---

## 0.2 Key Technical Vulnerabilities & Gaps

### 0.2.1 MuJoCo WASM Package & API Reality Gap (Phase 1)

* **Package Identity**: The prompt leaves package selection ambiguous (`mujoco-wasm`, `@mujoco/wasm`). As of DeepMind's official releases, the standard, actively maintained package is **`@mujoco/mujoco`**.
* **Memory Pointer Live Views**: MuJoCo WASM relies heavily on live `TypedArray` views pointing directly into WASM heap memory (`data.qpos`, `data.qvel`, `data.ctrl`). Direct mutation or reading of these views is near-zero-overhead, but any WASM heap reallocation (e.g., loading a new asset or resizing structures) **invalidates previous JS array references**. Jules must be explicitly warned to re-acquire array views or copy values rather than caching array references long-term.
* **Contact API Gotcha**: Calling C-level contact functions (e.g., `mj_contactForce`) in JavaScript requires passing WASM-heap buffers (`DoubleBuffer`). Passing standard JS `Float64Array` buffers directly can return uninitialized memory or cause silent failures.

### 0.2.2 The Dynamic Object Spawning Bottleneck (Phase 4)

This is the single biggest architectural friction point between Rapier and MuJoCo.

* **Rapier**: Truly dynamic world graph. Rigid bodies and colliders can be instantiated and deleted at runtime on any frame (`world.createRigidBody()`).
* **MuJoCo**: The `mjModel` struct is a **compiled, static C representation**. You cannot arbitrarily add new dynamic bodies or geoms to an active `mjModel` at runtime without:
  1. **Rebuilding the MJCF string and reloading the model** (`mj_loadXML`), which allocates a new `mjData`, resets all simulation states/history, wipes active contacts, and introduces noticeable JS thread stutters (100ms+ per reload).
  2. **Pre-allocating a pool of dummy geoms/bodies** in the initial MJCF, controlling their visibility/active state by setting geom dimensions (`size="0 0 0"`) or toggling collision bitmasks (`contype="0"`).

> **Crucial Correction for Phase 4 Prompt**: Jules should be instructed to implement a **Body/Geom Pre-Allocation Pool** (e.g., 20 pooled dynamic bodies) for environment objects, reserving XML re-compilation strictly for complete scene resets or initial load.

### 0.2.3 Ball Joint Actuators in MJCF vs. Synthetic Torques (Phase 3)

* **The Assumption**: Prompt 3.3 suggests testing `<position joint="ball_joint"/>` or driving spherical joints directly via scalar target values.
* **The Physics Reality**: In native MJCF, standard `<position>` actuators only drive **1-DOF joints** (`hinge` or `slide`). MJCF **does not** support driving a 3-DOF `ball` joint with a single `<position>` actuator.
* **Required Resolution**:
  To achieve 3-DOF rotational control per spherical joint (e.g., shoulder, hip, spine) in MuJoCo, Jules must either:
  1. **Decompose spherical joints into three nested 1-DOF hinge joints** (Yaw, Pitch, Roll) with explicit axes and individual `<position>` actuators.
  2. **Use `<motor>` actuators on ball joints** and feed torque vectors directly in local joint space (less recommended, as it reintroduces manual PD torque math).

### 0.2.4 Coordinate System Conversion Risk (Phase 2 & 3)

* **Three.js / Rapier**: Right-handed, **Y-up** (+X right, +Y up, +Z forward/out).
* **MuJoCo**: Right-handed, **Z-up** (+X right, +Y forward, +Z up).
* **Impact**: Simply rotating gravity to `[0, -9.81, 0]` in MuJoCo does *not* completely fix local bone orientation matrices, joint limits, or visual bone synchronizations.
* **Fix**: The cleanest pattern in MuJoCo is setting the world body compiler orientation to align world axes, or applying a global transform root frame:

```xml
<compiler angle="radian" coordinate="local"/>
<option gravity="0 0 -9.81"/>
```

And explicitly mapping Three.js bone world positions via a standard matrix transformation:

$$\mathbf{p}_{\text{mujoco}} = (x, z, -y)$$

### 0.2.5 Root Capsule & K-GRF Balance Logic (Phase 3 & 5)

* In Synthia's current pipeline, the root capsule has an active balance PD loop (`BALANCE_KP = 200`) applying external torque to keep the main capsule upright.
* In MuJoCo, a root body attached with `<freejoint>` has 6 unconstrained DOFs. It **cannot** accept position actuators directly.
* Jules must implement capsule balance either by:
  * Applying global feedback forces directly into `data.xfrc_applied` for the root body on each frame, or
  * Using MuJoCo equality constraints (`<weld>` or `<connect>`) attached to target kinematic anchors.

---

## 0.3 Recommended Refactor Plan Amendments

Before passing these prompts to Jules, add the following target overrides to the respective phase descriptions:

| Phase | Section | Required Amendment / Pre-Requisite |
| --- | --- | --- |
| **Phase 1** | Dependencies | Explicitly specify `@mujoco/mujoco` as the npm dependency. Mandate wrapping memory accesses around live views into helper getters that re-evaluate pointers after step cycles. |
| **Phase 2** | MJCF Generation | Enforce **1-DOF Hinge Decomposition** for all 3-DOF joints (shoulders, hips, spine) to allow clean native `<position>` position actuators. |
| **Phase 3** | Motor Control | Explicitly define that root capsule balance must use `sim.data.xfrc_applied` for external upright torques rather than native position actuators. |
| **Phase 4** | Object Spawning | Mandate a **Pre-allocated Object Slot Pool** in `generateHumanoidMJCF()` to avoid running `mj_loadXML` at 60 FPS during runtime object spawning. |
| **Phase 5** | Gains & Tuning | Provide a baseline conversion factor: MuJoCo `<position>` $k_p$ values typically scale down by $0.25\times$ to $0.5\times$ relative to explicit impulse external torque gains due to implicit solver integration. |

---

## 0.4 Verdict

The blueprint is **90% complete and highly actionable**. Once updated with the specific structural limitations of MuJoCo's WASM bindings (object pooling, hinge joint decomposition, and buffer view invalidation), Jules will have an airtight, production-ready roadmap for migration.

---

# PART 1: COMPLETE CODEBASE ARCHITECTURE MAP

## 1.1 Executive Summary

Synthia-1 is a browser-based 3D humanoid physics sandbox with AI-powered motor control. It consists of:

- **Frontend**: React 18 + Vite 8 + Three.js 0.184 + Rapier3D 0.19.3 (WASM physics)
- **Coordinator**: Node.js/Fastify server handling AI inference, memory management, Supabase persistence
- **Physics Pipeline**: 4-layer architecture from raw WASM world → capsule body → multi-body PD torque control → AI motor targets

The single biggest technical debt item is the manual PD torque control system in `HumanoidMultiBodyManager.ts` (~300 lines of quaternion math per frame applied as external torques). Rapier's impulse-based solver goes unstable at high stiffness values (>600), which led to the creation of a jitter diagnostic tool. MuJoCo's soft-constraint solver eliminates this entire class of problem.

## 1.2 Complete Directory Structure (Physics-Relevant)

```
Synthia-1/
├── src/
│   ├── main.tsx                          — React entry point
│   ├── App.tsx                           — Root component
│   ├── constants/
│   │   ├── physics.ts                    — Collision groups (RAGDOLL_GROUP, ENVIRONMENT_GROUP), mass/inertia matrix
│   │   ├── rigConstraints.ts             — Joint DOF/limit definitions per bone (~60 bones, allowance system)
│   │   ├── anatomicalLimits.ts           — Anatomical ROM limits, velocity clamps, world boundaries
│   │   ├── bodyTypes.ts                  — Body type configs (humanoid, quadruped, robotic_arm, custom)
│   │   ├── objectPresets.ts             — Spawnable object presets (cube, sphere, piano, etc.)
│   │   ├── progressionLadder.ts         — AI skill progression ladder
│   │   └── strings.ts                   — UI strings
│   ├── types/
│   │   ├── joint.ts                      — JointLimit, ActionFrame, TimelineSequence, ValidateResult types
│   │   ├── world.ts                      — WorldObject, Vector3, BodyType, BodyMode, CameraMode types
│   │   ├── agent.ts                      — Agent state types
│   │   ├── payload.ts                    — InferPayload type
│   │   └── export.ts                     — Export types
│   ├── store/
│   │   ├── worldStore.ts                 — Zustand: gravity, friction, bodyType, bodyMode, cameraMode, useMultiBodyPD, etc.
│   │   ├── agentStore.ts                 — Agent state, heartbeat, currentGoal, currentRung
│   │   ├── connectionStore.ts            — WebSocket/connection metrics
│   │   ├── logStore.ts                   — Thought/action logging
│   │   └── uiStore.ts                    — UI panel state, selected entity
│   ├── world/
│   │   ├── engine/
│   │   │   ├── PhysicsEngine.ts          — ⚡ RAPIER.World owner, step(), event draining, velocity clamping
│   │   │   ├── HumanoidPhysicsBinder.ts  — ⚡ Capsule body, K-GRF ground reaction, timeline interpolation, motor targets
│   │   │   ├── HumanoidMultiBodyManager.ts — ⚡ Per-bone rigid bodies + manual PD torque (THE PAIN POINT)
│   │   │   ├── RapierJointMotorController.ts — ⚡ Wraps Rapier revolute motor API (spherical unsupported)
│   │   │   ├── AvatarSynchronizer.ts     — Syncs rigid body transforms → Three.js bone quaternions (topological sort)
│   │   │   ├── ObjectManager.ts          — Spawns/manages environment objects with Rapier colliders
│   │   │   ├── WorldEngine.ts            — Three.js scene, renderer, lights, animation loop, frame capture
│   │   │   ├── CameraManager.ts          — 3 cameras (3rd person, chase, AI perception), OrbitControls, TransformControls
│   │   │   ├── ObservationBuilder.ts     — Builds proprioceptive observations for AI (proj gravity, local vel, joint angles)
│   │   │   ├── PhysicsDiagnostic.ts      — Runtime jitter diagnostic (angular speed, oscillation, torque clamp rates)
│   │   │   ├── ProceduralHumanoidBuilder.ts — Builds procedural humanoid from BODY_PARTS array (Rapier bodies/joints)
│   │   │   ├── ProceduralMotorController.ts — Manual PD torque for procedural model (SPHERICAL → manual torque)
│   │   │   ├── RagdollBuilder.ts         — General-purpose ragdoll builder from BodyTypeConfig
│   │   │   └── AudioEngine.ts            — Tone.js-based audio synthesis
│   │   ├── hooks/
│   │   │   ├── useWorld.ts               — Main initialization hook: creates all engine instances, wires event listeners
│   │   │   └── useCoordinator.ts         — WebSocket hook for coordinator communication
│   │   ├── contexts/
│   │   │   └── CoordinatorContext.tsx     — React context for coordinator
│   │   └── programs/
│   │       └── primitives/
│   │           └── stand_upright.json    — Motor program preset
│   ├── components/                        — React UI components (not migration-critical)
│   └── utils/
│       ├── logger.ts
│       └── toastUtils.ts
├── coordinator/
│   └── src/
│       ├── server.ts                     — Fastify WebSocket server
│       ├── agentLoop.ts                  — Main AI cycle: inference, memory write, motor program store
│       ├── payloadBuilder.ts             — Assembles InferPayload from world state + memories + embeddings
│       ├── inferenceClient.ts            — Routes inference to provider
│       ├── memoryManager.ts              — Supabase CRUD for episodic memory
│       ├── motorProgramStore.ts          — Supabase CRUD for learned motor programs
│       ├── embeddingEngine.ts            — Xenova all-MiniLM-L6-v2 embeddings
│       ├── injectionQueue.ts             — Human-injected thought queue
│       ├── reconnectionManager.ts        — Exponential backoff for inference retry
│       ├── datasetExporter.ts            — Training dataset export
│       └── providers/
│           ├── types.ts                  — InferenceProvider interface
│           ├── providerFactory.ts        — Provider selection
│           ├── geminiProvider.ts         — Google Gemini API
│           ├── openaiCompatProvider.ts   — OpenAI-compatible API (OpenRouter, Groq, NIM, custom)
│           └── kaggleProvider.ts         — Kaggle inference endpoint
└── public/
    └── models/
        └── x-bot.glb                     — Mixamo humanoid GLB model

⚡ = Files requiring significant changes for MuJoCo migration
```

## 1.3 The Physics Pipeline (Current State — Rapier)

```
Layer 4: AI Coordinator (agentLoop.ts, payloadBuilder.ts)
         │  sends joint_overrides / sequence / program_sequence
         ▼
Layer 3: HumanoidPhysicsBinder.ts
         │  validateAndApplyTimeline() — clamps via rigConstraints + anatomicalLimits
         │  setMotorTargets() — parses scalar/euler/quaternion payloads
         │  updateMotorTargets() — lerps kinematic bones, delegates to multiBodyManager
         │  syncVisuals() — raycasts for ground, applies K-GRF, updates modelRoot
         │  timeline interpolation between ActionFrames
         ▼
Layer 2: HumanoidMultiBodyManager.ts  ← THE PAIN POINT
         │  setTargets(currentTargets) — for each bone:
         │    1. Compute current relative quaternion (child vs parent body)
         │    2. Compute error quaternion vs target from bindPoseRelative
         │    3. Extract error angle + axis from error quat
         │    4. Apply PD torque: stiffness * errorAngle * axis - damping * localAngVel
         │    5. Clamp at MAX_TORQUE = 15.0 Nm
         │    6. body.addTorque(localTorque applied in world frame)
         │  Also applies balance torque to capsule (BALANCE_KP=200, BALANCE_KD=80)
         │  Un-targeted bones pulled to bind pose with same PD math
         ▼
Layer 1: PhysicsEngine.ts
         │  RAPIER.World.step(eventQueue) at 60 Hz
         │  Drains contact force events → contactForceRegistry
         │  Clamps linear/angular velocities on registered bodies
         │  Mutation lock (isMutatingWorld) prevents stepping during body creation
         ▼
Layer 0: WASM: @dimforge/rapier3d-compat (~600 KB)
```

## 1.4 Complete File Inventory — What Touches Rapier

| File | Rapier Dependency Level | Migration Strategy |
|------|------------------------|-------------------|
| `PhysicsEngine.ts` | 100% — every method uses RAPIER types | **COMPLETE REWRITE** as MuJoCoPhysicsEngine |
| `HumanoidPhysicsBinder.ts` | ~40% — capsule body, raycast, K-GRF | **MAJOR REFACTOR** (~800 lines change) |
| `HumanoidMultiBodyManager.ts` | 90% — rigid bodies, joints, torque | **ELIMINATED** — replaced by MuJoCo actuators |
| `RapierJointMotorController.ts` | 100% — Rapier motor API | **ELIMINATED** — replaced by MuJoCo actuators |
| `ObjectManager.ts` | 60% — colliders, rigid bodies, events | **MODERATE REFACTOR** — MuJoCo geom API |
| `ProceduralHumanoidBuilder.ts` | 80% — bodies, colliders, joints | **MODERATE REFACTOR** → MJCF XML generator |
| `ProceduralMotorController.ts` | 70% — manual PD torque | **ELIMINATED** — replaced by MuJoCo actuators |
| `RagdollBuilder.ts` | 90% — bodies, colliders, joints | **ELIMINATED** — replaced by MJCF template |
| `AvatarSynchronizer.ts` | 20% — only reads `.rotation()` / `.translation()` | **MINIMAL** — change accessor pattern |
| `ObservationBuilder.ts` | 20% — only reads `.rotation()` / `.translation()` | **MINIMAL** — change accessor pattern |
| `PhysicsDiagnostic.ts` | 50% — peeks into private fields | **REWRITTEN** — simpler with MuJoCo data |
| `WorldEngine.ts` | 0% (only stores PhysicsEngine ref) | **NO CHANGE** |
| `CameraManager.ts` | 0% | **NO CHANGE** |
| `AudioEngine.ts` | 0% | **NO CHANGE** |
| `useWorld.ts` | 15% — imports Rapier types indirectly | **LIGHT** — new engine class import |
| `constants/physics.ts` | 10% — collision group constants | **LIGHT** — adapt to contype/conaffinity |
| `constants/rigConstraints.ts` | 0% | **NO CHANGE** |
| `constants/anatomicalLimits.ts` | 0% | **NO CHANGE** |
| `worldStore.ts` | 0% | **LIGHT** — add `useMuJoCo` flag |
| **Coordinator (all files)** | 0% | **NO CHANGE** |

## 1.5 Critical Data Flow Paths

### Path 1: AI Action → Physics
```
agentLoop.ts (parseAndValidateAction)
  → window event 'synthia:action' { jointOverrides, sequence, programSequence }
  → useWorld.ts handleAction
  → binder.validateAndApplyTimeline(skeleton, sequence)
  → binder.setMotorTargets(frame.overrides)
  → binder.updateMotorTargets() [called every frame in animation loop]
    → multiBodyManager.setTargets(currentTargets)
      → for each bone: compute error quat → PD torque → body.addTorque()
```

### Path 2: Physics Step → Visual Sync
```
WorldEngine.start() animation loop
  → physicsEngine.step()
    → world.step(eventQueue)  // Rapier internal
    → clampRegisteredBodyVelocities()
    → drainContactForceEventsInternal()
  → objectManager.update(eventQueue) + syncVisuals()
  → binder.updateMotorTargets()
  → binder.syncVisuals()
    → raycast for ground
    → applyKinematicGroundReactionForces()  // K-GRF
    → multiBodyManager.syncVisuals(boneInfoMap, skeleton)
      → avatarSynchronizer.synchronize(bonesMap, rigidBodies)
```

### Path 3: Collision Detection
```
physicsEngine.step() → eventQueue.drainCollisionEvents() / drainContactForceEvents()
  → contactForceRegistry (Map<colliderHandle, ColliderContactState>)
  → activeCollisions (Map<key, {started, lastUpdate}>)

ObjectManager.update(eventQueue) → separate drainCollisionEvents()
  → piano note detection via collider._synthiaNote
  → button press detection via preset matching
```

## 1.6 Key Invariants (Must Stay True)

1. **Mutation Lock**: During body/joint creation/deletion, `isMutatingWorld = true` prevents `step()`. MuJoCo needs equivalent protection.
2. **Coordinate Systems**: Rapier and Three.js use identical right-handed coordinates. MuJoCo also uses right-handed SI units — no conversion needed.
3. **Quaternion Convention**: Both use (x, y, z, w) order. MuJoCo matches. Direct copy works.
4. **Velocity Clamping**: `MAX_LINEAR_VELOCITY = 8.0`, `MAX_ANGULAR_VELOCITY = 6.0`. Must be preserved in MuJoCo (either via `sim.model.opt` or post-step clamping).
5. **Fixed Timestep**: 1/60 second with accumulator capping at 0.25s. MuJoCo can use the same pattern.
6. **Gravity**: (0, -9.81, 0) in Rapier → `sim.model.opt.gravity = [0, 0, -9.81]` in MuJoCo (Z-up by default, but can be configured).
7. **Skeleton Hierarchy**: Topological sort ensures parent bones sync before children. Must be preserved in MJCF body hierarchy.
8. **Timeline System**: `validateAndApplyTimeline()` → `timelineQueue` → interpolation in `syncVisuals()`. Completely independent of physics engine.
9. **K-GRF**: Kinematic Ground Reaction Forces computed from foot bone positions vs ground. Only the foot contact detection API changes.
10. **AI Frame Capture**: 448×448 WebP base64 frame from offscreen render target. Independent of physics engine.

---

# PART 2: THE 5 PHASES — COMPREHENSIVE PROMPTS FOR JULES

## IMPORTANT INSTRUCTIONS FOR JULES

Before each phase, read this:

> **CRITICAL**: The project_info__27.md and project_info__29.md files describe the migration plan, but they were written at a point in time and may be outdated. Trust the actual code over these documents. Always read the source files yourself to verify what needs to change. These prompts describe the WHAT and WHERE at a high level, but YOU must determine the HOW by reading the actual code. Do not blindly follow the prompt — use it as a map, not a script.

> **STABILITY RULE**: Codebase stability is priority "a" — the single most important constraint. After EVERY change, the system MUST remain in a working state. Use feature flags (like `useMuJoCo` in worldStore) to keep the Rapier path fully operational while building the MuJoCo path in parallel. Never delete working Rapier code until the MuJoCo replacement is verified. The user must be able to switch between Rapier and MuJoCo at any time during migration.

> **COMMIT STRATEGY**: Commit after every stable checkpoint. If something breaks, revert to the last stable commit.

---

## PHASE 1: MuJoCo WASM Integration & PhysicsEngine Adapter

**Goal**: Get MuJoCo WASM loading, create a parallel PhysicsEngine, prove the concept with a simple test scene.

**Stability checkpoint**: At the end of this phase, BOTH Rapier and MuJoCo engines can initialize independently. The Rapier path is completely unchanged. A `useMuJoCo` flag in worldStore toggles between them.

### Files to CREATE (new):

1. **`src/world/engine/MuJoCoPhysicsEngine.ts`**
   - Create a class that mirrors `PhysicsEngine.ts`'s public API but uses MuJoCo WASM internally
   - Public interface must match: `init()`, `step()`, `setReady()`, `setMutating()`, `setGravity()`, `isReady`, `isStepping`, `isMutating`, `isBroken`, `getContactForceRegistry()`, `registerVelocityClampBody()`, `unregisterVelocityClampBody()`, `drainEvents()`, `flushEventQueue()`, `cleanup()`
   - Internal: loads `mujoco-wasm` (npm install this first), creates a `mj.Model` from a minimal MJCF string with a ground plane, creates a `mj.Data`, runs `mj.step()`
   - MuJoCo coordinate convention: Z-up by default. You may need to set gravity to `[0, 0, -9.81]` and rotate the ground plane accordingly, OR configure MuJoCo to use Y-up by rotating the world. Read the MuJoCo WASM docs to decide.
   - Velocity clamping: MuJoCo doesn't have built-in per-body velocity clamps. Implement post-step clamping by iterating bodies and checking `sim.data.qvel`.
   - Contact force registry: MuJoCo stores contacts in `sim.data.contact` array. Map this to the existing `ColliderContactState` interface.
   - Mutation lock: Use the same `isMutatingWorld` flag pattern. In MuJoCo, modifying the model during simulation requires `mj.reload()` or careful ordering.
   - **Key challenge**: MuJoCo's API is functional (C-style), not object-oriented like Rapier. Bodies are accessed by ID, not reference. You'll need to maintain your own body ID mappings.

2. **`src/world/engine/__tests__/MuJoCoPhysicsEngine.test.ts`**
   - Test that WASM loads without errors
   - Test that `step()` runs 60+ times without WASM memory faults
   - Test gravity setting
   - Test velocity clamping

### Files to MODIFY:

> **⚠️ PHASE 1 CRITICAL CORRECTIONS (from Executive Audit §0.2.1, §0.3):**
> 
> 1. **Package name is `@mujoco/mujoco`**, not `mujoco-wasm`. This is the official DeepMind release. Install: `npm install @mujoco/mujoco`.
> 2. **Memory Live Views**: `data.qpos`, `data.qvel`, and `data.ctrl` are live `TypedArray` views into WASM heap memory. Any WASM heap reallocation (e.g., loading a new model) **invalidates previous JS array references**. Wrap all memory accesses in helper getters that re-acquire array views after each `mj.step()` cycle. Never cache these array references long-term — copy values if you need to hold them across frames.
> 3. **Contact API**: When calling C-level contact functions (`mj_contactForce`), you must pass WASM-heap buffers (`DoubleBuffer`), not standard JS `Float64Array`. Plain JS arrays will return uninitialized memory silently.
> 4. **WASM init is async** — use a static singleton init promise pattern (same as Rapier's `init()`).

3. **`package.json`**
   - Add `@mujoco/mujoco` dependency (the official DeepMind npm package). Do NOT use `mujoco-wasm` or `@mujoco/wasm`.
   - Do NOT remove `@dimforge/rapier3d-compat` yet

4. **`src/store/worldStore.ts`**
   - Add `useMuJoCo: boolean` to WorldState (default `false`)
   - Add `setUseMuJoCo: (enable: boolean) => void` action
   - Persist to localStorage via `saveSession()`

5. **`vite.config.ts`**
   - MuJoCo WASM needs proper MIME types and COOP/COEP headers for SharedArrayBuffer. Add:
     ```ts
     server: {
       headers: {
         'Cross-Origin-Opener-Policy': 'same-origin',
         'Cross-Origin-Embedder-Policy': 'require-corp',
       }
     }
     ```
   - Also configure `optimizeDeps` to exclude `mujoco-wasm` from Vite's pre-bundling (WASM modules need native loading)

6. **`src/world/hooks/useWorld.ts`**
   - Import `MuJoCoPhysicsEngine` (just import, don't use yet)
   - In the `init()` function, add a conditional branch: if `worldStore.useMuJoCo`, instantiate `MuJoCoPhysicsEngine` instead of `PhysicsEngine`. Otherwise use Rapier as before.
   - Log which engine is active
   - **Important**: The MuJoCo engine ref should be stored separately from the Rapier engine ref, OR use a union type. The rest of the codebase currently expects `PhysicsEngine` type. For Phase 1, just create the instance and verify it initializes — don't wire it to the full pipeline yet.

### Prompt for Jules:

```
## PHASE 1: MuJoCo WASM Integration & PhysicsEngine Adapter

### Objective
Get MuJoCo WASM loading in the browser, create a parallel PhysicsEngine class that mirrors the existing Rapier PhysicsEngine's public API, and add a feature flag to toggle between engines. The Rapier path must remain fully operational.

### What to do

1. **Research & install**
   - Find the correct MuJoCo WASM npm package. Check npm for `mujoco-wasm`, `@mujoco/wasm`, or similar. Read its documentation to understand the JavaScript API.
   - Install it: `npm install <correct-package-name>`
   - Read the MuJoCo WASM source/types to understand how to create a model, simulation, step it, and read body transforms.
   - MuJoCo uses Z-up by default. Synthia uses Y-up. Determine whether to rotate the world in MJCF or configure MuJoCo's gravity/quaternion options.

2. **Create MuJoCoPhysicsEngine.ts** (`src/world/engine/MuJoCoPhysicsEngine.ts`)
   - Create a class with the EXACT SAME public interface as `PhysicsEngine.ts`. Read that file carefully — every public method, property, and type export must be matched.
   - The class must expose: `init()`, `step()`, `setReady()`, `setMutating()`, `setGravity()`, `isReady`, `isStepping`, `isMutating`, `isBroken`, `getContactForceRegistry()`, `registerVelocityClampBody()`, `unregisterVelocityClampBody()`, `drainEvents()`, `flushEventQueue()`, `cleanup()`, `getWorld()`, `getEventQueue()`.
   - For `init()`: Load MuJoCo WASM, create a minimal MJCF model with a ground plane, create a simulation. Use the same pattern as Rapier's init — async, with a static singleton WASM init promise.
   - For `step()`: Call `mj.step(sim.model, sim.data)`. Clamp velocities on registered bodies by reading `sim.data.qvel`. Map MuJoCo contact data (`sim.data.contact`) to the same `ColliderContactState` format.
   - For `getWorld()`: Return a MuJoCo world wrapper or the sim reference. You may need to create a minimal wrapper type.
   - Maintain the mutation lock pattern (`isMutatingWorld`) — when true, skip step().
   - Handle errors gracefully with the same `isPhysicsBroken` pattern.

3. **Add feature flag to worldStore** (`src/store/worldStore.ts`)
   - Add `useMuJoCo: boolean` (default `false`) and `setUseMuJoCo` action.
   - Persist to localStorage.

4. **Update vite.config.ts**
   - Add COOP/COEP headers for SharedArrayBuffer support
   - Exclude mujoco-wasm from Vite's dependency optimization

5. **Wire in useWorld.ts** (MINIMAL — Phase 1 only)
   - In the `init()` function in `useWorld.ts`, add a conditional: if `worldStore.useMuJoCo`, create `MuJoCoPhysicsEngine` instead of `PhysicsEngine`. Log which engine is active.
   - Do NOT wire MuJoCo to the full pipeline yet. Just initialize and log.
   - Keep storing the engine ref in a way that the rest of the code doesn't break — the Rapier path is still the default.

6. **Create a basic test** (`src/world/engine/__tests__/MuJoCoPhysicsEngine.test.ts`)
   - Test WASM loading
   - Test step() runs without errors for 60+ frames
   - Test gravity setting
   - Test velocity clamping

### What NOT to change
- DO NOT modify `PhysicsEngine.ts` or any Rapier-dependent file
- DO NOT remove any Rapier code
- DO NOT wire MuJoCo to HumanoidPhysicsBinder, ObjectManager, or any other file
- The application must work exactly as before when `useMuJoCo` is `false` (the default)

### Stability rules
- Commit before starting
- After each file is created/modified, verify the app still builds (`npm run build` or `tsc --noEmit`)
- Test that the Rapier path works normally (set `useMuJoCo: false`)
- Test that MuJoCo initializes without crashing (set `useMuJoCo: true` in console/localStorage)
- If MuJoCo WASM fails to load, the app should gracefully fall back and log an error — do NOT crash

### Key unknowns you MUST investigate
- What is the exact npm package name for MuJoCo WASM? What export does it provide?
- Does MuJoCo WASM require SharedArrayBuffer? If so, the COOP/COEP headers in vite.config.ts are essential.
- What is the MuJoCo convention for Y-up vs Z-up? Do you need to rotate the entire simulation or can you configure gravity?
- How do you create bodies and geoms in MuJoCo via its JavaScript API (not the C API)? Can you use MJCF XML strings, or must you use the programmatic `mj.make*` functions?
- How do you step the simulation? Is it `mj.step(model, data)` or something else in the WASM bindings?
```

---

## PHASE 2: MJCF Humanoid Template & Body/Collider Creation

**Goal**: Convert the humanoid skeleton into an MJCF XML template. Create rigid bodies and collision geoms in MuJoCo that match the current Rapier configuration.

**Stability checkpoint**: At the end of this phase, the humanoid skeleton can be represented as an MJCF string. Bodies and colliders can be created from this template. The Rapier path is unchanged. The MuJoCo path displays the humanoid static bodies (no motors yet).

> **⚠️ PHASE 2 CRITICAL CORRECTIONS (from Executive Audit §0.2.3, §0.2.4, §0.3):**
> 
> 1. **NO `<joint type="ball">` with `<position>` actuators.** Standard `<position>` actuators in MJCF only drive 1-DOF joints (`hinge` or `slide`). A 3-DOF `ball` joint **cannot** be driven by a single `<position>` actuator. Instead, you MUST **decompose every 3-DOF joint (shoulders, hips, spine, neck, head, hands) into three nested 1-DOF hinge joints** (Yaw → Pitch → Roll) with explicit orthogonal axes and individual `<position>` actuators for each axis. This is the only way to achieve clean native PD servo control in MuJoCo.
> 2. **Coordinate system**: MuJoCo is Z-up, Three.js/Rapier is Y-up. Use `<compiler angle="radian" coordinate="local"/>` and `<option gravity="0 0 -9.81"/>`. Apply the transform **p_mujoco = (x, z, -y)** when mapping bone world positions to MuJoCo coordinates.
> 3. **CAPSULE_ATTACH_BONES**: Use `<freejoint>` for these — they connect the capsule to the world, allowing full 6-DOF root motion. Do NOT try to drive the freejoint with position actuators; use `data.xfrc_applied` for upright balance (see Phase 3 corrections).

### Files to CREATE:

1. **`src/world/engine/MJCFHumanoidTemplate.ts`**
   - A module that exports a function `generateHumanoidMJCF(boneInfoMap, skeletonBones, physicsMatrix, rigConstraints): string`
   - Reads the current `COMPLETE_MIXAMO_PHYSICS_MATRIX` from `constants/physics.ts`
   - Reads the joint hierarchy from the boneInfoMap (topological sort of skeleton bones)
   - Generates an MJCF XML string with:
     - `<worldbody>` containing the ground plane
     - A root `<body>` for the capsule (or hips if you decide the hierarchy root)
     - Nested `<body>` elements for each tracked bone, with:
       - `pos` attribute = world position of the bone from boneInfoMap (transformed via **p = (x, z, -y)** from Y-up to Z-up)
       - `<joint>` elements: **hinge ONLY** — decompose spherical joints into 3 nested hinge joints (Yaw, Pitch, Roll) per bone. Knees/elbows remain single hinge.
       - `range` attributes copied from SYNTHIA_RIG_CONSTRAINTS and anatomicalLimits
       - `<geom>` elements with the correct shape (capsule for most bones, box for feet)
       - `<inertial>` mass and diagonal inertia from the physics matrix
     - Collision filtering via `contype`/`conaffinity` attributes
   - Convert all Rapier-specific concepts to MuJoCo equivalents:
     - `RAPIER.ColliderDesc.capsule(halfHeight, radius)` → `<geom type="capsule" size="radius halfHeight" ...>`
     - `RAPIER.JointData.revolute(anchor1, anchor2, axis)` → `<joint type="hinge" pos="..." axis="..."/>`
     - `RAPIER.JointData.spherical(anchor1, anchor2)` → **3 nested `<joint type="hinge">`** elements with axes (1,0,0), (0,1,0), (0,0,1)
     - Collision groups → `contype="1" conaffinity="2"` (RAGDOLL group only interacts with ENVIRONMENT group)
     - `RAPIER.RigidBodyDesc.dynamic()` → bodies without `<freejoint>` are dynamic by default
     - `RAPIER.RigidBodyDesc.fixed()` → not needed for bones (all dynamic)
   - **IMPORTANT**: Study the existing code in `HumanoidMultiBodyManager.activate()` and `ProceduralHumanoidBuilder.build()` to understand exactly which bones get bodies, what collision geometry they use, and how joints are configured. The MJCF template must reproduce this exactly.
   - Include ALL finger bones (thumb/index/middle/ring/pinky segments 1-3) with their micro-mass and inertia values.
   - Include `CAPSULE_ATTACH_BONES` (spine, left upleg, right upleg) — these bones attach to the root capsule in Rapier. In MuJoCo, use `<freejoint>` for these.

2. **`src/world/engine/MuJoCoBodyManager.ts`**
   - A class that takes an MJCF XML string, loads it into a MuJoCo model, and creates the simulation
   - Provides methods parallel to `HumanoidMultiBodyManager`: `activate()`, `deactivate()`, `getRigidBodiesMap()`, `getBoneColliderHandle()`, `getCapsuleBody()`, `syncRigidBodiesFromBones()`
   - Instead of Rapier's `RAPIER.RigidBody` references, you'll work with body IDs (integers) and the MuJoCo data arrays
   - Create a body ID → bone name mapping for lookups
   - `syncRigidBodiesFromBones()` should set `sim.data.qpos` positions and zero out `sim.data.qvel` for all tracked bodies

### Files to MODIFY:

3. **`src/world/engine/MuJoCoPhysicsEngine.ts`** (extend from Phase 1)
   - Add a method `loadMJCFModel(xmlString: string)` that creates the MuJoCo model from MJCF XML
   - Add a method `getModel()` and `getData()` to access the underlying MuJoCo model/data
   - Add body ID tracking: maintain a `Map<string, number>` (boneName → bodyId)
   - Update `step()` to work with the loaded model

4. **`src/world/engine/__tests__/MJCFHumanoidTemplate.test.ts`**
   - Test that `generateHumanoidMJCF()` produces valid XML
   - Test that the XML contains all expected bones (at minimum: spine, spine1, spine2, neck, head, shoulders, arms, forearms, hands, uplegs, legs, feet, fingers)
   - Test that joint types are correct (knees/elbows = hinge, shoulders/hips = ball)
   - Test that collision geoms have correct dimensions

### Prompt for Jules:

```
## PHASE 2: MJCF Humanoid Template & Body/Collider Creation

### Objective
Convert the humanoid skeleton hierarchy, joint structure, body masses/inertias, and collision geometry into a MuJoCo MJCF XML template. Create a MuJoCoBodyManager that loads this template and creates all the rigid bodies and colliders in MuJoCo.

### What to do

1. **Study the existing body creation code**
   - Read `HumanoidMultiBodyManager.activate()` — lines ~150-380. This is the most important function. It creates rigid bodies, colliders, and joints for every tracked bone. You must understand:
     - Which bones get bodies (trackedBones = those with entries in BONE_JOINT_TYPE)
     - How capsule dimensions are computed (`estimateBoneLength()`)
     - How joints are created (anchor point calculation, joint type selection, limit setting)
     - How `CAPSULE_ATTACH_BONES` connect to the root capsule
     - The topological sort order for parent/child dependencies
   - Read `ProceduralHumanoidBuilder.build()` — this is a simpler reference with BODY_PARTS array
   - Read `constants/physics.ts` — the COMPLETE_MIXAMO_PHYSICS_MATRIX with masses and inertias
   - Read `constants/rigConstraints.ts` — joint DOF and limit definitions
   - Read `constants/anatomicalLimits.ts` — fallback joint limits

2. **Create MJCFHumanoidTemplate.ts** (`src/world/engine/MJCFHumanoidTemplate.ts`)
   - Export a function `generateHumanoidMJCF(boneInfoMap, skeleton, capsuleCenterY, modelRoot, physicsMatrix, rigConstraints): string`
   - This function generates a complete MJCF XML string representing the full humanoid
   - The XML must include:
     a) `<compiler>` settings (coordinate system, angle format = radian)
     b) `<option>` settings (gravity, timestep, solver iterations, integrator)
     c) `<worldbody>` with:
        - Ground plane body + geom
        - Root capsule body (the main character capsule)
        - For each tracked bone: a nested `<body>` at its world position, with appropriate `<joint>`, `<geom>`, and `<inertial>`
     d) `<actuator>` section (can be empty or minimal for now — Phase 3 will fill this in)
     e) `<contact>` section with collision pair exclusions (ragdoll-ragdoll self-collision disabled)
   - **Coordinate system**: MuJoCo uses Z-up. Synthia uses Y-up. You have two choices:
     - Set `<compiler coordinate="local"/>` and rotate the world by setting quaternion on the ground plane, OR
     - Accept Z-up and convert all positions. Test both approaches.
     - Whichever you choose, document it clearly in a comment at the top of the file.
   - **Joint mapping**:
     - Knees and elbows → `<joint type="hinge" axis="1 0 0" range="min max"/>`
     - Shoulders, hips, spine, neck, head, hands → `<joint type="ball" range="min max"/>` (range applies as swing limit)
     - CAPSULE_ATTACH_BONES → `<joint type="free"/>` or connect to world
   - **Geom mapping**:
     - Most bones → `<geom type="capsule" size="radius halfHeight" .../>`
     - Feet → `<geom type="box" size="x y z" .../>`
     - Use `contype="1" conaffinity="2"` for ragdoll bodies (so they collide with environment but not each other)
   - **Mass/inertia**: For each bone, set `<inertial pos="0 0 0" mass="X" diaginertia="Ixx Iyy Izz"/>`
   - **IMPORTANT**: You must handle finger bones (thumb1-3, index1-3, middle1-3, ring1-3, pinky1-3 for both hands). They have very small masses (0.008-0.02 kg). Include them or the AI will lose finger control.

3. **Create MuJoCoBodyManager.ts** (`src/world/engine/MuJoCoBodyManager.ts`)
   - A class that manages MuJoCo body creation from the MJCF template
   - Public API (mirror what HumanoidMultiBodyManager exposes):
     - `activate(boneInfoMap, skeleton, capsuleBody, capsuleCenterY, modelRoot): boolean`
     - `deactivate(): void`
     - `getRigidBodiesMap(): Map<string, number>` (bone name → body ID)
     - `getBoneColliderHandle(boneName: string): number | null` (returns geom ID)
     - `getCapsuleBody(): number | null` (returns capsule body ID)
     - `syncRigidBodiesFromBones(boneInfoMap): void`
   - In `activate()`:
     a) Call `generateHumanoidMJCF()` to get the XML string
     b) Load it via `mj.loadModelFromString(xml)` or equivalent MuJoCo WASM API
     c) Create simulation: `mj.makeSimulation(model)`
     d) Build bone name → body ID mapping by querying `mj.name2id(model, mj.mjtObj.mjOBJ_BODY, name)`
     e) Store the sim reference in MuJoCoPhysicsEngine
   - In `syncRigidBodiesFromBones()`: Read current bone world positions/quaternions, set `sim.data.qpos` accordingly, zero out `sim.data.qvel`

4. **Extend MuJoCoPhysicsEngine.ts** (from Phase 1)
   - Add `loadMJCFModel(xml: string): void` method
   - Add `getModel()` and `getData()` accessors
   - Update `step()` to work with the loaded humanoid model
   - Update velocity clamping to iterate over the bodies in the model

5. **Write tests** (`src/world/engine/__tests__/MJCFHumanoidTemplate.test.ts`)
   - Test XML generation doesn't throw
   - Test XML parses as valid
   - Test all major bone groups are present
   - Test joint types are correct

### What NOT to change
- DO NOT modify HumanoidMultiBodyManager.ts or any Rapier-dependent file
- DO NOT wire MuJoCoBodyManager to HumanoidPhysicsBinder yet (Phase 3)
- DO NOT remove Rapier code
- The application must work exactly as before when useMuJoCo is false

### Key unknowns you MUST investigate
- What is the exact MuJoCo WASM API for loading MJCF XML? Is it `mj.loadModelFromString()` or something else?
- How does MuJoCo handle nested body transforms? In Rapier, you compute world positions and create bodies at those positions. In MuJoCo, you specify relative positions in the MJCF hierarchy. The topological sort in the existing code is critical for getting this right.
- What is the MuJoCo coordinate system convention? Test what happens with Y-up data in a Z-up world.
- How do `contype` and `conaffinity` bitmasks work in MuJoCo? They're different from Rapier's group masks.
- Do `CAPSULE_ATTACH_BONES` (spine, left upleg, right upleg) need `<freejoint>` or should they be direct children of the world body?
```

---

## PHASE 3: Actuator System & Motor Control

**Goal**: Replace the manual PD torque control in `HumanoidMultiBodyManager` and `ProceduralMotorController` with MuJoCo's native actuator system. Wire AI motor targets to actuator control signals.

**Stability checkpoint**: At the end of this phase, the AI can send joint targets, and the humanoid responds via MuJoCo actuators (position servos). The Rapier path (with manual PD torque) is unchanged. The MuJoCo path shows significantly better stability at high gains.

> **⚠️ PHASE 3 CRITICAL CORRECTIONS (from Executive Audit §0.2.3, §0.2.5, §0.3):**
> 
> 1. **Root capsule balance MUST use `data.xfrc_applied`**, not position actuators. The root capsule uses `<freejoint>` (6 unconstrained DOFs). MuJoCo `<position>` actuators cannot drive free joints. Implement the BALANCE_KP=200 balance loop by computing the upright error and writing corrective torques directly into `sim.data.xfrc_applied` for the capsule body on each frame.
> 2. **Ball joint actuators are NOT supported** — this was addressed in Phase 2 by decomposing spherical joints into 3 nested hinge joints. Your `<actuator>` section should have one `<position>` actuator per hinge axis, named systematically (e.g., `act_spine_yaw`, `act_spine_pitch`, `act_spine_roll`).
> 3. **K-GRF foot contact detection**: Use MuJoCo's contact array (`sim.data.contact`) instead of Rapier's contact force registry. MuJoCo contacts are pairs of geom IDs with position, normal, and force data — no event queue draining needed.

### Files to CREATE:

1. **`src/world/engine/MuJoCoMotorController.ts`**
   - Replaces both `RapierJointMotorController` and `HumanoidMultiBodyManager.setTargets()` (the PD torque section)
   - Converts Synthia's motor target format (scalar euler, 3-euler, quaternion) into MuJoCo actuator control signals (`sim.data.ctrl` array)
   - Each tracked bone gets 1 or 3 `<position>` actuators (1 for hinge bones, 3 for the 3 nested hinge axes per spherical bone)
   - Actuator configuration:
     - Revolute joints (knees, elbows): 1 position actuator with `kp`/`kv` from BONE_PD_GAINS
     - Decomposed spherical joints (shoulders, hips, spine): 3 position actuators (one per nested hinge axis: Yaw, Pitch, Roll) with `kp`/`kv` from BONE_PD_GAINS
   - The PD gain tuning that was spread across `BONE_PD_GAINS` and applied manually now lives in the MJCF `<actuator>` definitions
   - `setTargets(currentTargets: Map<string, any>): void` — main method called every frame
   - `setGainScale(stiffnessScale, dampingScale): void` — scales all gains (for limp mode)
   - `setLimpMode(active: boolean): void` — zero out actuator forces or set extremely low gains
   - `applyCapsuleBalance(): void` — writes upright balancing torques into `sim.data.xfrc_applied` for the root capsule body (replaces the Rapier BALANCE_KP=200 loop)
   - IMPORTANT: You must understand how MuJoCo position actuators work. They apply: `force = kp * (target - current) - kv * velocity`. This is EXACTLY what the manual PD torque code does, but done properly by the solver. No more adding external torques.

### Files to CREATE or MODIFY:

2. **Update `MJCFHumanoidTemplate.ts`** (from Phase 2)
   - Add `<actuator>` section to the generated MJCF XML
   - For each revolute joint bone (knees, elbows): add `<position name="act_<bonename>" joint="<jointname>" kp="X" kv="Y" ctrlrange="min max"/>`
   - For each spherical joint bone: add 3 position actuators per axis, OR investigate if MuJoCo supports ball joint actuators directly
   - Map actuator names to bone names so the motor controller can look them up
   - Finger bones need low-gain actuators (kp=5, kv=1) matching the existing BONE_PD_GAINS

3. **Update `MuJoCoBodyManager.ts`** (from Phase 2)
   - After loading the MJCF model, build an actuator ID map: `boneName → [actuatorId1, actuatorId2, actuatorId3]`
   - Expose this map to the motor controller
   - Add a method to get the actuator ID array for a given bone name

4. **`src/world/engine/HumanoidPhysicsBinderMuJoCo.ts`** (NEW — parallel to HumanoidPhysicsBinder)
   - This is a variant of `HumanoidPhysicsBinder` that uses MuJoCo internally
   - Shares the same public API but delegates physics to MuJoCoPhysicsEngine + MuJoCoBodyManager + MuJoCoMotorController
   - OR: modify `HumanoidPhysicsBinder` to accept an optional engine type and branch internally. Either approach works — choose the cleaner one.
   - The timeline system, constraint validation, K-GRF, lerp, and syncVisuals logic stays the SAME — only the physics calls change.
   - `setMotorTargets()` → calls `muJoCoMotorController.setTargets()`
   - `syncVisuals()` → reads transforms via `mj.getBodyPosition()` / `mj.getBodyQuaternion()` instead of `rigidBody.translation()` / `.rotation()`
   - Ground detection: use MuJoCo raycasting (`mj.rayCast()` or equivalent) instead of `RAPIER.Ray`
   - `executeJump()`: apply velocity impulse via `sim.data.qvel` modification
   - K-GRF: foot contact detection uses MuJoCo contact array instead of Rapier contact force registry

### Files to MODIFY:

5. **`src/world/hooks/useWorld.ts`**
   - When `useMuJoCo` is true, instantiate `MuJoCoBodyManager` and `MuJoCoMotorController` instead of `HumanoidMultiBodyManager` and `RapierJointMotorController`
   - Wire the MuJoCo variants into the animation loop callback
   - The onStep callback should call `muJoCoBodyManager.syncVisuals()` and `muJoCoMotorController.setTargets()` (if motor targets have been set)
   - Keep the Rapier path fully operational as the `else` branch

6. **`src/world/engine/AvatarSynchronizer.ts`**
   - Add an overload or new method that accepts MuJoCo body IDs + the MuJoCo simulation reference
   - Instead of `rigidBody.rotation()` / `.translation()`, use `mj.getBodyQuaternion(model, data, bodyId)` / `mj.getBodyPosition()`
   - The quaternion/position format is identical — just the accessor changes
   - OR: create a `MuJoCoAvatarSynchronizer` that inherits from or mirrors `AvatarSynchronizer`

7. **`src/world/engine/ObservationBuilder.ts`**
   - Add method overloads for MuJoCo body IDs
   - Same observation computation logic, different data source

8. **`src/store/worldStore.ts`**
   - No changes needed (useMuJoCo flag already added in Phase 1)

### Prompt for Jules:

```
## PHASE 3: Actuator System & Motor Control

### Objective
Replace the manual PD torque control system (the #1 source of instability) with MuJoCo's native actuator system. Wire the AI motor targets to MuJoCo position actuators. This is the MOST COMPLEX phase — the manual torque code in HumanoidMultiBodyManager.setTargets() is ~300 lines of quaternion math that ALL goes away.

### What to do

1. **Study the manual PD torque code**
   - Read `HumanoidMultiBodyManager.setTargets()` VERY carefully — every line. This is what you're replacing.
   - Understand the flow for a single spherical joint bone:
     a) Read parsedTarget (scalar, euler, or quaternion)
     b) Compute rawTarget quaternion from bindPoseRelative * deltaQuat
     c) Read child body rotation, parent body rotation
     d) Compute currentRelQuat = parentQuat⁻¹ * childQuat
     e) Compute errorQuat = currentRelQuat⁻¹ * rawTarget
     f) Extract errorAngle and errorAxis from errorQuat
     g) Read angular velocity, convert to local frame
     h) Compute localTorque = stiffness * errorAxis * errorAngle - damping * localAngVel
     i) Clamp at MAX_TORQUE=15
     j) Apply: body.addTorque(localTorque applied in child's world frame)
   - Understand the balance torque on the capsule (separate PD loop with BALANCE_KP=200)
   - Understand the "untargeted bones" fallback (pulled to bind pose)

2. **Create MuJoCoMotorController.ts** (`src/world/engine/MuJoCoMotorController.ts`)
   - This class REPLACES `RapierJointMotorController` AND the torque computation in `HumanoidMultiBodyManager.setTargets()`
   - Public API:
     - `init(actuatorMap: Map<string, number[]>, model: any, data: any): void`
     - `setTargets(currentTargets: Map<string, any>): void`
     - `setTargetAngle(boneName: string, angle: number): void`
     - `setGainScale(stiffnessScale: number, dampingScale: number): void`
     - `setLimpMode(active: boolean): void`
     - `getJointCount(): number`
   - In `setTargets()`:
     - For each targeted bone, convert the Synthia motor target to a MuJoCo actuator target
     - Revolute joints (knee, elbow): target is a scalar angle → set `sim.data.ctrl[actuatorId] = targetAngle`
     - Spherical joints (shoulder, hip, spine): target is 3 euler angles → set 3 actuator controls
     - Untargeted bones: set actuator targets to 0 (or don't set them — MuJoCo actuators hold position when not commanded differently)
     - MuJoCo's position actuator does: `force = kp * (ctrl - qpos) - kv * qvel`. This is the PD control, solved by MuJoCo's constraint solver. NO manual torque application.
   - IMPORTANT: MuJoCo actuators use the `ctrl` array in `sim.data`. You must map bone names to the correct indices in this array. The actuator order in the MJCF XML determines the indices.

3. **Update MJCFHumanoidTemplate.ts** — Add actuators
   - Add `<actuator>` section to the generated XML
   - For each revolute bone: `<position name="act_left_knee" joint="left_knee_j" kp="800" kv="160" ctrlrange="-2.618 0"/>`
     - Use kp/kv from BONE_PD_GAINS (read the existing values from HumanoidMultiBodyManager.ts)
   - For each spherical bone: `<position name="act_spine_x" joint="spine_j" kp="600" kv="120" ctrlrange="-0.524 0.524"/>` (×3 axes)
     - MuJoCo position actuators for ball joints: you can use `<position joint="..." ctrllimited="true" ctrlrange="..."/>` and the actuator will drive the joint to the specified position using PD gains
   - For CAPSULE_ATTACH_BONES: these connect to the world body, not a parent bone. Use `<freejoint>` and position actuators on the free joint, OR skip actuator control for these and handle them via direct body position setting.
   - Finger bones: kp=5, kv=1 (from BONE_PD_GAINS)

4. **Create HumanoidPhysicsBinderMuJoCo.ts** (or modify HumanoidPhysicsBinder.ts)
   - All the non-physics logic stays identical: timeline system, constraint validation, lerp, debug spheres, camera helpers, bone extraction, model loading
   - What changes:
     - `createRigidBodiesAndColliders()` → delegates to MuJoCoBodyManager.activate()
     - `syncVisuals()` → uses `mj.getBodyPosition()` / `mj.getBodyQuaternion()` instead of Rapier accessors
     - `updateMotorTargets()` → uses MuJoCoMotorController instead of manual PD torque
     - Ground raycast → uses MuJoCo raycasting API
     - `executeJump()` → sets capsule body velocity via `sim.data.qvel`
     - `setCapsulePosition()` → uses `mj.setBodyPosition()`
     - `getJointState()` → reads transforms from MuJoCo data
     - `getContactForces()` → reads MuJoCo contact array
     - K-GRF: reads foot bone contact from MuJoCo contacts
   - Choose ONE of two approaches:
     a) Create a new parallel class `HumanoidPhysicsBinderMuJoCo` with the same public API
     b) Modify `HumanoidPhysicsBinder` to accept an optional engine parameter and branch internally
     Choose approach (a) for cleaner separation. Name it clearly.

5. **Update AvatarSynchronizer.ts**
   - Add a new method `synchronizeMuJoCo(bonesMap, bodyIds, model, data, disableSync?)` that uses MuJoCo body transform accessors
   - The quaternion math is identical — only the data source changes

6. **Update useWorld.ts**
   - When `useMuJoCo` is true:
     - Create MuJoCoPhysicsEngine (from Phase 1)
     - Load the MJCF model (from Phase 2)
     - Create MuJoCoMotorController
     - Use HumanoidPhysicsBinderMuJoCo instead of HumanoidPhysicsBinder
     - In the animation loop callback, call the MuJoCo variants
   - Keep the Rapier path as the `else` branch, completely intact

### What NOT to change
- DO NOT modify the timeline system (validateAndApplyTimeline, interpolation logic)
- DO NOT modify constraint validation (rigConstraints, anatomicalLimits)
- DO NOT modify AI coordinator code
- DO NOT modify WorldEngine or CameraManager
- The Rapier path must remain fully functional

### Deep dive: Why this phase eliminates the biggest problem
The manual PD torque code applies EXTERNAL torques that fight Rapier's impulse solver. At high stiffness (>600), the solver and the external torques oscillate against each other — this is the "jitter" the diagnostic tool was built to detect. MuJoCo's actuators are INTERNAL to the constraint solver. The position servo is solved as part of the same optimization problem as contacts and joint limits. There is no external-vs-internal fight. Stiffness values of 2000+ are stable in MuJoCo.

### Key unknowns you MUST investigate
- How exactly does MuJoCo's position actuator work for ball joints? Does `<position joint="ball_joint"/>` work as a 3-DOF position servo?
- What is the actuator ctrl array index mapping? How do you find the index for a named actuator?
- How do you raycast in MuJoCo WASM? Is it `mj.rayCast()` or `mj.ray()` or something else?
- How do you read contact data in MuJoCo? The `sim.data.contact` array stores contacts differently from Rapier's event queue.
- How do you apply a velocity impulse to a body in MuJoCo? Rapier uses `body.applyImpulse()`. MuJoCo uses `sim.data.qvel` modification or `mj.applyFT()`.
```

---

## PHASE 4: Collision, Objects & Environment

**Goal**: Port the ObjectManager to use MuJoCo collision geoms and contact detection. Keep piano note detection, button press detection, and custom model spawning working. Port ground detection.

**Stability checkpoint**: At the end of this phase, environment objects can be spawned, they collide with the humanoid, and the piano/button interaction callbacks fire. Both Rapier and MuJoCo paths work.

> **⚠️ PHASE 4 CRITICAL CORRECTIONS (from Executive Audit §0.2.2, §0.3):**
> 
> 1. **MuJoCo's `mjModel` is a static, compiled C struct.** You CANNOT call `world.createRigidBody()` at runtime like Rapier. The `mjModel` must be fully specified before simulation begins. Adding bodies dynamically requires either: (a) rebuilding the full MJCF XML string and calling `mj_loadXML` (which resets ALL simulation state, contacts, and causes 100ms+ thread stutters), or (b) **pre-allocating a pool of dummy bodies/geoms** in the initial MJCF template.
> 2. **IMPLEMENTATION MANDATE: Create a Body/Geom Pre-Allocation Pool.** In `generateHumanoidMJCF()`, add a `<body name="env_slot_0">` through `<body name="env_slot_19">` (20 pooled dynamic bodies). Each gets a `<freejoint>`, a capsule or box `<geom>` with `size="0 0 0"` (invisible, no collision), and `contype="0" conaffinity="0"` (disabled). When `spawnObject()` is called: find an unclaimed slot, set the geom's `size` to the object's dimensions, reposition the body via `sim.data.qpos`, and enable collision by setting `contype`/`conaffinity`. When `deleteObject()` is called: reset size to `0 0 0` and disable collision bits. Reserve XML re-compilation strictly for complete scene resets or initial load.
> 3. **Piano notes**: use geom names (e.g., `geom name="piano_C4"`) for note detection from the MuJoCo contact array, instead of the Rapier `_synthiaNote` property hack.

### Files to CREATE:

1. **`src/world/engine/MuJoCoObjectManager.ts`**
   - Parallel to `ObjectManager.ts` but uses MuJoCo geoms
   - Public API matches `ObjectManager`:
     - `spawnObject(presetId, position): WorldObject`
     - `spawnCustomModel(modelGroup, name, position, options): WorldObject`
     - `spawnPiano(id, preset, position): WorldObject` (88 sensor geoms)
     - `deleteObject(id): void`
     - `setObjectPosition(id, position, quaternion?): void`
     - `syncVisuals(): void`
     - `update(): void` (contacts detection)
     - `setGlobalFriction(friction): void`
     - `setDraggingObject(id): void`
   - MuJoCo geom shapes mapping:
     - `RAPIER.ColliderDesc.ball(radius)` → `<geom type="sphere" size="radius"/>`
     - `RAPIER.ColliderDesc.cuboid(hx, hy, hz)` → `<geom type="box" size="hx hy hz"/>`
     - `RAPIER.ColliderDesc.cylinder(halfHeight, radius)` → `<geom type="cylinder" size="radius halfHeight"/>`
     - `RAPIER.ColliderDesc.capsule(halfHeight, radius)` → `<geom type="capsule" size="radius halfHeight"/>`
     - `RAPIER.ColliderDesc.convexHull(vertices)` → MuJoCo supports mesh geoms for static bodies only. For dynamic objects, use `<geom type="mesh"/>` or decompose into convex primitives.
     - `RAPIER.ColliderDesc.trimesh(vertices, indices)` → `<geom type="mesh"/>` (MuJoCo uses `.stl` or `.obj` format, OR pass vertices directly)
   - Collision filtering: MuJoCo `contype`/`conaffinity` replaces Rapier's `getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP)`
   - Contact detection: MuJoCo stores contacts in `sim.data.contact` array (pairs of geom IDs + contact info). Iterate this instead of draining an event queue.
   - Piano note detection: Currently uses `collider._synthiaNote` property. In MuJoCo, you can use geom names or userdata.
   - Dragging objects: Rapier uses `rigidBody.setBodyType(KinematicPositionBased)` for dragging. MuJoCo equivalent: set body as `<freejoint>` with position control, or directly modify `sim.data.qpos`.

2. **`src/world/engine/MuJoCoCollisionAdapter.ts`**
   - Helper module with functions:
     - `rapierPresetToMuJoCoGeom(preset: ObjectPreset): string` — generates MJCF `<geom>` XML snippet
     - `getMuJoCoContactPairs(data): Array<{geom1Id, geom2Id, contactNormal, force}>` — reads MuJoCo contact array into a format similar to Rapier's events
     - `createGroundPlaneMJCF(): string` — ground plane body + geom XML

### Files to MODIFY:

3. **`src/world/engine/MuJoCoPhysicsEngine.ts`** (from Phases 1-2)
   - Add methods to add/remove bodies and geoms at runtime (for object spawning)
   - In MuJoCo, modifying the model at runtime requires careful handling. Bodies can be added to `sim.model` and then `mj.reload()` must be called, OR use the lower-level `mj.addBody()` / `mj.addGeom()` if available in the WASM bindings.
   - If runtime body addition is not supported, pre-allocate a pool of bodies and activate/deactivate them (set size=0 for inactive geoms).
   - Add method `getContactPairs(): Array<{geomId1, geomId2, ...}>`

4. **`src/world/hooks/useWorld.ts`**
   - When `useMuJoCo` is true, use `MuJoCoObjectManager` instead of `ObjectManager`
   - The piano note callback and button press callback logic stays the same — just the contact detection source changes
   - Object spawning event handlers (`synthia:spawn`, `synthia:spawnCustom`) dispatch to the MuJoCo variant

5. **`src/constants/physics.ts`**
   - Add MuJoCo collision constants: `RAGDOLL_CONTYPE = 1`, `RAGDOLL_CONAFFINITY = 2`, `ENVIRONMENT_CONTYPE = 2`, `ENVIRONMENT_CONAFFINITY = 3` (all bits)
   - These replace `RAGDOLL_GROUP` and `ENVIRONMENT_GROUP` when using MuJoCo
   - Add a helper `getMuJoCoCollisionMask(contype, conaffinity)` or just export the constants

### Prompt for Jules:

```
## PHASE 4: Collision, Objects & Environment

### Objective
Port the ObjectManager to use MuJoCo collision geoms and contact detection. Ensure environment objects (cubes, spheres, pianos, custom uploaded models) spawn correctly, collide with the humanoid, and fire interaction callbacks (piano notes, button presses).

### What to do

1. **Study the existing ObjectManager**
   - Read `ObjectManager.ts` — understand how objects are created, how collision events are drained from Rapier's event queue, how piano note detection works (via `collider._synthiaNote`), and how dragging/kinematic objects work.
   - Read how collision groups are configured: `getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP)` → 32-bit mask (high 16 = membership, low 16 = filter).
   - Understand the custom model spawning flow: `spawnCustomModel()` collects mesh vertices into `Float32Array`, creates `convexHull` or `trimesh` collider descriptors from them.

2. **Create MuJoCoObjectManager.ts** (`src/world/engine/MuJoCoObjectManager.ts`)
   - Same public API as `ObjectManager.ts`. Match every public method signature.
   - Key differences from Rapier:
     a) Objects are added to the MuJoCo simulation at runtime. MuJoCo models are static after loading. You have options:
        - Pre-allocate a pool of body/geom slots in the MJCF and activate/deactivate them
        - Use MuJoCo's runtime body addition API (if the WASM bindings support it — CHECK)
        - Create a new composite MJCF string and reload the model (expensive but simple)
        - Choose the approach that works. Document your choice.
     b) Contact detection: iterate `sim.data.contact` array which contains `{geom1, geom2, dist, pos, frame}` for each contact pair. No event queue draining.
     c) Piano note detection: MuJoCo geoms can be named (e.g., `geom name="piano_C4"`). Match the name to notes.
     d) Dragging: set body as kinematic by fixing all its joint DOFs temporarily, then directly set `sim.data.qpos` for that body.
   - For each preset type (cube, sphere, cylinder, wedge/slope/ramp), map to the correct MuJoCo geom type and size parameters.
   - For `spawnCustomModel()`: MuJoCo supports `<geom type="mesh"/>` for static bodies. For dynamic bodies, you need convex shapes. The existing code already uses `RAPIER.ColliderDesc.convexHull(vertices)` for dynamic objects and `trimesh` for terrain. MuJoCo can use convex mesh geoms.

3. **Create MuJoCoCollisionAdapter.ts** (`src/world/engine/MuJoCoCollisionAdapter.ts`)
   - Helper functions to bridge Rapier concepts to MuJoCo:
     - `objectPresetToMJCFGeom(preset): {geomType, size, pos}` — converts Synthia preset to MJCF geom attributes
     - `getCollisionPairs(data, model): Array<{id1, id2, name1, name2, contact}>` — reads MuJoCo contact array
     - `isGeomInContact(data, geomId): boolean` — check if a specific geom is touching anything
   - These exist so the ObjectManager code doesn't have to deal with raw MuJoCo array iteration

4. **Update physics constants** (`src/constants/physics.ts`)
   - Add MuJoCo collision bit definitions:
     - `RAGDOLL_CONTYPE = 1` (bit 0)
     - `RAGDOLL_CONAFFINITY = 2` (bit 1 — collides with environment)
     - `ENVIRONMENT_CONTYPE = 2` (bit 1)
     - `ENVIRONMENT_CONAFFINITY = 3` (bits 0+1 — collides with ragdoll and other environment)
   - Or use the same 0x0001 / 0x0002 values but mapped to MuJoCo's different bit system. MuJoCo `contype`/`conaffinity` are 32-bit integers where each bit is independent. Rapier uses a split 16/16 scheme. You'll need to adapt.

5. **Update useWorld.ts**
   - When `useMuJoCo` is true, instantiate `MuJoCoObjectManager` instead of `ObjectManager`
   - Wire the same event callbacks (piano note → audio + outcome, button press → outcome)
   - The object spawning event listeners (`synthia:spawn`, `synthia:spawnCustom`, `synthia:deleteObject`) should dispatch to the MuJoCo variant when active
   - The animation loop callback should call `muJoCoObjectManager.syncVisuals()` and `muJoCoObjectManager.update()`

6. **Handle MuJoCo runtime body modification**
   - This is the hardest part of this phase. Rapier allows creating/deleting bodies at any time. MuJoCo's model is compiled once.
   - Research approaches:
     a) Pre-allocate N bodies in the MJCF with size=0 geoms, activate them when spawning objects
     b) Use `mj.addBody()` if available in the WASM bindings
     c) Build a new MJCF string including all current objects and reload
   - Choose the approach that works with the WASM bindings. Document your decision.

### What NOT to change
- DO NOT modify ObjectManager.ts
- DO NOT modify piano note logic or audio engine
- DO NOT change the WorldObject interface
- The Rapier path must remain fully functional

### Key unknowns you MUST investigate
- Can you add/remove bodies from a MuJoCo simulation at runtime in the WASM bindings?
- How do MuJoCo mesh geoms work in the WASM bindings? Can you create them from vertex arrays, or must you provide file paths?
- How does MuJoCo's contact array map to specific geom names? You need this for piano note detection.
- What is the performance cost of reloading the entire MJCF model when a new object is spawned? Is the pre-allocation approach feasible?
```

---

## PHASE 5: Cleanup, Diagnostics & Final Integration

**Goal**: Update the jitter diagnostic for MuJoCo, tune actuator gains, verify all features work (locomotion, ragdoll, jumping, AI control), and clean up unused Rapier code.

**Stability checkpoint**: At the end of this phase, the application works end-to-end with MuJoCo. The old Rapier path is removed. The jitter diagnostic shows dramatically better stability numbers.

> **⚠️ PHASE 5 CRITICAL CORRECTIONS (from Executive Audit §0.3):**
> 
> 1. **Gain Scaling Conversion Factor**: MuJoCo `<position>` actuator $k_p$ values do NOT map 1:1 from Rapier's external torque gains. Because MuJoCo's position servos are integrated implicitly within the constraint solver (rather than applied as explicit external impulses), the effective stiffness is higher per unit $k_p$. **Start with $k_p$ values at 0.25× to 0.5× of the Rapier BONE_PD_GAINS**, then increase incrementally while monitoring the diagnostic. Example: if Rapier used kp=800 for knees, start MuJoCo at kp=200 and work up. MuJoCo should remain stable at gains 2-3× higher than Rapier, but the numeric $k_p$ values themselves will be lower.
> 2. **Diagnostic recalibration**: The jitter verdict thresholds (STABLE/WATCH/JITTER/CRITICAL) must be recalibrated for MuJoCo. Angular speeds above 2 rad/s are unusual with MuJoCo's soft-constraint solver. The CRITICAL threshold should be rare.
> 3. **Capsule balance via `xfrc_applied`** was implemented in Phase 3 — verify it works at BALANCE_KP values from 50 up to 150 (MuJoCo equivalent of the Rapier 200). The root capsule freejoint cannot use actuators.
> 4. **When deleting Rapier files in this phase**: verify ALL features work with MuJoCo first. Search for ALL `@dimforge/rapier3d-compat` imports. Run `tsc --noEmit` and `npm run build` after every file deletion.

### Files to CREATE:

1. **`src/world/engine/MuJoCoDiagnostic.ts`**
   - Updated jitter diagnostic that reads MuJoCo data instead of peeking into HumanoidMultiBodyManager private fields
   - Measures per-body: angular velocity (from `sim.data.qvel`), joint position error (from `sim.data.qpos` vs target), actuator force (from `sim.data.actuator_force`)
   - Much simpler than the Rapier version because actuator forces are directly available — no need to estimate torque
   - The verdict system (STABLE/WATCH/JITTER/CRITICAL) stays the same but thresholds should be recalibrated — MuJoCo is inherently more stable, so CRITICAL should be rare

2. **`src/world/engine/__tests__/MuJoCoIntegration.test.ts`**
   - End-to-end integration test
   - Test that model loads, bodies create, actuators respond to targets, contacts fire, objects spawn
   - Test ragdoll mode (limp → zero actuator forces)
   - Test that AI motor targets produce movement (basic arm raise, knee bend)

### Files to MODIFY:

3. **`src/world/engine/HumanoidPhysicsBinderMuJoCo.ts`** (from Phase 3)
   - Wire up `installDiagnostic()` for MuJoCo
   - Finalize K-GRF implementation using MuJoCo contact data
   - Verify `executeJump()`, `setMode('ragdoll')`, `resetPose()`, `isOutOfWorldBounds()` all work
   - Tune the balance controller: in the Rapier version, a separate PD loop applies balance torque to the capsule. In MuJoCo, this can be:
     a) A position actuator on the capsule's free joint with low gains
     b) External forces applied via `sim.data.xfrc_applied`
     c) Kept as manual torque application (MuJoCo supports external forces natively)
   - Choose the approach that works best. Test at stiffness values of 200, 400, 600, 800 to verify stability.

4. **`src/world/engine/MuJoCoPhysicsEngine.ts`** (finalize)
   - Final cleanup of the API
   - Ensure all edge cases are handled (simulation reset, model reload, WASM memory limits)
   - Performance: verify 60 FPS is maintained with the full humanoid + multiple objects

5. **`src/world/hooks/useWorld.ts`**
   - Clean up the MuJoCo conditional branches
   - Remove dead code paths
   - Update the step-by-step debug console guide for MuJoCo

6. **`package.json`**
   - Remove `@dimforge/rapier3d-compat` from dependencies
   - Verify mujoco-wasm is the only physics WASM dependency

7. **Delete these files** (they are fully replaced):
   - `src/world/engine/HumanoidMultiBodyManager.ts` → replaced by MuJoCoBodyManager
   - `src/world/engine/RapierJointMotorController.ts` → replaced by MuJoCoMotorController
   - `src/world/engine/ProceduralMotorController.ts` → replaced by MuJoCoMotorController
   - `src/world/engine/RagdollBuilder.ts` → replaced by MJCF template
   - `src/world/engine/PhysicsEngine.ts` → replaced by MuJoCoPhysicsEngine
   - `src/world/engine/ProceduralHumanoidBuilder.ts` → replaced by MJCFHumanoidTemplate
   - `src/world/engine/ObjectManager.ts` → replaced by MuJoCoObjectManager
   - `src/world/engine/PhysicsDiagnostic.ts` → replaced by MuJoCoDiagnostic
   - `src/world/engine/HumanoidPhysicsBinder.ts` → replaced by HumanoidPhysicsBinderMuJoCo

   NOTE: Before deleting, verify that all references to these files have been updated. Search for all imports. Use `search_files` to find every import statement.

8. **Update all remaining imports**
   - `useWorld.ts`, `worldStore.ts`, `constants/physics.ts`, and any test files
   - Search for any remaining `@dimforge/rapier3d-compat` imports and remove them
   - Search for any remaining references to deleted classes

### ACTUATOR GAIN TUNING GUIDE

The existing Rapier BONE_PD_GAINS values may not map 1:1 to MuJoCo actuator gains because:
- Rapier gains drive external torques (Nm/rad), MuJoCo gains are internal to the solver
- MuJoCo's soft constraint formulation handles higher gains without instability

Start with:
- Legs (upleg, leg): kp=400, kv=80 (half of Rapier's 800/160 — test and increase)
- Arms (arm, forearm): kp=200, kv=40
- Spine: kp=300, kv=60
- Neck, head: kp=150, kv=30
- Fingers: kp=5, kv=1 (same as Rapier — fingers don't need high gains)
- Balance (capsule): kp=100, kv=40

Increase gains gradually. Watch for oscillation at the natural frequency of each limb. MuJoCo should remain stable at 2-3× higher gains than Rapier.

### Prompt for Jules:

```
## PHASE 5: Cleanup, Diagnostics & Final Integration

### Objective
Update the jitter diagnostic for MuJoCo (making it simpler and more accurate), tune actuator gains, test all features end-to-end (locomotion via K-GRF, ragdoll mode, jumping, AI motor control), and remove all Rapier dependencies. This is the final phase.

### What to do

1. **Create MuJoCoDiagnostic.ts** (`src/world/engine/MuJoCoDiagnostic.ts`)
   - Read the existing `PhysicsDiagnostic.ts` to understand the diagnostic's public API and report format
   - Reimplement for MuJoCo:
     - Per-frame sampling: read `sim.data.qvel` for angular velocities, `sim.data.qpos` for joint positions, `sim.data.actuator_force` for torque
     - Actuator forces are DIRECTLY available — the Rapier version had to ESTIMATE torque from damping * angular velocity. This makes the MuJoCo diagnostic far more accurate.
     - The verdict system (STABLE/WATCH/JITTER/CRITICAL) uses the same thresholds but should be recalibrated. In MuJoCo, angular speeds above 2 rad/s are unusual — the soft constraint solver damps oscillations naturally.
     - Same console mute/unmute pattern (preserve for diagnostic-only output)
     - Same JSON export functionality
     - Same `window.__SYNTHIA_DIAG__` global handle
   - Install the diagnostic after MuJoCoBodyManager.activate() completes

2. **Tune actuator gains**
   - Create a tuning script or use the browser console to test different gain values
   - Test each body group independently:
     a) Legs: can the humanoid stand without oscillation? Try kp=200→400→600→800
     b) Arms: can the arms hold position without vibrating? Try kp=100→200→300
     c) Spine: can the torso stay upright? Try kp=200→400→600
     d) Balance: does the capsule stay vertical? Try kp=50→100→150
   - Run the diagnostic after each tuning iteration. Goal: ALL bones verdict = "STABLE" at rest.
   - The tuned values go into BONE_PD_GAINS for the MJCF actuator template.
   - EXPECTED RESULT: MuJoCo should be stable at gains 2-3× higher than Rapier. The diagnostic should show near-zero oscillations.

3. **Test all features end-to-end**
   - **Standing**: Humanoid spawns, stands upright. No jitter.
   - **AI motor control**: Send joint targets via console or AI. Character moves.
   - **Locomotion (K-GRF)**: Test walking forward. Foot strokes should produce capsule movement.
   - **Ragdoll**: `setMode('ragdoll')` → character goes limp. `setMode('rigid')` → character stands up.
   - **Jumping**: `executeJump(6.0)` → character jumps. Landing should be stable.
   - **Piano**: Spawn piano. Character's hands/feet touching keys should play notes.
   - **Object spawning**: Spawn cubes, spheres. They should collide with the humanoid.
   - **Custom models**: Upload a 3D model. It should have collision.
   - **World boundaries**: Walk off the edge. Character should reset.
   - **Timeline sequences**: AI sends multi-frame sequence. Character should interpolate smoothly.
   - **Camera**: First-person, third-person, chase cameras work.

4. **Remove Rapier dependencies**
   - AFTER verifying ALL features work with MuJoCo (useMuJoCo=true):
   - Delete these files (they are fully replaced, with references updated):
     - `src/world/engine/PhysicsEngine.ts`
     - `src/world/engine/HumanoidPhysicsBinder.ts`
     - `src/world/engine/HumanoidMultiBodyManager.ts`
     - `src/world/engine/RapierJointMotorController.ts`
     - `src/world/engine/ProceduralMotorController.ts`
     - `src/world/engine/RagdollBuilder.ts`
     - `src/world/engine/ProceduralHumanoidBuilder.ts`
     - `src/world/engine/ObjectManager.ts`
     - `src/world/engine/PhysicsDiagnostic.ts`
   - Rename the MuJoCo variants to drop the "MuJoCo" prefix (e.g., `MuJoCoPhysicsEngine.ts` → `PhysicsEngine.ts`, `HumanoidPhysicsBinderMuJoCo.ts` → `HumanoidPhysicsBinder.ts`)
   - Update ALL imports across the entire codebase. Use `search_files` to find every `@dimforge/rapier3d-compat` import and every import of a deleted file.
   - Run `npm uninstall @dimforge/rapier3d-compat`
   - Run `tsc --noEmit` to verify no type errors remain
   - Run `npm run build` to verify production build succeeds

5. **Update useWorld.ts**
   - Remove the `useMuJoCo` conditional branches — MuJoCo is now the only path
   - Remove the separate MuJoCo engine ref variables
   - Clean up the animation loop callback
   - Update the console debug guide

6. **Update worldStore.ts**
   - Remove the `useMuJoCo` flag (no longer needed)
   - Remove `setUseMuJoCo` action
   - Update `saveSession()` / `loadSession()` to remove the old field

7. **Final diagnostic run**
   - Start the app with MuJoCo
   - Run `window.__SYNTHIA_DIAG__.start(600)` (10 seconds)
   - Verify ALL bones show "STABLE"
   - Verify no torque clamping fires
   - Verify oscillations per second < 1 for all bones
   - Save the diagnostic JSON as a baseline for future comparisons

### What NOT to change
- DO NOT modify the AI coordinator code
- DO NOT modify the Three.js rendering pipeline
- DO NOT modify the timeline/validation system
- DO NOT modify UI components
- DO NOT modify the AudioEngine
- ONLY delete Rapier files after full verification with MuJoCo

### Success criteria
After Phase 5:
1. `npm run build` succeeds with zero TypeScript errors
2. `npm run dev` starts without errors
3. Humanoid loads and stands upright without jitter
4. AI can control the humanoid via joint targets
5. Locomotion (K-GRF) works
6. Ragdoll mode works
7. Piano and environment objects work
8. Diagnostic shows ALL bones STABLE at rest
9. Zero `@dimforge/rapier3d-compat` imports remain in the codebase
10. The jitter diagnostic tool from the Rapier era is now a historical artifact — it shows clean numbers and serves only as a validation tool, not a debugging necessity
```

---

# PART 3: CRITICAL NOTES FOR JULES (Read Before Starting)

## 3.1 Coordinate System Warning

**THIS IS THE MOST LIKELY SOURCE OF BUGS.** Rapier and Three.js use Y-up (Y is vertical). MuJoCo uses Z-up by default. If you don't handle this correctly in Phase 2, ALL body positions will be rotated 90 degrees.

Options:
1. Set MuJoCo to Y-up: Some builds allow `<compiler coordinate="local"/>` and then you set the world body's quaternion. Test this.
2. Convert all positions: Multiply every (x, y, z) by a rotation matrix before writing to MJCF and after reading from MuJoCo data.
3. Accept Z-up and adjust: Set gravity to (0, 0, -9.81) and the ground plane normal to (0, 0, 1).

Choose ONE approach and be CONSISTENT throughout all files.

## 3.2 MuJoCo WASM API Surface

The JavaScript bindings for MuJoCo may expose a SUBSET of the C API. Specifically:
- `mj.step(model, data)` — likely available
- `mj.loadModelFromString(xml)` — may or may not be available; check the npm package
- `mj.makeSimulation(model)` — may or may not be available
- `mj.getBodyPosition(model, data, bodyId)` — may or may not be available
- `mj.setBodyPosition(model, data, bodyId, pos)` — may be available as direct qpos modification
- `mj.name2id(model, type, name)` — name lookup
- `mj.rayCast()` — may or may not be available

**You MUST read the actual npm package's TypeScript definitions or source code to know what's available.** Do not assume any function exists.

## 3.3 The `claude ragdoll.html` File

This is a standalone Rapier + Three.js demo in the project root. It implements a simpler version of the physics pipeline (bone classification, capsule colliders, revolute motors, gait controller, balance controller). It's an excellent test target for MuJoCo WASM integration — port it first before touching the main codebase. Success there proves the concept works.

## 3.4 Files That Must Stay Untouched

These files contain ZERO Rapier imports and form the "safe zone" of the codebase:
- `src/world/engine/WorldEngine.ts` — Three.js only
- `src/world/engine/CameraManager.ts` — Three.js only
- `src/world/engine/AudioEngine.ts` — Tone.js only
- `src/constants/rigConstraints.ts` — pure data
- `src/constants/anatomicalLimits.ts` — pure data
- `src/types/joint.ts` — pure types
- `src/types/world.ts` — pure types
- `coordinator/` — all files
- `src/components/` — all files
- `src/store/agentStore.ts`, `connectionStore.ts`, `logStore.ts`, `uiStore.ts`

If any of these files break during migration, you made a mistake elsewhere.

## 3.5 Rollback Plan

If at any point the migration goes wrong:
1. `git checkout` the last stable commit
2. The Rapier path was always operational until Phase 5 deletion
3. You can always `npm install @dimforge/rapier3d-compat` again

---

*End of project_info__29.md*
