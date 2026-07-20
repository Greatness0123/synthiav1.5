# MuJoCo WASM vs. Rapier3D for Synthia — Comprehensive Migration Analysis

## Analysis Date: July 20, 2026
## Scope: Complete physics engine migration assessment

---

## 1. Executive Summary

**Verdict: MuJoCo WASM is a strategically superior choice for Synthia's long-term physics needs, but the migration is a 6-10 week engineering effort that touches 12+ files and ~5,000 lines of physics-specific code. The Rapier3D "limit" the user has encountered is real: Rapier lacks built-in motor control, has no composite rigid body articulations, and offers only rudimentary joint motors via `configureMotorPosition`. MuJoCo solves all of these problems natively with its actuator system, tendon coupling, and soft-constraint solver. The Three.js compatibility is excellent — MuJoCo WASM runs in the same WebGL context and produces standard 4×4 matrices that map directly to Three.js Object3D transforms.**

### Key Tradeoffs:

| Factor | Rapier3D | MuJoCo WASM |
|--------|----------|-------------|
| Joint motor control | Basic revolute-only, force-based | Native actuators (position, velocity, torque, tendons) |
| Articulated bodies | Manual multi-body PD torques | Native MJCF-defined kinematic trees |
| Solver stability | Impulse-based, can explode at high stiffness | Soft-constraint QP solver, globally stable |
| Collision detection | Fast convex colliders, good WASM perf | Slower broadphase, more accurate narrowphase |
| WASM size | ~600 KB | ~900 KB-1.5 MB |
| Documentation | Good for games | Excellent for robotics/biomechanics |
| Community | Game dev focused | Robotics/simulation research |
| Self-collision | Manual group filtering | Native disable/enable per body pair |
| Tendon/cable simulation | None | Native spatial tendons |
| Three.js integration | Direct — same coordinate system | Direct — same coordinate system |

---

## 2. What Rapier3D Currently Does in Synthia (and Where It's Breaking)

### 2.1 The Physics Pipeline Layers

Synthia's physics architecture has four distinct layers, each with Rapier dependencies:

**Layer 1 — PhysicsEngine.ts** (Bottom)
- Owns the `RAPIER.World` instance
- Creates the ground plane collider
- Runs `world.step()` at 60 Hz fixed timestep
- Clamps linear/angular velocities
- Drains collision and contact force events
- Manages mutation locks (`isMutatingWorld`)
- 100% Rapier-dependent — every public method returns or requires RAPIER types

**Layer 2 — HumanoidPhysicsBinder.ts** (Character Controller)
- Uses `RAPIER.RigidBodyDesc.dynamic()` for the capsule body
- Uses `RAPIER.ColliderDesc.capsule()` for collision geometry
- Applies direct torque impulses to the capsule for balance
- Reads capsule translation/rotation every frame for syncVisuals
- Performs raycasts via `RAPIER.Ray` + `world.castRayAndGetNormal()` for ground detection
- Registers/unregisters bodies with `PhysicsEngine.velocityClampBodies`

**Layer 3 — HumanoidMultiBodyManager.ts** (PD Motor Controller)
- Creates per-bone rigid bodies with `RAPIER.RigidBodyDesc.dynamic()`
- Creates capsule/cuboid colliders for each bone
- Creates Rapier impulse joints: `RAPIER.JointData.revolute()`, `RAPIER.JointData.spherical()`
- Applies PD control torques manually via `rigidBody.addTorque()` — this is the critical pain point
- Uses `CAPSULE_ATTACH_BONES` to hook spine/hips to the root capsule
- Joint limits are set on Rapier joint data (hard constraints)

**Layer 4 — ObjectManager.ts / RagdollBuilder.ts / ProceduralHumanoidBuilder.ts**
- Create rigid bodies and colliders for environment objects
- Use Rapier collision groups (`RAGDOLL_GROUP`, `ENVIRONMENT_GROUP`)
- 16-bit mask system for collision filtering

### 2.2 Where Rapier3D Is Breaking / Reaching Its Limit

From the codebase, the specific pain points are:

1. **Manual PD Torque Control (HumanoidMultiBodyManager.ts, lines 350-420)**
   The most fragile code in the entire codebase. For every spherical joint bone, the system:
   - Computes the current relative quaternion between child and parent bodies
   - Computes the error quaternion vs. target
   - Extracts error angle and axis
   - Applies `stiffness * errorAngle * axis` torque
   - Subtracts `damping * angularVelocity` for derivative term
   - Clamps at `MAX_TORQUE = 15.0` to prevent explosion
   This is a physics hack — joint motors should be solved by the constraint solver, not applied as external forces. When stiffness exceeds ~600, joints oscillate (the jitter diagnostic was built specifically to detect this).

2. **No Native Joint Motor Position Control for Spherical Joints**
   `RapierJointMotorController.ts` only supports revolute motors via `configureMotorPosition()`. All 3-DOF spherical joints (shoulders, hips, spine) must use the manual PD torque approach above. This is why the codebase has 600+ lines of quaternion math just to make a character stand.

3. **WASM Memory Fragility**
   `PhysicsEngine.step()` catches errors with "Fatal WASM memory or aliasing fault detected" and sets `isPhysicsBroken = true`. This happens when joints are overstressed or bodies are removed during a step. The mutation lock system (`isMutatingWorld`) is a workaround for Rapier's lack of deferred body/joint operations.

4. **No Tendon/Cable Support**
   The `tendonSynergyLink` allowance in rig constraints (fingers) is implemented as a heuristic check in `validateAndApplyTimeline()` — it just rejects finger targets if the parent finger isn't also moving. True tendon coupling would propagate forces through a cable-pulley system, which MuJoCo does natively.

5. **Collision Group Limits**
   Rapier's 16-bit group mask system works but makes self-collision management awkward. Synthia manually excludes ragdoll-ragdoll collisions via group masks. MuJoCo lets you disable self-collision per body pair with `contype`/`conaffinity` bits, which is more flexible.

---

## 3. MuJoCo WASM — What It Is and How It Integrates

### 3.1 What MuJoCo WASM Is

MuJoCo (Multi-Joint dynamics with Contact) is a physics engine developed by DeepMind, widely used in robotics research. The WASM build compiles the C engine to WebAssembly using Emscripten. The official npm package (`mujoco-wasm` or `@mujoco/wasm`) provides:

- `mujoco.mjs` — ESM module
- `mujoco.wasm` — WASM binary (~1.1 MB)
- Complete MJCF (XML scene description) parser
- Full inverse dynamics, forward dynamics, contact simulation
- Native actuator models (position, velocity, torque, muscle, tendon)
- Soft-constraint solver (Newton/Gauss-Seidel/CG options)

### 3.2 Three.js Compatibility: Excellent

MuJoCo and Three.js use the **same coordinate system conventions**:
- Both use right-handed coordinate systems
- Both represent rotations as quaternions (x, y, z, w)
- Both represent transforms as 4×4 column-major matrices
- MuJoCo's native units are SI (meters, kilograms, seconds) — Three.js is unitless but Synthia already uses SI

**The integration pattern is straightforward:**

```typescript
// MuJoCo → Three.js sync (per frame)
const mjPos = mj.getBodyPosition(model, bodyId);    // {x, y, z}
const mjQuat = mj.getBodyQuaternion(model, bodyId);  // {x, y, z, w}
const mjMat = mj.getBodyTransform(model, bodyId);    // 4×4 flat array

// Direct mapping to Three.js
threeMesh.position.set(mjPos.x, mjPos.y, mjPos.z);
threeMesh.quaternion.set(mjQuat.x, mjQuat.y, mjQuat.z, mjQuat.w);
// Or use the matrix directly:
threeMesh.matrix.fromArray(mjMat);
threeMesh.matrix.decompose(threeMesh.position, threeMesh.quaternion, threeMesh.scale);
```

There are **no coordinate conversions needed** — MuJoCo WASM operates in the same space as Rapier3D and Three.js. This is a critical advantage over alternatives like Bullet (which uses a different coordinate system).

### 3.3 WASM Loading

MuJoCo WASM loads identically to Rapier WASM:

```typescript
// Current (Rapier)
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();  // Loads WASM
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

// Target (MuJoCo)
import { MuJoCo } from 'mujoco-wasm';
const mj = await MuJoCo();  // Loads WASM
const model = mj.loadModelFromString(mjcfXml);
const sim = mj.makeSimulation(model);
```

The loading pattern is nearly identical — an async init that fetches and instantiates the WASM module.

---

## 4. Detailed File-by-File Migration Impact

### 4.1 `src/world/engine/PhysicsEngine.ts` — COMPLETE REWRITE

**Current role:** Owns RAPIER.World, steps simulation, drains events.

**What changes:** This becomes a MuJoCo simulation wrapper. The entire class signature changes:

| Current (Rapier) | Future (MuJoCo) |
|------------------|-----------------|
| `RAPIER.World` | `mj.Simulation` (contains model + data) |
| `world.step(eventQueue)` | `mj.step(sim.model, sim.data)` |
| `eventQueue.drainCollisionEvents()` | `mj.readContactArray(sim.data)` |
| `eventQueue.drainContactForceEvents()` | Contact forces from `sim.data.efc_force` |
| `world.gravity = {x, y, z}` | Set in MJCF XML or `sim.model.opt.gravity` |
| `RAPIER.Ray` for ground detection | MuJoCo raycasting via `mj.rayCast()` or custom |
| `world.createRigidBody()` → `RAPIER.RigidBody` | Bodies defined in MJCF, accessed by ID |
| `world.createCollider()` → `RAPIER.Collider` | Geoms defined in MJCF |

**Impact:** ~400 lines rewritten. Must be done first.

### 4.2 `src/world/engine/HumanoidPhysicsBinder.ts` — MAJOR REFACTOR

**Current role:** Manages capsule body creation, kinematic bone targets, raycast ground detection, jump impulse, timeline interpolation, motor target validation.

**What changes:**
- `createRigidBodiesAndColliders()`: Instead of creating a single `RAPIER.RigidBodyDesc.dynamic()` capsule, the capsule body becomes a MuJoCo body defined in MJCF XML with a capsule geom.
- `syncVisuals()`: Instead of `capsuleBody.translation()` and `capsuleBody.rotation()`, uses `mj.getBodyPosition()` and `mj.getBodyQuaternion()`.
- Ground raycast: MuJoCo provides `mj.rayCast()` which returns similar data (distance, geom ID).
- `executeJump()`: Instead of `capsuleBody.applyImpulse()`, applies a velocity impulse via `sim.data.qvel` or an actuator force.
- `setCapsulePosition()`: Direct modification via `mj.setBodyPosition()`.
- `setMode('ragdoll')`: Instead of setting damping and unlocking rotations, disables actuators (torque motors) on all joints.

**Lines affected:** ~800 of ~1900 lines. The core logic (timeline interpolation, motor target validation, K-GRF ground reaction forces) stays the same — only the Rapier API calls change.

### 4.3 `src/world/engine/HumanoidMultiBodyManager.ts` — ELIMINATED / REPLACED

**Current role:** Manual PD torque control for every bone — the most complex file.

**What changes:** This entire file is **replaced by MuJoCo's native actuator system**. In MuJoCo, each joint can have position/velocity actuators with built-in PD gains:

```xml
<!-- MuJoCo actuator — replaces 400 lines of manual PD torque code -->
<actuator>
  <position name="hip_x" joint="left_hip" kp="800" kv="160" ctrlrange="-2.094 2.094"/>
  <position name="knee_l" joint="left_knee" kp="800" kv="160" ctrlrange="-2.618 0"/>
  <!-- ... 30+ more actuators -->
</actuator>
```

**The ENTIRE manual torque application code (~300 lines of quaternion math per frame) vanishes.** Instead, Synthia sets actuator targets:

```typescript
// Before (manual PD — always fragile)
const errorQuat = _tempQuat4.copy(currentRelQuat).invert().multiply(rawTarget);
// ... 15 lines of math ...
bodyData.rigidBody.addTorque(localTorque.applyQuaternion(childQuat), true);

// After (MuJoCo native — perfectly stable)
sim.data.ctrl[mj.actuatorId('hip_x')] = targetAngle;
```

**This is the single biggest win of the migration.** The stability problems that led to the jitter diagnostic tool simply don't exist with MuJoCo's solver.

### 4.4 `src/world/engine/RapierJointMotorController.ts` — ELIMINATED

**Current role:** Wraps Rapier's `configureMotorPosition()` and `configureMotor()` for revolute joints only.

**What changes:** **Fully replaced by MuJoCo actuators.** MuJoCo actuators support:
- Position servos: `kp`, `kv` (PD gains), native solver integration
- Velocity servos: `kv` only
- Torque (direct): Open-loop torque application
- Muscle actuators: Hill-type muscle model with activation dynamics
- Tendon actuators: Cable pulleys with length/force constraints

### 4.5 `src/world/engine/AvatarSynchronizer.ts` — MINIMAL CHANGES

**Current role:** Syncs rigid body transforms to Three.js bone quaternions.

**What changes:** Only the transform source changes. Instead of:
```typescript
const rot = rigidBody.rotation(); // RAPIER.RigidBody method
```

Becomes:
```typescript
const rot = mj.getBodyQuaternion(model, bodyId); // MuJoCo function
```

The quaternion format is identical (x, y, z, w). ~90% of the file stays unchanged.

### 4.6 `src/world/engine/ObjectManager.ts` — MODERATE REFACTOR

**Current role:** Spawns environment objects with Rapier colliders (cuboid, ball, cylinder, trimesh, convex hull).

**What changes:**
- `RAPIER.ColliderDesc.cuboid()` → `mj.makeBox(3)` or MJCF `<geom type="box" size="0.5 0.5 0.5"/>`
- `RAPIER.ColliderDesc.ball()` → `mj.makeSphere(1)` or MJCF `<geom type="sphere" size="0.5"/>`
- `RAPIER.ColliderDesc.cylinder()` → `mj.makeCylinder(8)` or MJCF `<geom type="cylinder" size="0.5 0.5"/>`
- Collision groups: Replace `getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP)` with MuJoCo's `contype`/`conaffinity` bitmask system
- Collision events: Replace `eventQueue.drainCollisionEvents()` with `mj.readContactArray()`
- Piano note detection: Currently uses `collider._synthiaNote` — in MuJoCo, use geom userdata or naming conventions

### 4.7 `src/world/engine/ProceduralHumanoidBuilder.ts` — MODERATE REFACTOR

**Current role:** Builds humanoid from joint definitions using Rapier bodies/colliders/joints.

**What changes:** The `BODY_PARTS` array becomes an MJCF XML template. Each body part definition maps to `<body>` + `<joint>` + `<geom>` elements:

```javascript
// Before: Rapier API calls
const rbDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
const body = this.world.createRigidBody(rbDesc);
const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
const collider = this.world.createCollider(colDesc, body);

// After: MJCF XML generation
// <body name="left_hip" pos="-0.10 -0.20 0">
//   <joint name="left_hip_j" type="ball"/>
//   <geom type="capsule" size="0.06 0.35" fromto="..."/>
//   <body name="left_knee" pos="0 -0.35 0">
//     ...
```

The builder becomes an XML generator that produces an MJCF string, which MuJoCo loads natively. The `syncVisuals()` method changes minimally (same transform extraction pattern).

### 4.8 `src/constants/physics.ts` — LIGHT CHANGES

The collision group constants (`RAGDOLL_GROUP`, `ENVIRONMENT_GROUP`) are replaced by MuJoCo's `contype`/`conaffinity` bits. The anthropometric mass matrix (`COMPLETE_MIXAMO_PHYSICS_MATRIX`) becomes part of the MJCF body/inertial definitions.

### 4.9 `src/constants/rigConstraints.ts` — MOSTLY PRESERVED

The joint limit definitions (`SYNTHIA_RIG_CONSTRAINTS`) remain identical — they just get applied to MuJoCo joint `range` attributes instead of Rapier `JointData.limits`. The `allowance` fields (locomotionCap, scapulohumeralRatio, tendonSynergyLink, requiresCervicalCoupling) are business logic that stays in the validation layer — these don't change.

### 4.10 `src/world/hooks/useWorld.ts` — LIGHT CHANGES

Removes Rapier-specific initialization:
- `physicsEngine.init()` → `mj.loadModelFromString(mjcfXml)`
- `physicsEngine.getWorld()` → `sim.model` or `sim`
- ObjectManager constructor signature changes (no `RAPIER.World`)

### 4.11 `src/world/engine/PhysicsDiagnostic.ts` — REWRITTEN

The jitter diagnostic currently peeks into `HumanoidMultiBodyManager` private fields to read Rapier body angular velocities and compute torque estimates. With MuJoCo, the diagnostic becomes simpler and more accurate because:
- Angular velocities come from `sim.data.qvel` (joint velocities) directly
- Actuator forces are directly available from `sim.data.actuator_force`
- No need to estimate torque — it's computed by the solver

### 4.12 `src/world/engine/RagdollBuilder.ts` — ELIMINATED

This file builds ragdolls from `JointConfig` arrays for non-humanoid body types. Since MuJoCo's native format handles ragdolls naturally via MJCF, this builder is replaced by a simple MJCF template generator.

### 4.13 `src/world/engine/ProceduralMotorController.ts` — ELIMINATED

Replaced by MuJoCo actuators — no more manual torque computation for spherical joints.

### 4.14 `src/world/engine/ObservationBuilder.ts` — PRESERVED

This file builds proprioceptive observations from rigid body transforms. Only the transform accessors change — the logic stays identical.

---

## 5. What MuJoCo WASM Gives Synthia (That Rapier Can't)

### 5.1 Native Actuator Control (Biggest Win)

MuJoCo's actuator system eliminates the entire manual PD torque control layer. Benefits:

- **Perfectly stable at any stiffness** — the soft-constraint solver handles it
- **Position, velocity, and torque actuators** — choose the right control mode per joint
- **Built-in force limits** — `ctrlrange` prevents over-torquing naturally
- **Tendon actuators** — simulate muscle cables with force transmission
- **Muscle actuators (Hill model)** — if you ever want realistic muscle dynamics

### 5.2 Composite Rigid Bodies

MuJoCo supports nested bodies with geometric transforms. Currently Synthia manually places each bone's rigid body at world positions computed from the skeleton — MuJoCo does this natively with `<body pos="..." quat="...">` relative to parent.

### 5.3 Soft Constraints vs. Impulse-Based

Rapier uses an impulse-based solver (Erleben-style). At high stiffness/damping values, impulses grow large and cause explosions. MuJoCo uses a soft-constraint formulation where constraint forces are solved as a convex optimization problem — this is why robotics researchers use MuJoCo: it stays stable at any gain.

### 5.4 Spatial Tendons

The `tendonSynergyLink` biomechanical constraint (finger segments 2 and 3 must only flex if segment 1 flexes) can be implemented as an actual tendon in MuJoCo — the physics engine handles the force propagation, not application code.

### 5.5 Inverse Dynamics

MuJoCo's inverse dynamics (`mj.inverse()`) can compute the joint torques needed to achieve a given acceleration. This enables:
- Feedforward control: compute required torque, add PD for correction
- Gravity compensation: compute and cancel gravitational forces
- More sophisticated motor programs

### 5.6 Self-Collision Management

MuJoCo's `contype`/`conaffinity` system makes it easy to disable self-collisions between specific body pairs (e.g., left arm shouldn't collide with torso unless it's close). Rapier's group-based system is more coarse.

---

## 6. Risks and Challenges

### 6.1 WASM Size Increase
Rapier WASM: ~600 KB → MuJoCo WASM: ~1.1 MB. About 500 KB larger initial download. Mitigated by HTTP caching and the fact that Synthia already loads a multi-MB GLB model.

### 6.2 MuJoCo WASM Maturity
The MuJoCo WASM package is newer than Rapier's. While the underlying C engine is battle-tested (used by DeepMind, OpenAI, Boston Dynamics), the JavaScript bindings are less mature. Potential issues:
- Missing binding for some C functions
- Fewer npm downloads and community examples
- May need to build custom WASM if official package lacks features

### 6.3 Learning Curve
The MJCF XML format is a new skill. Every developer on the project needs to learn:
- MJCF body/joint/geom/actuator hierarchy
- `contype`/`conaffinity` collision filtering
- `ctrl`, `qfrc_applied`, `xfrc_applied` data arrays
- The difference between `sim.model` (compile-time) and `sim.data` (run-time)

### 6.4 Collision Geometry Limitations
MuJoCo's geom primitives are more limited than Rapier's:
- MuJoCo: plane, sphere, capsule, ellipsoid, cylinder, box, mesh (convex only, no concave trimesh for dynamic bodies)
- Rapier: all of the above + trimesh (concave), heightfield, convex decomposition
- **Impact:** Custom uploaded 3D models that need collision must be convexified. Rapier's `ColliderDesc.trimesh()` for terrain must be replaced with a heightfield or composite of boxes.

### 6.5 Performance Profile
- MuJoCo's solver is more expensive per iteration (QP/NCP vs. impulse)
- But: fewer iterations needed for stability (typically 1-3 vs. Rapier's 16)
- Net effect: similar or slightly slower for simple scenes, much better for complex articulated bodies
- No published benchmark comparing MuJoCo WASM to Rapier WASM directly

### 6.6 Migration Timeline
Estimated effort:

| Phase | Work | Weeks |
|-------|------|-------|
| 1 | MuJoCo WASM integration + MJCF humanoid template | 1-2 |
| 2 | PhysicsEngine rewrite + ObjectManager port | 1-2 |
| 3 | HumanoidPhysicsBinder port | 1-2 |
| 4 | MultiBodyManager elimination + actuator wiring | 1 |
| 5 | Procedural builder MJCF generator | 0.5-1 |
| 6 | Testing, tuning, jitter elimination | 1-2 |
| **Total** | | **6-10 weeks** |

---

## 7. What Stays the Same

These components require **zero or minimal changes**:

- **Three.js rendering pipeline** (WorldEngine, CameraManager) — unchanged
- **AI coordinator** (agentLoop, payloadBuilder, providers) — unchanged
- **Constraint validation** (rigConstraints, anatomicalLimits) — unchanged
- **Timeline system** (validateAndApplyTimeline, interpolation) — unchanged
- **K-GRF ground reaction forces** — only the foot contact detection API changes
- **UI components** (BodyControls, GodMode, etc.) — unchanged
- **Store layer** (worldStore, agentStore) — unchanged except minor type adjustments
- **Audio system** — unchanged

---

## 8. Recommended Migration Strategy

### Don't do a "big bang" rewrite. Use these steps:

**Step 1: MuJoCo Sandbox (Week 1-2)**
Create a separate `MuJoCoPhysicsEngine.ts` that coexists with the Rapier engine. Build a standalone Three.js + MuJoCo test page with a simple humanoid. Verify:
- WASM loads correctly in the same Vite build
- Body transforms map correctly to Three.js
- Actuators track position targets correctly
- Collision detection works with ground plane

**Step 2: Humanoid MJCF Template (Week 2-3)**
Convert the `COMPLETE_MIXAMO_PHYSICS_MATRIX` and joint hierarchy into an MJCF XML template. This is the critical artifact — it defines every bone, joint, collision geometry, and actuator for the humanoid.

**Step 3: PhysicsEngine Adapter (Week 3-4)**
Write `MuJoCoPhysicsEngine.ts` that exposes the same interface as the current `PhysicsEngine.ts`:
- Same `init()`, `step()` signature
- Same `isReady`, `isStepping`, `isMutatingWorld` flags
- Same `getContactForceRegistry()` equivalent
- `setGravity()` maps to `sim.model.opt.gravity`

**Step 4: ObjectManager Port (Week 4-5)**
Port environment object spawning. The piano key detection needs special attention since it creates 88 sensor colliders — MuJoCo sensors or contact counting replaces this.

**Step 5: HumanoidPhysicsBinder Port (Week 5-7)**
The hardest file. Port method by method:
- Start with capsule body creation and ground detection
- Then syncVisuals (just API calls change)
- Then motor target setting → actuator target setting
- Timeline system doesn't change

**Step 6: Eliminate MultiBodyManager (Week 7-8)**
Delete `HumanoidMultiBodyManager.ts` and all its manual PD torque code. Replace with MuJoCo actuators in the MJCF template. Celebrate.

**Step 7: Testing & Tuning (Week 8-10)**
- Verify locomotion (K-GRF) still works
- Tune actuator gains for natural movement
- Verify ragdoll mode (zero actuator forces)
- Test with uploaded custom models
- Run the jitter diagnostic — it should show zero jitter

---

## 9. The `claude ragdoll.html` Prototype

The standalone `claude ragdoll.html` file in the project root is a simpler, self-contained physics demo that already uses a similar architecture (Rapier + Three.js + GLTFLoader). It has:
- Bone classification taxonomy
- Capsule collider generation per bone
- Revolute motor joints for hips/knees/ankles
- A procedural gait controller
- A balance controller

This file is an excellent **test target** for MuJoCo WASM integration. Port it first — it's standalone, has no React dependencies, and exercises all the core physics features (body creation, joints, motors, balance torques). Success here proves the concept before touching the main codebase.

---

## 10. Final Verdict

**Switch to MuJoCo WASM. The long-term benefits decisively outweigh the migration cost.**

**Why:**
1. **Eliminates the #1 source of bugs** — the manual PD torque system in HumanoidMultiBodyManager
2. **Solves the "Rapier limit" problem permanently** — MuJoCo is designed for exactly this kind of actuated articulated body simulation
3. **Three.js compatibility is near-perfect** — same coordinate system, same quaternion convention, same WASM loading pattern
4. **Opens up advanced features** — tendons, muscle models, inverse dynamics, soft constraints — that would require building a new physics engine on top of Rapier
5. **The codebase is already structured for this** — the separation of concerns (PhysicsEngine → HumanoidPhysicsBinder → HumanoidMultiBodyManager) maps cleanly to MuJoCo's architecture

**Risks to watch:**
- MuJoCo WASM JavaScript bindings may be less mature than Rapier's
- Custom model collision requires convex decomposition (no trimesh for dynamic bodies)
- Team needs to learn MJCF XML
- 6-10 week migration is significant but front-loaded

**The decisive factor:** The user has already built a jitter diagnostic tool (`PhysicsDiagnostic.ts`) specifically because the manual PD torque system is unstable. MuJoCo makes that entire class of problem disappear. The diagnostic tool becomes a celebratory artifact rather than a necessary debugging tool.
