# Synthia — Humanoid Physics Investigation (saved to `project_info__12.md`)

I read the full physics stack (`HumanoidMultiBodyManager`, `HumanoidPhysicsBinder`, `RapierJointMotorController`, `PhysicsEngine`, `rigConstraints`, `anatomicalLimits`, `physics.ts`). Here are direct answers to your five questions, then the plans.

## 1. Can the model jump?
**Yes, but only the capsule root.** `executeJump(force=6.0)` applies a vertical impulse to `capsuleBody`, gated on `isGrounded`. `executeProgramSequence` routes `"jump"` → `executeJump(6.0)`, but **ignores `walk`/`run`/`wave` etc.** with a warning. So there's a vertical hop only — no limb-driven or running jump, because limbs are PD position-trackers, not force-appliers. Walking is *emergent* via `applyKinematicGroundReactionForces` (foot contact → forward capsule impulse), not scripted.

## 2. Center of gravity / mass?
**Mass: yes, realistic per-bone** (`COMPLETE_MIXAMO_PHYSICS_MATRIX`, ~75 kg; capsule hard-coded 70 kg). **Aggregate CoM: NO** — it's never computed or used. Balance is a brute-force **capsule-upright spring** (Kp=200, Kd=80) that torques the capsule toward vertical, not a CoM-over-support-polygon controller. Each rigid body has its own local CoM at its geometric center.

## 3. Are knees / elbows locked?
**No — they're the ONLY truly motorized joints.** Both are classified `revolute` in `BONE_JOINT_TYPE` and use Rapier's real solver motor (`configureMotorPosition`, ForceBased). Knees: `[-150°, 0°]` (no hyperextension). Elbows: `[0°, +145°]`. They also get hard joint limits. If they *look* locked, it's the soft-start ramp (`MIN_GAIN 0.30` over 15 frames) or the post-reset settle window (`settlingFramesLeft` → gains 0.1/0.8) making them too weak against gravity.

## 4. Finger joints lack angular constraint — **you're right, they're the most neglected**
- **No rigid bodies:** In multi-body mode, fingers are routed to the kinematic lerp (`updateMotorTargets` comment: *"Finger bones have no rigid bodies"*) → they don't physically collide or receive PD torque. Their `BONE_PD_GAINS` entry is dead code.
- **No physical angular limit:** Fingers are registered as `spherical`, and the spherical branch only applies a limit when `dof >= 2`. Finger constraints are `dof:1`, so the Rapier spherical joints are created **with no `limitsEnabled`** — angularly unconstrained, exactly as you suspected.
- **No mechanical parent-relative hinge:** Human fingers are 1-DOF hinges (MCP slight 2-DOF). The code models them as free ball-sockets with only a software clamp in the lerp. The only coupling is a validate-time `tendon_synergy_violation` rejection — not a real joint-4→joint-1 mechanical link.

## 5. Ground friction for walking (the "magnet drag")
- **Friction is set but weak:** only the **capsule** gets `friction = 0.5`. **Foot colliders and the ground collider never call `setFriction`** → effective grip is Rapier's default, not tuned. Restitution 0 on capsule only.
- **The "magnetism" you describe exists** — the *Exponential Weariness/Grounding Magnet* pulls the capsule down when both feet are airborne and no AI command for 500 ms. **But it's disabled in multi-body mode** (`!this.mbActive`) and is an anti-float hack, not a walking aid. There's **no stance-foot grip/stiction**.

---

# Plans (Explore Mode — implement in Act Mode)

**Plan A — Real finger constraints + parent-relative coupling (your priority)**
1. Extend `JointLimit` with `hingeAxis` + `coupleToParent:{ratio}`; MCP(seg1)→`dof:2` (flex + ±20° abduct), PIP/DIP(seg2/3)→`dof:1` with DIP→PIP ratio 0.7.
2. In `BONE_JOINT_TYPE`, change fingers `spherical`→`revolute` so they get physical hinges with `limitsEnabled`; add them to `trackedBones` and remove the "no rigid bodies" shortcut.
3. Ensure `getPhysicsParentName` chains seg N → seg N−1.
4. In `setTargets`, enforce `seg3 = 0.7×seg2`, `seg2 ≥ 0.3×seg1` as continuous mechanical coupling (replace validate-time-only).
5. Verify the flexion hinge axis empirically (`analyze_axes.py`); forbid hyperextension (`min:0`).

**Plan B — True CoM balance**: add `computeCenterOfMass()` (Σ body.pos×mass / total), build a support polygon from foot contact registry, drive CoM projection toward its centroid instead of the naive upright spring; expose CoM to `ObservationBuilder`.

**Plan C — Friction + stance grip**: `setFriction(1.2)` on feet + `setFriction(1.0)` on ground; add stance-phase stiction (oppose low planar velocity when `ny>0.7`); reconcile or remove the Weariness Magnet so it stops fighting multi-body gait; tune with `HUMANOID_PHYSICS_TESTING_GUIDE.md`.

**Plan D (optional) — Limb-driven jump**: crouch-detect → impulse proportional to leg-extension velocity; add `run`/`crouch`/`vault` handlers.

Reading order: `physics.ts` → `rigConstraints.ts`/`anatomicalLimits.ts` → `HumanoidMultiBodyManager.ts` → `HumanoidPhysicsBinder.ts` → `RapierJointMotorController.ts` → `PhysicsEngine.ts`.

Full detail is in `project_info__12.md`. Want me to go deeper on any plan — e.g., draft the exact finger constraint table (per-segment flexion/abduction ranges for all 5 digits) for Plan A?