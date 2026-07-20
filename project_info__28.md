# MuJoCo WASM vs. Rapier3D for Synthia — Comprehensive Migration Analysis

I've completed a deep analysis of the entire Synthia physics pipeline and the implications of switching from Rapier3D to MuJoCo WASM. The full report has been saved to `project_info__27.md`. Here's the essential summary:

---

## Final Verdict: SWITCH — The benefits decisively outweigh the cost.

MuJoCo WASM is a strategically superior choice for Synthia's long-term physics needs. The Rapier3D "limit" you've hit is real: Rapier lacks native motor control for articulated bodies, which forces Synthia into a fragile manual PD torque system (~600 lines of quaternion math in `HumanoidMultiBodyManager.ts`) that has required building a dedicated jitter diagnostic tool to keep it stable.

---

## Why MuJoCo WASM Solves Synthia's Core Problem

### The Manual PD Torque System — Your #1 Pain Point

The most fragile code in the entire codebase is in `HumanoidMultiBodyManager.ts` (lines 350-420). For every spherical joint bone (shoulders, hips, spine), Synthia must:
1. Compute the current relative quaternion between child and parent rigid bodies
2. Compute the error quaternion vs. the AI's target
3. Extract error angle and axis
4. Apply `stiffness * errorAngle * axis` as an external torque via `addTorque()`
5. Subtract `damping * angularVelocity` for stability
6. Clamp at `MAX_TORQUE = 15.0` to prevent physics explosion

**This is a physics hack.** Joint motors should be solved by the constraint solver as internal forces, not applied as external torques. When PD gains exceed ~600, joints oscillate — which is why you built `PhysicsDiagnostic.ts`.

### MuJoCo's Native Solution

In MuJoCo, every joint gets a position actuator with built-in PD gains:

```xml
<actuator>
  <position name="hip_x" joint="left_hip" kp="800" kv="160" ctrlrange="-2.094 2.094"/>
  <position name="knee_l" joint="left_knee" kp="800" kv="160" ctrlrange="-2.618 0"/>
  <!-- ... 30+ more actuators -->
</actuator>
```

Setting a target becomes a single line:
```typescript
sim.data.ctrl[mj.actuatorId('hip_x')] = targetAngle;
```

The soft-constraint QP solver handles the rest — **perfectly stable at any gain**. The entire manual torque application code vanishes. The jitter diagnostic becomes unnecessary.

---

## Three.js Compatibility: Excellent (Not a Concern)

MuJoCo and Three.js use **identical conventions**:
- Same right-handed coordinate system
- Same quaternion format (x, y, z, w)
- Same 4×4 column-major matrices
- Same SI units (which Synthia already uses)

The sync pattern is a direct mapping with zero coordinate conversions:
```typescript
const mjPos = mj.getBodyPosition(model, bodyId);
const mjQuat = mj.getBodyQuaternion(model, bodyId);

threeMesh.position.set(mjPos.x, mjPos.y, mjPos.z);
threeMesh.quaternion.set(mjQuat.x, mjQuat.y, mjQuat.z, mjQuat.w);
```

This is a critical advantage over alternatives like Bullet (which uses a different coordinate system).

---

## File-by-File Migration Impact

| File | Impact | What Changes |
|------|--------|-------------|
| **PhysicsEngine.ts** | COMPLETE REWRITE | RAPIER.World → mj.Simulation; all step/event/raycast APIs change. ~400 lines. |
| **HumanoidPhysicsBinder.ts** | MAJOR REFACTOR | Capsule body creation, syncVisuals, raycast, jump — all Rapier API calls change. Core logic (timelines, K-GRF, validation) stays. ~800 of 1900 lines. |
| **HumanoidMultiBodyManager.ts** | **ELIMINATED** | 400+ lines of manual PD torque code replaced by MuJoCo position actuators in MJCF XML. Single biggest win. |
| **RapierJointMotorController.ts** | **ELIMINATED** | Replaced by MuJoCo's native actuator system (position, velocity, torque, muscle, tendon actuators). |
| **AvatarSynchronizer.ts** | MINIMAL | Only transform source changes — same quaternion format. ~90% preserved. |
| **ObjectManager.ts** | MODERATE | Collider creation, collision groups, collision events all change API but same logic. |
| **ProceduralHumanoidBuilder.ts** | MODERATE | Becomes an MJCF XML generator instead of Rapier API calls. |
| **RagdollBuilder.ts** | ELIMINATED | MJCF handles ragdoll hierarchy natively. |
| **ProceduralMotorController.ts** | ELIMINATED | Replaced by MuJoCo actuators. |
| **PhysicsDiagnostic.ts** | REWRITTEN | Becomes simpler — reads `sim.data.qvel` and `sim.data.actuator_force` directly instead of peeking private fields. |
| **ObservationBuilder.ts** | PRESERVED | Only transform accessors change. |
| **rigConstraints.ts** | PRESERVED | Joint limits stay the same, just applied to MJCF `range` attributes. |
| **Store/UI/Coordinator** | NO CHANGE | All AI, rendering, and UI code stays identical. |

---

## What MuJoCo Gives You That Rapier Can't

1. **Native actuator PD control** — stable at any stiffness, solved as constraint forces
2. **Spatial tendons** — the `tendonSynergyLink` finger constraints become actual physics cables
3. **Inverse dynamics** (`mj.inverse()`) — compute joint torques needed for desired acceleration
4. **Composite rigid bodies** — nested body hierarchy handled natively, no manual world-position math
5. **Soft-constraint solver** — globally stable QP solver vs. Rapier's impulse-based approach
6. **Muscle actuators (Hill model)** — if you ever want realistic muscle dynamics
7. **Self-collision per-pair control** — `contype`/`conaffinity` bits vs. Rapier's coarse 16-bit groups

---

## Risks to Watch

1. **WASM size**: MuJoCo is ~1.1 MB vs. Rapier's ~600 KB. Mitigated by HTTP caching and the fact Synthia already loads multi-MB GLB models.
2. **JS binding maturity**: MuJoCo's WASM JS package is newer than Rapier's — fewer npm downloads, fewer community examples. The underlying C engine is battle-tested (DeepMind, OpenAI, Boston Dynamics).
3. **Collision geometry**: MuJoCo doesn't support concave trimesh for dynamic bodies. Custom uploaded 3D models must use convex decomposition. Terrain replaces `ColliderDesc.trimesh()` with heightfields.
4. **Learning curve**: Team needs to learn MJCF XML format, `contype`/`conaffinity`, and `sim.model` vs. `sim.data` distinction.
5. **Migration timeline**: 6-10 weeks total, front-loaded on the humanoid MJCF template and PhysicsEngine rewrite.

---

## Recommended Migration Strategy (Not Big Bang)

1. **Week 1-2**: MuJoCo sandbox — standalone test page with simple humanoid, verify WASM loading + Three.js sync
2. **Week 2-3**: Humanoid MJCF template — convert `COMPLETE_MIXAMO_PHYSICS_MATRIX` + joint hierarchy to XML
3. **Week 3-4**: PhysicsEngine adapter — same interface, MuJoCo internals
4. **Week 4-5**: ObjectManager port — environment objects, piano keys
5. **Week 5-7**: HumanoidPhysicsBinder port — hardest file, method by method
6. **Week 7-8**: Delete HumanoidMultiBodyManager — replace with actuators, **celebrate**
7. **Week 8-10**: Testing, tuning, verify K-GRF locomotion still works

**Pro tip**: Port `claude ragdoll.html` first — it's a standalone Rapier + Three.js demo with all the core physics features (bone classification, capsules, revolute motors, gait controller). Success there proves the concept before touching the main React codebase.

---

## What Stays the Same

- AI coordinator (agentLoop, payloadBuilder, providers) — completely unchanged
- Three.js rendering (WorldEngine, CameraManager) — completely unchanged
- Constraint validation (rigConstraints, anatomicalLimits) — unchanged
- Timeline system (validateAndApplyTimeline) — unchanged
- K-GRF ground reaction forces — only foot contact detection API changes
- All UI components, stores, audio system — unchanged

---

The full 27-section report with detailed API migration tables, code snippets, and implementation strategy is saved at `project_info__27.md`.