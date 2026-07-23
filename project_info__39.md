# Critical Feasibility Review — Root Capsule Elimination & Humanoid Stabilization Plan

**Review Date:** 2026-07-23
**Analyzed Files:**
- `src/world/engine/MJCFHumanoidTemplate.ts`
- `src/world/engine/MotorController.ts`
- `src/world/engine/HumanoidPhysicsBinder.ts`
- `src/world/engine/BodyManager.ts`
- `src/world/engine/PhysicsEngine.ts`
- `src/constants/physics.ts`

**Reference Documents:**
- `PROTOMOTION_CAPSULE_ANALYSIS.md`
- `PROTOMOTION_JOINT_ACTUATOR_SPECS.md`

---

## Executive Summary

The proposed plan identifies real, significant problems with the current Synthia humanoid simulation — phantom floor contact from the oversized root capsule, mass double-counting between the capsule body and individual bone inertias, and over-reliance on external balance torques (`xfrc_applied`) that bypass the articulated physics. These issues are likely causing the "hovering" and instability observed.

**However, the plan makes several incorrect architectural assumptions about the relationship between Synthia's codebase and ProtoMotion's `amp_humanoid.xml`.** Applying the proposed changes verbatim would create new instabilities, leave unresolved structural contradictions, or silently fail because the actuator types and mass distribution systems are fundamentally different between the two codebases.

**Overall Verdict: Partially feasible, but requires significant architectural rework not described in the plan. The plan is a good diagnostic but an incomplete prescription.**

Four critical blockers, seven significant issues, and a recommended remediation path are detailed below.

---

## 1. Critical Blockers (Will Cause Failure if Unaddressed)

### Block 1: Architectural Mismatch — The "Root Capsule" Is Not a Separate Capsule Like ProtoMotion

**What the plan assumes:** The plan states "Replace Root Capsule with ProtoMotion Pelvis Spheres" — i.e., delete the capsule geom and substitute two sphere geoms (pelvis at R=0.09, upper_waist at R=0.07) at the specified positions.

**What the code actually does** (`MJCFHumanoidTemplate.ts` lines 92–240):

```
root_capsule body (free joint) ← monolithic 70 kg mass, single capsule geom (r=0.2, h=0.7)
  ├── mixamorigspine → spine1 → spine2 → ... → head, arms
  ├── mixamorigleftupleg → leftleg → leftfoot
  └── mixamorigrightupleg → rightleg → rightfoot
```

**What ProtoMotion does** (`amp_humanoid.xml`):

```
pelvis body (free joint) ← two sphere geoms (R=0.09, R=0.07), ~10 kg total mass
  ├── torso → head/arms
  ├── right_thigh → right_shin → right_foot
  └── left_thigh → left_shin → left_foot
```

**The critical difference:** In ProtoMotion, the `pelvis` body IS the root floating body — it has the free joint and IT is the kinematic root of the entire tree. The spheres are collision geoms ON the pelvis body itself.

In Synthia, the `root_capsule` body is a **wrapper container** with a `freejoint`. The actual skeleton's root (Mixamo's `mixamorighips`) is **not a physics body at all** — it's just a visual bone. The spine and leg chains attach as children of the capsule body, using local relative positions computed from Three.js world space.

**Implication:** You cannot simply "replace the root capsule geom with two spheres" and get ProtoMotion's behavior. The following would need to happen, none of which the plan describes:
- Making `mixamorigspine` (or a renamed capsule body) the new root with the free joint
- Recomputing all child body positions relative to the new root
- Removing the 70 kg monolithic inertial mass from the container body
- Ensuring the spine, left leg, and right leg chains attach at anatomically correct positions to the pelvis root

**Verdict: BLOCKING — the plan's "replace" operation is much deeper than stated.**

---

### Block 2: Mass Double-Counting Makes the Proposed Distribution Impossible to Achieve with Simple Density Changes

**Current mass configuration:**
| Source | Mass (kg) | Notes |
|--------|-----------|-------|
| `root_capsule` inertial (line 237) | 70.0 | Monolithic mass on the wrapper body |
| Individual bone inertias (physics.ts matrix) | ~75.0 | Sum of all COMPLETE_MIXAMO_PHYSICS_MATRIX entries |
| **Effective total** | **~145.0** | The simulator sees BOTH |

The 44 kg target from ProtoMotion would require:
- Eliminating the 70 kg capsule mass entirely
- Reducing the physics matrix masses (currently ~75 kg) to ~44 kg total
- This is a ~41% reduction across all bone masses

**The plan's specific density numbers (thighs: 1269 kg/m³, shins: 1014 kg/m³, feet: 1141 kg/m³)** are lifted directly from ProtoMotion's `amp_humanoid.xml`. But in Synthia, geom densities for legs are currently auto-computed from the physics matrix mass and bone length estimates — they are NOT hardcoded. The MJCF generation in `buildBodyTreeXML()` doesn't set density at all; it uses `size` and relies on MuJoCo's auto-inertia computation from shape and density.

**Searching the actual MJCF output** (generated XML): The leg geoms use `size="${colRadius} ${colHalfHeight}"` with NO explicit `density` attribute. MuJoCo defaults to density=1000 for geoms without explicit density. The actual mass comes from the `<inertial>` tag's `mass` attribute, NOT from geom density × volume.

This means changing geom density alone would NOT change the mass distribution because the inertial mass is set explicitly in the `<inertial>` tag (line 199 in MJCFHumanoidTemplate.ts):
```xml
<inertial pos="0 0 0" mass="${phys.mass}" diaginertia="${ixx} ${iyy} ${izz}"/>
```

**Verdict: BLOCKING — mass changes must come from INERTIAL tags, not geom densities. The plan addresses the wrong mechanism.**

---

### Block 3: Removing `applyCapsuleBalance()` Without a Replacement Will Cause Immediate Collapse

**Current architecture:** The upright stability of the humanoid relies on TWO mechanisms:
1. **Joint PD controllers** (`MotorController.setTargets()`) — control relative joint angles
2. **Capsule balance torque** (`MotorController.applyCapsuleBalance()`) — applies corrective torque directly to the root capsule body via `xfrc_applied`

The balance torque (lines 319–372 in MotorController.ts) computes:
```
tiltAngle = acos(capsuleUp.y)  // deviation from vertical
tiltAxis = cross(capsuleUp, worldUp)  // axis to rotate back
torque = Kp * tiltAxis * tiltAngle - Kd * angularVelocity
clamped at MAX_BALANCE_TORQUE = 60 N·m
```

This is the ONLY mechanism that controls the **absolute orientation** of the body in space. The joint PD controllers only control RELATIVE angles between adjacent bones. Without an absolute orientation reference, the humanoid would tilt and fall — the foot contact friction alone cannot correct a cumulative lean because the joint PD controllers don't know which way is up.

**ProtoMotion does not need this** because ProtoMotion uses a learned RL policy that outputs joint torques directly. The policy learns absolute orientation control through experience across thousands of falls. Synthia has no such policy — it uses hardcoded PD setpoints.

**The plan assumes that high joint stiffness (Kp=500) will provide de facto absolute control.** This is only true if:
1. The feet maintain frictional contact with the ground
2. The ankle joints have sufficient torque authority to counter gravity
3. The stance targets create a mechanically self-stabilizing configuration

None of these are guaranteed. With the current position actuators (which don't have explicit torque limits via `gear`), the ankles could saturate and the body could fall.

**Verdict: BLOCKING — removing the balance torque without implementing a learned policy or low-level orientation controller will cause the humanoid to fall over.**

---

### Block 4: Actuator Type Mismatch — "gear" Values Have No Effect on Position Actuators

**What the plan specifies:**
```
Hips: gear="200" (torque limit ±200 N·m)
Knees: gear="150"
Ankles: gear="90"
```

**What the code currently generates** (`MJCFHumanoidTemplate.ts` lines 198–215):
```xml
<position name="act_leftupleg_pitch" joint="mixamorigleftupleg_pitch" kp="400" kv="80" ctrlrange="-0.785 0.785"/>
```

These are `<position>` actuators. The `gear` attribute is **ignored** by position actuators in MuJoCo — it only applies to `<motor>` actuators. Position actuators work as:
```
torque = kp * (ctrl - qpos) - kv * qvel
```

The `ctrlrange` limits the input position command, not the torque. The torque is implicitly limited by `kp × max_ctrl_error` (up to ~314 N·m at full range with kp=400).

**ProtoMotion uses `<motor gear="200">` actuators:**
```xml
<motor name="right_hip_x" gear="200" joint="right_hip_x" />
```

Motor actuators work as:
```
torque = gear * ctrl
```
Where `ctrl` is in the range [-1, 1] by default, so `gear` directly defines max torque.

**Implication:** Simply adding `gear="200"` to the current `<position>` elements would have zero effect. The plan must specify changing actuator types AND the torque limit mechanism, but does not.

**Verdict: BLOCKING — the gear values as written are inert. Actuator type or specification mechanism must change.**

---

## 2. Significant Issues (Will Affect Correctness)

### Issue 5: Damping Is Reduced, Not Increased — Contradicts Anti-Jitter Goal

| Joint | Current Kd | Plan Kd | Change | Effect |
|-------|-----------|---------|--------|--------|
| Hips (upleg) | 80 | 50 | -37.5% | Less velocity resistance |
| Knees (leg) | 80 | 50 | -37.5% | Less velocity resistance |
| Ankles (foot) | 30 (default) | 40 | +33% | More velocity resistance |

**The plan's stated goal is to "dampen high-frequency jitter," but reducing damping in the primary weight-bearing joints (hips and knees) would do the opposite.** Lower Kd means the PD controller provides less resistance to rapid velocity changes, which can amplify oscillations, not suppress them.

The ankle increase (30→40) is helpful for stance stability but cannot compensate for the hip/knee reduction.

**Recommendation:** If the goal is jitter reduction, Kd should be INCREASED (e.g., 80→100) or kept at current values while armature/frictionloss are added as supplementary stabilization.

---

### Issue 6: The `_zero_passive_forces` Mandate Is Not Accounted For

ProtoMotion explicitly zeros joint stiffness and damping at the MuJoCo model level:
```python
self.model.jnt_stiffness[:] = 0.0
self.model.dof_damping[:] = 0.0
```

The plan proposes adding `armature` and `frictionloss` to joints. However, **Synthia's code does NOT apply the `_zero_passive_forces` step anywhere**. In ProtoMotion, this is necessary because the passive joint forces (from `<joint>` attributes) would fight against the active PD from the actuators. MuJoCo double-counts: the actuator PD AND the joint-level stiffness/damping both contribute to the effective dynamics.

In Synthia:
- Joint attributes like `armature` and `frictionloss` would be ADDED at the XML level
- But the existing actuator PD gains would ALSO be active
- This creates a hybrid system where both passive and active forces are present

This is actually a more forgiving configuration (the passive damping provides a floor/minimum stabilization) but it means Synthia would behave differently from ProtoMotion even with identical armature/frictionloss values.

---

### Issue 7: Straight Leg Stance (0.0 rad Targets) Removes Shock Absorption

Current idle stance:
- Hip: -0.10 rad (≈ -5.7°) — slight forward lean
- Knee: -0.12 rad (≈ -6.9°) — micro-flexion
- Ankle: +0.10 rad (≈ +5.7°) — dorsiflexion
- Spine: -0.05 rad (≈ -2.9°) — forward lean

Proposed idle stance: All 0.0 rad — straight legs, straight spine.

**Problems with straight-leg stance in simulation:**
1. **No shock absorption** — any vertical perturbation transmits directly through the skeleton
2. **Hyperextension risk** — numerical errors or external forces could drive knees past 0 into hyperextension territory
3. **Locked geometry** — a straight leg provides no geometric compliance; the PD controller must absorb all disturbances

Humans stand with ~5° knee flexion for stability. A straight-legged stance in simulation is mechanically fragile.

**However**, it IS valid that straight legs would resolve the "hovering" issue by ensuring the feet are at their lowest possible position (no knee bend lifting the COM). This is a trade-off.

---

## 3. Non-Obvious Behaviors & Hidden Dependencies

### Hidden Dependency 1: The `updateMotorTargets()` Call Chain

Current flow in `HumanoidPhysicsBinder.syncVisuals()` (line 545+):
```
syncVisuals()
  ├── capsule position/rotation → model root
  ├── ground raycasting
  ├── applyKinematicGroundReactionForces()  ← modifies qvel directly
  ├── avatarSynchronizer.synchronize()      ← copies physics → visual
  └── timeline interpolation → setMotorTargets()
       └── motorController.setAiCommand()
           └── motorController.setTargets()  ← writes to data.ctrl
               └── motorController.applyCapsuleBalance()  ← writes to xfrc_applied
```

After `syncVisuals()`, `WorldEngine` calls `physicsEngine.step()` which runs the MuJoCo simulation step. So the sequence is:
1. Sync (write ctrl + xfrc_applied)
2. Step (simulate one timestep)
3. Repeat

The balance torque is written AFTER the joint targets but BEFORE the step. This means it's applied in the same simulation step. If the balance torque is removed, there's a 60-step-period (1 second) gap where the system runs without its primary orientation feedback. The ramp factor (`simulationStepCount / 20`) means full gain isn't applied until step 20, but the balance torque provides the initial stabilization during ramp-up.

### Hidden Dependency 2: `syncRigidBodiesFromBones()` in BodyManager

This function (BodyManager.ts line 175+) is called during initial skeleton-to-physics sync. It explicitly positions ALL joint qpos values based on the Three.js skeleton's world transforms, converting to Yaw/Pitch/Roll Euler angles in ZXY order. This means:

- The "bind pose" IS the reference position (all qpos = 0)
- If the skeleton's bind pose has ANY rotation in a joint, the initial qpos for that joint won't be 0
- The `resetToBindPose()` method (HumanoidPhysicsBinder.ts line 1095) resets all hinge qpos to 0, which corresponds to the T-pose

The plan's "zero idle stance" assumes that 0.0 rad corresponds to straight legs. This is true IF the Mixamo skeleton's T-pose has straight legs, which it does. So this aspect is safe.

### Hidden Dependency 3: Coordinate Frame Conversion in World ↔ MuJoCo

The `PhysicsEngine` uses:
```
worldToMuJoCo(v) = [v.x, -v.z, v.y]    // Three.js Y-up → MuJoCo Z-up
mujocoToWorld(p) = { x: p[0], y: p[2], z: -p[1] }
```

And quaternion conversion uses a +90° rotation about X axis to align the coordinate frames.

The capsule balance torque computes in Three.js world frame, then converts to MuJoCo for `xfrc_applied`. Any errors in this conversion would directly add instability. Removing the balance torque eliminates this conversion error source entirely — which may be contributing to the jitter.

---

## 4. ProtoMotion Analysis Documents — Key Learnings and Misapplications

### What PROTOMOTION_CAPSULE_ANALYSIS.md Got Right

1. ProtoMotion uses **no root capsule** — confirmed across all templates (AMP, SOMA, G1, SMPL)
2. Pelvis collision uses **local sphere primitives** (R=0.09 and R=0.07 for AMP)
3. All leg segments use **capsule geoms** with specific densities and dimensions
4. The mass distribution sums to **~44 kg** with a detailed per-segment breakdown
5. The `replace_cylinder_with_capsule` config option is for asset import, not dynamics

### What PROTOMOTION_JOINT_ACTUATOR_SPECS.md Got Right

1. ProtoMotion uses `<motor gear="N">` actuators for explicit torque limiting
2. PD gains: Hips Kp=500 Kd=50, Knees Kp=500 Kd=50, Ankles Kp=400 Kd=40
3. Torque limits: Hips 200 N·m, Knees 150 N·m, Ankles 90 N·m
4. `_zero_passive_forces` is a mandatory step to prevent double-counting
5. Joint ranges, armature, and frictionloss values match what the plan proposes

### What Both Documents Miss for This Codebase

1. **Synthia is NOT ProtoMotion** — The control architecture is fundamentally different (hardcoded PD ↔ learned policy)
2. **The mass distribution in Synthia's physics matrix** (physics.ts) is designed for **75 kg** with inertial moments tuned for PD control stability, not for learned policy agility
3. **Synthia uses position actuators** not motor actuators — this changes the torque control semantics entirely
4. **No policy training pipeline exists** in Synthia — the codebase has no RL infrastructure. Removing the balance torque with no learning loop means the hardcoded controller must provide full stability

---

## 5. Recommended Implementation Path

If the goals of the plan (eliminate hovering, improve standing stability, remove phantom contacts) are to be achieved, the following sequence is recommended:

### Phase 1: Minimal Fixes (Low Risk)

1. **Reduce root capsule size** (not eliminate) — Change `capsuleRadius` and `capsuleHalfHeight` so the capsule sits above the floor. Currently it extends to z=0 (floor level). Reduce capsuleHalfHeight so the bottom sits above the floor, letting foot geoms handle ground contact.

2. **Fix mass double-counting** — Remove the `mass="70"` from the root capsule inertial and distribute that mass to the individual bone inertias (or keep a small residual for the capsule wrapper). This immediately makes the physics more realistic.

3. **Add armature and frictionloss to joint definitions** in `MJCFHumanoidTemplate.ts` — This is low-risk and directly adds Coulomb friction that prevents micro-drift.

### Phase 2: Moderate Changes

4. **Switch actuator type from position to motor** — Change the generated XML from `<position>` to `<motor>` with explicit `gear` values. This requires rewriting the actuator generation in `MJCFHumanoidTemplate.ts` and updating `MotorController.ts` to work with the different semantics (motor actuators expect normalized input, not position targets).

5. **Tune PD gains gradually** — Start with current values (400/80 for legs), test stability, then adjust toward ProtoMotion values. Do NOT decrease Kd — increase it if jitter persists.

### Phase 3: Advanced (Root Capsule Elimination)

6. **Eliminate the root_capsule wrapper body** — This requires:
   - Making `mixamorigspine` the new root body with the free joint (or creating a `pelvis` body)
   - Adding sphere collision geoms to this new root body
   - Recomputing all child body positions in the MJCF generator to be relative to the new root
   - Updating `BodyManager.ts` to find the new root body by name
   - Updating `HumanoidPhysicsBinder.ts` to use the correct body for capsule position tracking

7. **Remove `applyCapsuleBalance()` only after**:
   - The new pelvis-based mass distribution is working
   - The motor-type actuators are tuned
   - The stance is verified stable without external torques

---

## 6. Detailed Change Analysis by Proposed Step

### Step 1.1: Replace Root Capsule with Pelvis Spheres

| Aspect | Analysis |
|--------|----------|
| Feasibility | Low as described. Technically doable with full re-architecture. |
| Risk | High — changes the kinematic tree structure, all relative positions recomputed |
| Effort | 3-4 files need changes (MJCFHumanoidTemplate.ts, BodyManager.ts, HumanoidPhysicsBinder.ts, MotorController.ts) |
| Benefit | Eliminates phantom floor contact, enables realistic foot-ground interaction |
| Recommendation | Defer to Phase 3. Do capsule size reduction first. |

### Step 1.2: Update Segment Densities

| Aspect | Analysis |
|--------|----------|
| Feasibility | Low — density changes have no effect because mass is set via `<inertial>` tags, not geom volume×density |
| Risk | Zero if done correctly (just change inertial mass values) |
| Effort | Moderate — all 44 entries in COMPLETE_MIXAMO_PHYSICS_MATRIX need scaling by ~0.587 to go from ~75kg to ~44kg |
| Benefit | Realistic mass distribution, lower total mass improves solver convergence |
| Recommendation | Do this, but via inertial mass values, not geom densities |

### Step 1.3: Add Joint Armature & Frictionloss

| Aspect | Analysis |
|--------|----------|
| Feasibility | High — straightforward XML attribute addition in `buildBodyTreeXML()` |
| Risk | Low — armature adds inertia-like resistance, frictionloss adds Coulomb friction |
| Effort | 1 file, ~20 lines changed (adding attributes to joint XML generation) |
| Benefit | Directly addresses micro-drift and jitter at the joint level |
| Recommendation | **Do this immediately** — lowest risk, highest value change |

### Step 2.1: Straighten Idle Stance Targets

| Aspect | Analysis |
|--------|----------|
| Feasibility | High — change values in `getIdleTargets()` |
| Risk | Medium — straight-leg stance removes shock absorption and mechanical compliance |
| Effort | Trivial — change -0.10, -0.12, 0.10 to 0.0 |
| Benefit | Ensures feet are at lowest position (addressing hover), simplifies control |
| Recommendation | Test incrementally (reduce by 25%, 50%, then to 0). Monitor for hyperextension. |

### Step 2.2: Configure High-Stiffness PD Gains & Gear Limits

| Aspect | Analysis |
|--------|----------|
| Feasibility | Medium — requires actuator type change (position→motor) for gear to work |
| Risk | Medium — Kp=500 with position actuators would give higher effective torque than intended |
| Effort | 2 files (MJCF template + MotorController) |
| Benefit | Higher stiffness improves disturbance rejection |
| Recommendation | Only implement AFTER actuator type is changed to `<motor>`. Test at Kp=400 first. |

### Step 2.3: Deactivate Capsule Balance Torques

| Aspect | Analysis |
|--------|----------|
| Feasibility | Low — requires verified stability from joint PD alone first |
| Risk | Critical — immediate collapse if joint PD cannot maintain orientation |
| Effort | Trivial — comment out the call in `updateMotorTargets()` |
| Benefit | Removes external force dependency, makes physics purely articulated |
| Recommendation | **Do NOT do this until Phases 1-2 are complete and verified.** This is the last step, not the first. |

---

## 7. Estimated Effort & Priority Matrix

| Change | Effort | Risk | Value | Priority | 
|--------|--------|------|-------|----------|
| Add armature/frictionloss to joints | Low | Low | High | **P0: Immediate** |
| Fix mass double-counting (remove 70kg capsule inertial) | Low | Low | High | **P0: Immediate** |
| Reduce root capsule size | Low | Low | Medium | **P1: Soon** |
| Straighten idle stance targets | Low | Med | Medium | **P1: After basic stability** |
| Scale down bone masses to 44kg | Medium | Low | Medium | **P2: After mass fix** |
| Switch to motor-type actuators | High | Med | High | **P2: Requires testing** |
| Tune PD gains to ProtoMotion values | Medium | Med | Medium | **P3: After actuator change** |
| Eliminate root capsule wrapper | Very High | High | High | **P3: Architectural change** |
| Remove capsule balance torque | Low | Critical | High | **P4: Last step only** |

---

## 8. Conclusion

The plan diagnoses real problems correctly:
- The root capsule creates phantom floor contacts
- The mass distribution is unrealistic (~145 kg effective vs 44 kg target)
- The balance torque adds complexity and potential instability
- The control gains are suboptimal

But the plan's prescriptions have four critical implementation gaps:
1. **Actuator type mismatch** — gear values are inert on position actuators
2. **Mass mechanism mismatch** — densities don't affect mass when inertial tags override them
3. **Root body architecture difference** — Synthia's capsule wrapper vs ProtoMotion's pelvis-as-root
4. **No orientation control fallback** — removing balance torque without a replacement will cause falls

The recommended path is to implement changes in Phases 1→2→3 order, with armature/frictionloss and mass double-counting fix as immediate high-value targets, and root capsule elimination as a carefully tested architectural change at the end.