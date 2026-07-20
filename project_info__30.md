# Synthia-1 — MuJoCo WASM Migration: Complete Codebase Analysis & 5-Phase Refactor Plan

I've completed a thorough exploration of the entire Synthia-1 codebase and saved the full report to `project_info__29.md`. Here's what I found and the structured 5-phase plan for Jules.

---

## Codebase Overview (What Jules Needs to Know)

Synthia-1 is a browser-based 3D humanoid physics sandbox with AI-powered motor control. The stack:

- **Frontend**: React 18 + Vite 8 + Three.js 0.184 + Rapier3D 0.19.3 (WASM physics)
- **Coordinator**: Node.js/Fastify server for AI inference, memory, Supabase
- **~60 files**, of which **12 files require significant changes** for MuJoCo migration

The physics pipeline has 4 layers:
1. **PhysicsEngine.ts** — owns the RAPIER.World, steps at 60 Hz, drains collision events
2. **HumanoidPhysicsBinder.ts** — capsule body, K-GRF ground reaction forces, timeline interpolation, motor target distribution
3. **HumanoidMultiBodyManager.ts** — **THE PAIN POINT**: per-bone rigid bodies with manual PD torque control (~300 lines of quaternion math per frame, applies external torques that fight Rapier's solver)
4. **AI Coordinator** — sends joint targets as scalar/euler/quaternion payloads

**The core problem**: Rapier's impulse-based solver goes unstable at stiffness >600 because external PD torques fight the solver. A jitter diagnostic tool was built specifically to detect this. MuJoCo's soft-constraint QP solver makes this entire class of problem disappear — actuators are internal to the solver.

**Critical invariant**: Rapier and MuJoCo use the SAME coordinate system and quaternion convention. Direct copy of transforms works — no conversion math needed (though MuJoCo defaults to Z-up and Synthia uses Y-up — that's the one coordinate issue to solve).

---

## The 5 Phases (Copy These for Jules)

### PHASE 1: MuJoCo WASM Integration & PhysicsEngine Adapter

**Files to create**: `MuJoCoPhysicsEngine.ts`, test file
**Files to modify**: `package.json`, `worldStore.ts`, `vite.config.ts`, `useWorld.ts`

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
   - Add COOP/COEP headers for SharedArrayBuffer support:
     ```ts
     server: {
       headers: {
         'Cross-Origin-Opener-Policy': 'same-origin',
         'Cross-Origin-Embedder-Policy': 'require-corp',
       }
     }
     ```
   - Also configure `optimizeDeps` to exclude `mujoco-wasm` from Vite's pre-bundling (WASM modules need native loading)

5. **Wire in useWorld.ts** (MINIMAL — Phase 1 only)
   - In the `init()` function in `useWorld.ts`, add a conditional: if `worldStore.useMuJoCo`, create `MuJoCoPhysicsEngine` instead of `PhysicsEngine`. Log which engine is active.
   - Do NOT wire MuJoCo to the full pipeline yet. Just initialize and log.
   - Keep storing the engine ref in a way that the rest of the code doesn't break — the Rapier path is still the default.

6. **Create a basic test** (`src/world/engine/__tests__/MuJoCoPhysicsEngine.test.ts`)
   - Test WASM loading, step() runs 60+ times without errors, gravity setting, velocity clamping

### What NOT to change
- DO NOT modify `PhysicsEngine.ts` or any Rapier-dependent file
- DO NOT remove any Rapier code
- DO NOT wire MuJoCo to HumanoidPhysicsBinder, ObjectManager, or any other file
- The application must work exactly as before when `useMuJoCo` is `false`

### Key unknowns you MUST investigate
- What is the exact npm package name for MuJoCo WASM? What export does it provide?
- Does MuJoCo WASM require SharedArrayBuffer? If so, the COOP/COEP headers are essential.
- What is the MuJoCo convention for Y-up vs Z-up? Do you need to rotate the entire simulation?
- How do you create bodies and geoms in MuJoCo via JavaScript API? MJCF XML strings or programmatic `mj.make*` functions?
- How do you step the simulation? Is it `mj.step(model, data)` or something else?
```

---

### PHASE 2: MJCF Humanoid Template & Body/Collider Creation

**Files to create**: `MJCFHumanoidTemplate.ts`, `MuJoCoBodyManager.ts`, test file
**Files to modify**: `MuJoCoPhysicsEngine.ts` (extend from Phase 1)

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
   - Read `ProceduralHumanoidBuilder.build()` — a simpler reference with BODY_PARTS array
   - Read `constants/physics.ts` — COMPLETE_MIXAMO_PHYSICS_MATRIX with masses and inertias
   - Read `constants/rigConstraints.ts` — joint DOF and limit definitions per bone
   - Read `constants/anatomicalLimits.ts` — fallback joint limits

2. **Create MJCFHumanoidTemplate.ts** (`src/world/engine/MJCFHumanoidTemplate.ts`)
   - Export a function `generateHumanoidMJCF(boneInfoMap, skeleton, capsuleCenterY, modelRoot, physicsMatrix, rigConstraints): string`
   - This function generates a complete MJCF XML string representing the full humanoid
   - The XML must include:
     a) `<compiler>` settings (coordinate system, angle format = radian)
     b) `<option>` settings (gravity, timestep, solver iterations, integrator)
     c) `<worldbody>` with: ground plane, root capsule body, nested bodies for each bone with `<joint>`, `<geom>`, `<inertial>`
     d) `<actuator>` section (empty for now — Phase 3 fills this)
     e) `<contact>` section with collision pair exclusions (ragdoll-ragdoll self-collision disabled)
   - **Coordinate system**: Document your Y-up vs Z-up choice clearly in a comment at the top
   - **Joint mapping**:
     - Knees/elbows → `<joint type="hinge" axis="1 0 0" range="min max"/>`
     - Shoulders/hips/spine/neck/head/hands → `<joint type="ball" range="min max"/>`
     - CAPSULE_ATTACH_BONES → `<joint type="free"/>` or connect to world
   - **Geom mapping**: bones → capsule, feet → box; use `contype="1" conaffinity="2"`
   - **Mass/inertia**: For each bone, `<inertial pos="0 0 0" mass="X" diaginertia="Ixx Iyy Izz"/>`
   - **CRITICAL**: Include ALL finger bones (thumb1-3, index1-3, middle1-3, ring1-3, pinky1-3 for both hands) with micro-mass values. Missing finger bones = AI loses finger control.

3. **Create MuJoCoBodyManager.ts** (`src/world/engine/MuJoCoBodyManager.ts`)
   - Public API mirroring HumanoidMultiBodyManager: `activate()`, `deactivate()`, `getRigidBodiesMap()`, `getBoneColliderHandle()`, `getCapsuleBody()`, `syncRigidBodiesFromBones()`
   - In `activate()`: call `generateHumanoidMJCF()`, load via MuJoCo WASM API, create simulation, build bone name → body ID mapping
   - In `syncRigidBodiesFromBones()`: set `sim.data.qpos` from bone world positions, zero out `sim.data.qvel`

4. **Extend MuJoCoPhysicsEngine.ts** (from Phase 1)
   - Add `loadMJCFModel(xml)`, `getModel()`, `getData()` methods
   - Add body ID tracking: `Map<string, number>` (boneName → bodyId)
   - Update `step()` and velocity clamping for the loaded model

### What NOT to change
- DO NOT modify HumanoidMultiBodyManager.ts or any Rapier-dependent file
- DO NOT wire MuJoCoBodyManager to HumanoidPhysicsBinder yet (Phase 3)
- The application must work exactly as before when useMuJoCo is false

### Key unknowns you MUST investigate
- What is the exact MuJoCo WASM API for loading MJCF XML? `mj.loadModelFromString()`?
- How does MuJoCo handle nested body transforms vs Rapier's flat world-position approach?
- How do `contype` and `conaffinity` bitmasks work in MuJoCo vs Rapier's group masks?
- Do CAPSULE_ATTACH_BONES need `<freejoint>` or should they be direct children of world body?
```

---

### PHASE 3: Actuator System & Motor Control

**Files to create**: `MuJoCoMotorController.ts`, `HumanoidPhysicsBinderMuJoCo.ts`
**Files to modify**: `MJCFHumanoidTemplate.ts`, `MuJoCoBodyManager.ts`, `AvatarSynchronizer.ts`, `ObservationBuilder.ts`, `useWorld.ts`

```
## PHASE 3: Actuator System & Motor Control

### Objective
Replace the manual PD torque control system (the #1 source of instability) with MuJoCo's native actuator system. Wire the AI motor targets to MuJoCo position actuators. This is the MOST COMPLEX phase — the manual torque code in HumanoidMultiBodyManager.setTargets() is ~300 lines of quaternion math that ALL goes away.

### What to do

1. **Study the manual PD torque code**
   - Read `HumanoidMultiBodyManager.setTargets()` VERY carefully — every line. This is what you're replacing.
   - Understand the flow for a spherical joint: parse target → compute rawTarget quat → read child/parent rotations → compute currentRelQuat → compute errorQuat → extract errorAngle+axis → read angular velocity → compute localTorque = stiffness*errorAngle*axis - damping*localAngVel → clamp at MAX_TORQUE=15 → body.addTorque()
   - Understand the balance torque on capsule (separate PD with BALANCE_KP=200)
   - Understand the "untargeted bones" fallback (pulled to bind pose)

2. **Create MuJoCoMotorController.ts** (`src/world/engine/MuJoCoMotorController.ts`)
   - Replaces BOTH `RapierJointMotorController` AND the torque computation in `HumanoidMultiBodyManager.setTargets()`
   - Public API: `init()`, `setTargets(currentTargets)`, `setTargetAngle()`, `setGainScale()`, `setLimpMode()`, `getJointCount()`
   - In `setTargets()`: For each target bone, convert Synthia format to MuJoCo actuator control:
     - Revolute joints → `sim.data.ctrl[actuatorId] = targetAngle`
     - Spherical joints → set 3 actuator controls (one per axis)
     - MuJoCo's position actuator does: `force = kp * (ctrl - qpos) - kv * qvel` — this IS the PD control, solved by the constraint solver. NO manual torque.
   - Map bone names to actuator indices based on MJCF XML order

3. **Update MJCFHumanoidTemplate.ts** — Add actuators
   - Add `<actuator>` section. For each bone: `<position name="act_<name>" joint="<name>_j" kp="X" kv="Y" ctrlrange="min max"/>`
   - Use kp/kv from existing BONE_PD_GAINS (read from HumanoidMultiBodyManager.ts)
   - Spherical joints may need 3 position actuators or a single ball-joint actuator (investigate)
   - Finger bones: kp=5, kv=1

4. **Create HumanoidPhysicsBinderMuJoCo.ts**
   - All non-physics logic stays identical: timeline, constraint validation, lerp, debug spheres, camera helpers, bone extraction, model loading, K-GRF concept
   - What changes:
     - `createRigidBodiesAndColliders()` → MuJoCoBodyManager.activate()
     - `syncVisuals()` → `mj.getBodyPosition()` / `mj.getBodyQuaternion()` instead of Rapier accessors
     - `updateMotorTargets()` → MuJoCoMotorController instead of manual PD torque
     - Ground raycast → MuJoCo raycasting
     - `executeJump()` → `sim.data.qvel` modification
     - `setCapsulePosition()` → `mj.setBodyPosition()`
     - K-GRF: MuJoCo contact array instead of Rapier contact force registry

5. **Update AvatarSynchronizer.ts** and ObservationBuilder.ts
   - Add method overloads/parallel methods accepting MuJoCo body IDs + sim reference
   - Quaternion/position format is identical — only the accessor changes

6. **Update useWorld.ts**
   - When `useMuJoCo=true`: create MuJoCo variants, wire into animation loop
   - Keep Rapier path as `else` branch, completely intact

### Deep dive: Why this phase eliminates the biggest problem
The manual PD torque code applies EXTERNAL torques that fight Rapier's impulse solver. At high stiffness (>600), the solver and external torques oscillate — this IS the "jitter" the diagnostic tool detects. MuJoCo's actuators are INTERNAL to the constraint solver. No external-vs-internal fight. Stiffness values of 2000+ are stable.

### What NOT to change
- DO NOT modify timeline system, constraint validation, AI coordinator, WorldEngine, CameraManager
- The Rapier path must remain fully functional

### Key unknowns you MUST investigate
- How does MuJoCo's position actuator work for ball joints? 3 separate 1-DOF actuators or one 3-DOF actuator?
- What is the actuator ctrl array index mapping? How do you find index by name?
- How do you raycast in MuJoCo WASM? `mj.rayCast()` or `mj.ray()`?
- How do you read contact data? `sim.data.contact` array format?
- How do you apply a velocity impulse? `sim.data.qvel` modification or `mj.applyFT()`?
```

---

### PHASE 4: Collision, Objects & Environment

**Files to create**: `MuJoCoObjectManager.ts`, `MuJoCoCollisionAdapter.ts`
**Files to modify**: `MuJoCoPhysicsEngine.ts`, `useWorld.ts`, `constants/physics.ts`

```
## PHASE 4: Collision, Objects & Environment

### Objective
Port ObjectManager to use MuJoCo collision geoms and contact detection. Keep piano note detection (88 sensor geoms), button press detection, custom 3D model spawning, and dragging working.

### What to do

1. **Study the existing ObjectManager**
   - Read `ObjectManager.ts` carefully — understand object creation, collision event draining, piano note detection via `collider._synthiaNote`, dragging/kinematic objects, custom model spawning (convexHull/trimesh)

2. **Create MuJoCoObjectManager.ts** (`src/world/engine/MuJoCoObjectManager.ts`)
   - Same public API as `ObjectManager.ts`. Every method signature matched.
   - Key MuJoCo differences:
     - Runtime body addition: MuJoCo models are static after loading. Options: pre-allocate pool of N bodies, use `mj.addBody()` if available, or rebuild MJCF string + reload. Choose the approach that works with WASM bindings.
     - Contact detection: iterate `sim.data.contact` array — no event queue draining
     - Piano notes: use MuJoCo geom names (e.g., `geom name="piano_C4"`)
     - Dragging: set body kinematic by fixing joint DOFs, directly set `sim.data.qpos`
   - Geom shape mapping: ball→sphere, cuboid→box, cylinder→cylinder, capsule→capsule, convexHull→mesh, trimesh→mesh
   - Collision filtering via `contype`/`conaffinity` (different from Rapier's 16/16 bit split scheme)

3. **Create MuJoCoCollisionAdapter.ts**
   - Helper functions: `presetToMJCFGeom()`, `getCollisionPairs()`, `isGeomInContact()`
   - Bridge between Rapier event-based and MuJoCo array-based contact systems

4. **Update physics constants** (`src/constants/physics.ts`)
   - Add MuJoCo collision bit constants: `RAGDOLL_CONTYPE=1`, `RAGDOLL_CONAFFINITY=2`, `ENVIRONMENT_CONTYPE=2`, `ENVIRONMENT_CONAFFINITY=3`
   - Adapt from Rapier's split 16/16 group mask scheme

5. **Update useWorld.ts**
   - When `useMuJoCo=true`: use `MuJoCoObjectManager`, wire same event callbacks (piano→audio, button→outcome)
   - Keep Rapier path intact

### What NOT to change
- DO NOT modify ObjectManager.ts
- DO NOT modify piano note logic or AudioEngine
- The Rapier path must remain fully functional

### Key unknowns you MUST investigate
- Can you add/remove bodies from MuJoCo simulation at runtime in WASM bindings?
- How do MuJoCo mesh geoms work — from vertex arrays or file paths?
- How does MuJoCo's contact array map to geom names for piano note detection?
- Performance cost of reloading entire MJCF model for each object spawn?
```

---

### PHASE 5: Cleanup, Diagnostics & Final Integration

**Goal**: Update jitter diagnostic, tune actuator gains, test all features, remove Rapier code.

```
## PHASE 5: Cleanup, Diagnostics & Final Integration

### Objective
Update the jitter diagnostic for MuJoCo (simpler + more accurate since actuator forces are directly available), tune actuator gains to eliminate all jitter, test all features end-to-end, and remove all Rapier dependencies. This is the final phase.

### What to do

1. **Create MuJoCoDiagnostic.ts** (`src/world/engine/MuJoCoDiagnostic.ts`)
   - Read `PhysicsDiagnostic.ts` to understand the API and report format
   - Reimplement for MuJoCo: sample `sim.data.qvel` (angular vel), `sim.data.qpos` (joint pos), `sim.data.actuator_force` (torque, DIRECTLY available — no estimation needed)
   - Same verdict system (STABLE/WATCH/JITTER/CRITICAL) but recalibrate thresholds — MuJoCo is inherently more stable
   - Same console mute/unmute pattern, JSON export, `window.__SYNTHIA_DIAG__` global handle

2. **Tune actuator gains**
   - Start with: legs kp=400/kv=80, arms kp=200/kv=40, spine kp=300/kv=60, neck/head kp=150/kv=30, fingers kp=5/kv=1, balance kp=100/kv=40
   - Test each group independently, increase gradually
   - Run diagnostic after each tuning iteration. GOAL: ALL bones "STABLE" at rest, zero oscillation, zero torque clamping
   - MuJoCo should be stable at 2-3× higher gains than Rapier

3. **Test all features end-to-end**
   - Standing, AI motor control, locomotion (K-GRF), ragdoll mode, jumping, piano, object spawning, custom models, world boundaries, timeline sequences, all cameras

4. **Remove Rapier dependencies** (after full verification)
   - Delete: PhysicsEngine.ts, HumanoidPhysicsBinder.ts, HumanoidMultiBodyManager.ts, RapierJointMotorController.ts, ProceduralMotorController.ts, RagdollBuilder.ts, ProceduralHumanoidBuilder.ts, ObjectManager.ts, PhysicsDiagnostic.ts
   - Rename MuJoCo variants to drop the "MuJoCo" prefix
   - Update ALL imports across entire codebase — use search_files for every reference
   - `npm uninstall @dimforge/rapier3d-compat`
   - `tsc --noEmit` + `npm run build` → zero errors

5. **Update useWorld.ts and worldStore.ts** — remove `useMuJoCo` flag, clean conditional branches

6. **Final diagnostic run**: `window.__SYNTHIA_DIAG__.start(600)` — verify ALL bones "STABLE"

### What NOT to change
- DO NOT modify AI coordinator, Three.js rendering, timeline system, UI components, AudioEngine
- ONLY delete Rapier files after full verification with MuJoCo

### Success criteria
1. `npm run build` succeeds with zero TypeScript errors
2. `npm run dev` starts without errors
3. Humanoid loads and stands upright without jitter
4. AI can control humanoid via joint targets
5. Locomotion (K-GRF), ragdoll, jumping, piano, objects all work
6. Diagnostic shows ALL bones STABLE at rest
7. Zero `@dimforge/rapier3d-compat` imports remain in codebase
8. The jitter diagnostic is now a validation tool, not a debugging necessity
```

---

## Critical Warnings for Jules

1. **Coordinate system**: MuJoCo uses Z-up. Synthia uses Y-up. This is the #1 likely source of bugs. Choose ONE approach and be consistent throughout all 5 phases.

2. **MuJoCo WASM API**: The JavaScript bindings may expose a SUBSET of the C API. Read the actual npm package's type definitions to know what's available. Do NOT assume any function exists.

3. **The `claude ragdoll.html` file**: This standalone Rapier+Three.js demo in the project root is an excellent test target. Port it to MuJoCo first to prove the concept before touching the main codebase.

4. **Files that must stay untouched**: `WorldEngine.ts`, `CameraManager.ts`, `AudioEngine.ts`, all `constants/` files except `physics.ts`, all `coordinator/` files, all `components/` files. If these break, you made a mistake.

5. **Rollback plan**: Use git. Commit after every stable checkpoint. The Rapier path stays fully operational until Phase 5 deletion.

---

The full report with complete file inventory, data flow diagrams, invariants, file-by-file migration impact tables, and detailed prompts for all 5 phases is saved at `project_info__29.md` in the project root.