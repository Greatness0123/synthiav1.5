# Synthia — Humanoid Physics: Motion Capability, Mass/CoM, Joint Locks, Finger Constraints & Ground Friction

## Summary
Synthia is a browser-based humanoid-agent playground (React + Three.js + Rapier3D) in which an LLM/VLM drives a Mixamo-rigged avatar. Two physics modes exist: (1) a **kinematic single-capsule** mode (bones lerped directly), and (2) a **multi-body PD-controlled ragdoll** mode (`HumanoidMultiBodyManager`) where each major bone gets a Rapier rigid body joined to its parent with impulse joints. This report answers your five specific questions against the actual code, then gives concrete implementation plans.

---

## Q1 — Can the model perform actions such as jumping?

**Yes — but only the capsule root can jump; the limbs are not actuated for ballistic motion.**

- `HumanoidPhysicsBinder.executeJump(force = 6.0)` (HumanoidPhysicsBinder.ts) applies an upward `applyImpulse({x:0, y:force, z:0})` to `capsuleBody` **only when `this._isGrounded` is true** (capsule bottom within `GROUND_SNAP_THRESHOLD = 0.12 m` of `groundSurfaceY`). It zeroes linear velocity first, clamps yaw angular velocity to ±2 rad/s, then fires.
- `executeProgramSequence(programs)` routes any program name containing `jump` → `executeJump(6.0)`. Other program names (`walk`, `run`, `wave`, etc.) are **explicitly ignored** with a warning: *"AI must use joint_overrides for locomotion via K-GRF foot strokes."*
- So the **only built-in ballistic action is a vertical capsule hop**. There is no run, crouch-jump, dive, or limb-driven jump. In multi-body mode, the limb bodies are dragged along by the capsule through their impulse joints — they don't contribute thrust.
- Walking is *emergent*, not scripted: `applyKinematicGroundReactionForces()` reads foot-contact forces (multi-body) or foot position deltas (kinematic) and converts them into forward capsule impulses + yaw torque. Whether this produces reliable walking depends entirely on the AI's per-frame joint targets.

**Verdict:** The architecture *permits* a jump action (vertical impulse on the root). It does **not** currently permit coordinated, limb-driven athletic actions (running jump, vault) because limbs are PD position-trackers, not force-appliers.

---

## Q2 — Does the model have a center of gravity or mass?

**Yes — a full anthropomorphic mass matrix, but the CoM is implicit, not tracked.**

- **Per-bone masses/inertia** live in `COMPLETE_MIXAMO_PHYSICS_MATRIX` (src/constants/physics.ts). Total ≈ 75 kg. Hips 12 kg, spine chain 6/5/4 kg, head 4.3 kg, thighs 8.5 kg each, down to finger phalanges at 0.008–0.02 kg with micro-inertia. `getBonePhysics(boneName)` is the single source of truth.
- **The root capsule** is hard-coded to **70 kg** with inertia `{x:10, y:10, z:10}` (`createRigidBodiesAndColliders`), set via `setAdditionalMassProperties`. Its collider is `setDensity(0)` so mass comes only from the explicit value.
- **Center of gravity:** Each rigid body has its own center of mass at its geometric center (`{x:0,y:0,z:0}` local). There is **no computed aggregate whole-body Center of Mass** anywhere in the code. The balance controller (`HumanoidMultiBodyManager.setTargets`) uses a naive **capsule-upright spring** (Kp=200, Kd=80) that torques the capsule toward vertical — it does **not** compute or use a true CoM-over-support-polygon check. This is a real limitation: the character balances by brute-force spring, not by CoM dynamics.

**Verdict:** Mass is realistic and per-bone. A true aggregate CoM / Zero-Moment-Point is **not** modeled — balance is a verticality spring, so "does it have a center of gravity?" = each body yes, the whole agent no (not computed/used).

---

## Q3 — Are the knees locked? Elbows too?

**No — knees and elbows are the ONLY joints with real motorized 1-DOF control; they are not locked, they're actuated.**

- `BONE_JOINT_TYPE` classifies `mixamorigleftleg`/`rightleg` (knees) and `mixamorigleftforearm`/`rightforearm` (elbows) as **`revolute`** — the only revolute joints in the body. Everything else is `spherical`.
- Knee limits (`rigConstraints.ts`): `dof:1, x:[-2.618, 0.0]` rad = **−150° flexion to 0°** (anatomically correct hinge, no hyperextension). Elbow limits: `x:[0.0, 2.531]` = **0° to +145° flexion only**.
- Revolute joints use **Rapier's built-in motor**: `RapierJointMotorController.setTargetAngle` → `joint.configureMotorModel(ForceBased)` + `configureMotorPosition(target, Kp, Kd)`. These are the only joints that get true position-PD via the solver. Gains: knees `{200, 50}`, elbows `{60, 15}`.
- They also get **hard joint limits** (`jointData.limitsEnabled = true`) from `SYNTHIA_RIG_CONSTRAINTS`, plus a second clamp in `anatomicalLimits.getAnatomicalLimitForBone`.

So knees/elbows are **actively driven and limit-constrained**, not locked. If they *appear* locked, the likely cause is the **soft-start ramp**: `MIN_GAIN = 0.30`, ramping over `RAMP_FRAMES = 15` frames, and `settlingFramesLeft` drops gains to `(0.1, 0.8)` after a reset — during these windows the joints are too weak to move against gravity.

---

## Q4 — Finger joints lack angular constraint (your main concern)

**Your instinct is correct — the fingers are the most neglected subsystem. Here's the exact state.**

### What IS there
- `rigConstraints.ts` defines all 24 finger/thumb segments (`...index1/2/3`, `...thumb1/2/3`, etc.) as `dof:1, x:[0.0, 1.745]` (0°–100° flexion), y/z locked to `[0,0]`. Segments 2 & 3 carry `allowance.tendonSynergyLink: true`.
- `anatomicalLimits.getAnatomicalLimitForBone` also returns `{0, 100°}` for thumb/index/middle/ring/pinky.
- Per-bone masses exist (0.008–0.02 kg) and PD gains `{stiffness:5, damping:1}`.
- The **kinematic path** (`HumanoidPhysicsBinder.updateMotorTargets`) handles fingers via `applyKinematicLerpForBone` with a **tendon-synergy guard**: a segment-2/3 target is rejected unless its segment-1 base is also flexed (`tendon_synergy_violation`). This is the ONLY parent-relative coupling that exists.

### What is BROKEN / missing (the real problems)
1. **Fingers have NO Rapier rigid bodies.** In `HumanoidMultiBodyManager.activate`, the `trackedBones` set is built from `BONE_JOINT_TYPE` keys. Although the finger-registration block *does* populate `BONE_JOINT_TYPE`, the manager's finger loop registers them as `'spherical'` — **but the comment in `HumanoidPhysicsBinder.updateMotorTargets` says "Finger bones have no rigid bodies in the multi-body manager"** and routes them through the kinematic lerp. In practice fingers are kinematically lerped even in multi-body mode → they do not physically collide, do not receive PD torque, and their `BONE_PD_GAINS` entry is dead code.
2. **Spherical joints get NO angular limit.** In `HumanoidMultiBodyManager.activate`, the spherical branch only applies a limit when `constraint.dof >= 2`. Finger constraints are `dof:1`, so **the spherical finger joints are created with NO `limitsEnabled`** — your observation is exactly right: the finger joints (as Rapier spherical joints) are unconstrained angularly.
3. **No per-axis (flexion-only) constraint mapping.** Human finger IP/MCP joints are 1-DOF hinges (with MCP allowing slight abduction). The code models them as free spherical ball-sockets with a software clamp in the lerp, not a physical hinge. There is no relative-to-parent hinge axis (joint-4-to-joint-1 chaining) in the physics layer — the "synergy" is only a validation-time rejection, not a mechanical coupling.

### Research summary (correct human finger articulation)
- **MCP joint (knuckle, segment 1):** condyloid — flexion/extension 0–90°, plus small abduction/adduction (~±20°). Thumb CMC is a saddle joint (wider, ~0–50° flexion + opposition).
- **PIP joint (segment 2):** pure hinge — flexion 0–100°, no abduction.
- **DIP joint (segment 3):** pure hinge — flexion 0–70–80°, no abduction.
- **Coupling:** PIP/DIP flexion is mechanically linked via the flexor digitorum tendons; DIP ≈ 0.6–0.7 × PIP angle. Segment N rotates relative to segment N−1 around a shared flexion axis roughly parallel to the palm's transverse axis.

---

## Q5 — Is there enough ground friction for walking (downward "magnetizing" drag)?

**Friction is set but very low; the "magnetism" you describe exists as a separate system — and it currently FIGHTS walking.**

- **Collider friction:** `HumanoidPhysicsBinder.friction = 0.5`, applied **only to the capsule collider** (`colDesc.setFriction(this.friction)`). **The per-bone foot colliders in `HumanoidMultiBodyManager` never call `setFriction`** — Rapier's default friction (~0.5 combine rule) applies, but the ground collider in `PhysicsEngine` also never calls `setFriction`. So effective foot-ground friction is the Rapier default (average of the two), not a deliberate high-grip value. Restitution is `0.0` (no bounce) on the capsule; feet don't set it either.
- **The "magnetism" system** is the *Exponential Weariness / Grounding Magnet* (`syncVisuals`): when both feet are airborne AND no AI command in 500 ms AND not multi-body, it accumulates `airborneTimer` and applies a downward velocity `magnetVelocity = -2.0 * groundingMagnetStrength` to pull the capsule down. **This is exactly the "downward attraction/drag" you described** — but it only engages when airborne, is disabled in multi-body mode (`!this.mbActive`), and is intended as an anti-float hack, not a walking aid.
- **Walking traction** actually comes from K-GRF (`applyKinematicGroundReactionForces`), which converts foot-ground contact into forward impulse — this is reaction-force walking, not friction-grip walking. For stable walking you need BOTH decent friction AND the foot to "stick" during stance.

**Verdict:** Friction is present but under-specified (default ~0.5, not tuned for grip). There is no stance-foot "grip/stiction" mechanism. The magnet system is the closest thing to your "downward attraction," but it's an anti-airborne hack that currently cannot run in multi-body mode.

---

# IMPLEMENTATION PLANS

> These are plans only — Explore Mode does not modify code. Switch to Act Mode to implement.

## Plan A — True per-axis finger constraints + parent-relative coupling (your priority)

**Research basis:** Model MCP as 2-DOF condyloid, PIP/DIP as 1-DOF hinges, with DIP slaved to PIP and each segment hinged on its parent's flexion axis.

1. **Extend the constraint schema** (`src/types/joint.ts` `JointLimit`): add an optional `hingeAxis?: 'x'|'y'|'z'` and `coupleToParent?: { ratio: number }` field. In `rigConstraints.ts`, mark index/middle/ring/pinky segment1 as `dof:2` (flex + slight abduction, e.g. `x:[0,1.57], z:[-0.35,0.35]`), segments 2–3 as `dof:1` with `coupleToParent:{ratio:0.7}` for DIP→PIP.
2. **Give fingers real revolute joints.** In `HumanoidMultiBodyManager`'s `BONE_JOINT_TYPE` finger block, change finger segments from `'spherical'` to `'revolute'` so they become physical hinges with `limitsEnabled` (the revolute branch already applies `constraint.x` limits). Add the finger bones to `trackedBones` explicitly so they get rigid bodies (remove the "no rigid bodies" shortcut in `updateMotorTargets`).
3. **Anchor each segment to its parent phalanx** (`getPhysicsParentName` already walks `bone.parent`; ensure `mixamorig...index2`'s physics parent resolves to `...index1`, etc.) so joint N is mechanically relative to joint N−1 — matching human anatomy.
4. **Enforce tendon coupling physically.** In `HumanoidMultiBodyManager.setTargets`, after computing each finger segment's target, write `target(seg3) = 0.7 × target(seg2)` and `target(seg2) ≥ 0.3 × target(seg1)` before PD torque, replacing the validate-time-only rejection with continuous mechanical coupling.
5. **Set a flexion hinge axis** (`REVOLUTE_AXIS`) appropriate to the palm frame (likely local X or Z — verify empirically with `analyze_axes.py`) and add a small angular limit even on the revolute joint to forbid hyperextension (`min:0`).

## Plan B — Real aggregate Center of Mass / balance

1. Add a `computeCenterOfMass()` to `HumanoidMultiBodyManager`: each physics step, sum `body.translation() × mass` over capsule + all bone bodies ÷ total mass.
2. Compute the **support polygon** from active foot-contact points (already available via `PhysicsEngine.getContactForceRegistry` + foot collider handles).
3. Replace/augment the naive upright spring with a **CoM-over-support controller**: apply a corrective horizontal force/ankle torque that drives the CoM projection toward the support-polygon centroid. Keep the upright spring as a secondary term.
4. Expose CoM in `getDiagnostics()` and feed it to `ObservationBuilder` for AI proprioception.

## Plan C — Ground friction + stance-foot grip for walking

1. **Set explicit friction on feet and ground.** In `HumanoidMultiBodyManager.activate` foot branch: `colDesc.setFriction(1.2)` (high grip) and in `PhysicsEngine.init` ground: `groundColDesc.setFriction(1.0)`. Also `setRestitution(0.0)` on feet.
2. **Add stance-phase stiction ("magnetized drag").** In `applyKinematicGroundReactionForces` (multi-body branch), when a foot's contact normal `ny > 0.7` and its planar velocity is below a threshold, apply a small opposing horizontal friction impulse (or temporarily raise that foot's linear damping) to simulate grip; release it during swing. This is the controlled version of your "not strict attach, but drag" idea.
3. **Reconcile the Weariness Magnet.** Either (a) port the magnet into multi-body mode as a gentle downward force on the capsule during double-support only, or (b) delete it in favor of pure friction+gravity once friction is fixed. Right now it's disabled in multi-body and would fight a real gait.
4. Tune via the existing `HUMANOID_PHYSICS_TESTING_GUIDE.md` scenarios (walk straight, turn, stop-without-slide).

## Plan D — Limb-driven jumping / richer actions (optional, builds on A+B)

1. Generalize `executeJump` into `executeLimbJump`: detect a crouch (knee flex targets) → on extension, apply an impulse to the capsule proportional to leg-extension velocity, plus PD-driven leg thrust.
2. Add new program handlers in `executeProgramSequence` for `run`, `crouch`, `vault` instead of ignoring them.

---

## Suggested reading order
1. `src/constants/physics.ts` — mass/inertia matrix (Q2).
2. `src/constants/rigConstraints.ts` + `src/constants/anatomicalLimits.ts` — every joint's DOF and limits (Q3, Q4).
3. `src/world/engine/HumanoidMultiBodyManager.ts` — bodies, joints, PD, spherical-vs-revolute handling (Q3, Q4).
4. `src/world/engine/HumanoidPhysicsBinder.ts` — jump, friction, magnet, K-GRF, kinematic finger path (Q1, Q4, Q5).
5. `src/world/engine/RapierJointMotorController.ts` — revolute motor PD (Q3).
6. `src/world/engine/PhysicsEngine.ts` — world, gravity, ground collider (Q5).
