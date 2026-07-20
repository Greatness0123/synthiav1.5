# Synthia — Critical Cost/Benefit Analysis of Implementing project_info__12.md (Plans A–D)

## What this document is
Report #12 diagnosed five physics questions and proposed four implementation plans (A: fingers, B: CoM/balance, C: friction/grip, D: limb-jump). This report is a **hard-nosed engineering assessment of what actually happens to the project if you implement them**. Every claim below is grounded in the current source, which I re-read for this analysis. Where I quantified things, I show the arithmetic. Where I cannot quantify honestly, I say so.

**A correction to #12 first, because it changes Plan A's cost:**
#12 claims *"Fingers have NO Rapier rigid bodies"* and that `BONE_PD_GAINS` finger entries are dead code. **This is wrong as written.** In `HumanoidMultiBodyManager.activate`, `trackedBones` is built from `BONE_JOINT_TYPE` keys — and the finger-registration block **does** populate `BONE_JOINT_TYPE` (all 30 finger/thumb segments, as `'spherical'`). So fingers **do** get rigid bodies, colliders, spherical impulse joints, and motor-config registrations. What is actually true:
- Their spherical joints get **no angular limit** because the spherical branch only applies `limitsEnabled` when `constraint.dof >= 2`, and fingers are `dof:1`. (Confirmed in source.)
- They are driven by the **manual spherical PD torque** path (stiffness 5 / damping 1), **not** the Rapier revolute motor. So the "dead code" is really "live but extremely weak spherical torque," and there is a stale comment in `HumanoidPhysicsBinder.updateMotorTargets` claiming the kinematic path handles them — a comment that no longer matches the manager's behavior.

This matters: Plan A is **not** "give fingers bodies" (they have them). It is "**restrain and re-drive** bodies that already exist and are currently under-constrained." That is a subtle, high-risk change, not an additive one.

---

## The current state in numbers (baseline for all consequences)

| Quantity | Value | Source |
|---|---|---|
| Solver iterations | 16 | `PhysicsEngine.init` |
| Fixed timestep | 1/60 s | `PhysicsEngine.init` |
| Linear velocity clamp | 8.0 m/s | `MAX_LINEAR_VELOCITY` |
| Angular velocity clamp | 6.0 rad/s | `MAX_ANGULAR_VELOCITY` |
| Capsule mass / inertia | 70 kg / (10,10,10) | `createRigidBodiesAndColliders` |
| Per-bone mass matrix total | ~75 kg across ~51 entries | `COMPLETE_MIXAMO_PHYSICS_MATRIX` |
| Body count today (multi-body) | **~46 rigid bodies** (capsule + 15 major + 30 finger) | counted from `BONE_JOINT_TYPE` |
| Finger mass each | 0.008–0.020 kg | physics.ts |
| Finger inertia (Iyy) | as low as **1e-5 kg·m²** | physics.ts |
| Spherical manual torque clamp | 15.0 N·m (`MAX_TORQUE`) | `setTargets` |
| Balance torque clamp | 60.0 N·m (`MAX_BALANCE_TORQUE`) | `setTargets` |
| Capsule friction | 0.5 (explicit) | binder `friction` |
| Ground friction | **Rapier default (~0.5)** — `setFriction` never called | `PhysicsEngine.init` |
| Per-bone (foot) friction | **Rapier default** — `setFriction` never called | `HumanoidMultiBodyManager.activate` |
| Grounding magnet | only when `!mbActive`, both feet airborne, no AI cmd 500 ms | binder `syncVisuals` |

**Derived body/joint budget.** Today: ~46 dynamic bodies + ~45 impulse joints (30 finger spherical + 15 limb) at 16 solver iterations. Adding nothing (Plan A changes types, not counts). Plans B–D add compute per frame, not bodies. So **the body-count cost of these plans is roughly zero; the cost is constraint complexity and tuning fragility, not raw body count.** This is the single most important non-obvious fact: **Plans A–D are cheap in bodies, expensive in solver-stability and tuning risk.**

---

## Plan-by-plan consequences and benefits

### PLAN A — Per-axis finger constraints + parent-relative coupling

**What it really does (now that we've corrected the "no bodies" claim):**
1. Flips 30 finger entries in `BONE_JOINT_TYPE` from `'spherical'` → `'revolute'`.
2. Extends `JointLimit` with `hingeAxis` / `coupleToParent`.
3. Re-drives fingers through the **Rapier revolute motor** (`configureMotorPosition`) instead of manual spherical torque.
4. Adds software coupling `target(seg3)=0.7·target(seg2)` in `setTargets`.

**Benefits (real, but narrow):**
- **Anatomically correct fingers.** Currently the 30 finger spherical joints are the *only* joints in the body with **no `limitsEnabled`** (dof:1 fails the `>=2` guard). Plan A closes the single largest "unconstrained joint" hole in the rig. Measurable: unconstrained-DOF count goes from 30 joints × up-to-3 free axes to 30 × 1 constrained axis.
- **Stronger actuation.** Spherical manual torque is clamped at 15 N·m and runs at stiffness 5 — that is *at most* 5·θ_error torque, tiny. The revolute motor is solver-integrated (ForceBased) and far stiffer per radian. Fingers would actually hold a pose instead of drifting.
- **Removes a validation-time hack.** The tendon-synergy rejection in `validateAndApplyTimeline` (`tendon_synergy_violation`) is a *gate*, not a mechanism. Replacing it with continuous coupling is architecturally cleaner.

**Consequences / risks (high):**
- **This touches the most inertia-fragile bodies in the sim.** Finger Iyy ≈ **1e-5 kg·m²**. The revolute motor with `ForceBased` model applies real torque; against a 1e-5 inertia, even small Kp produces enormous angular acceleration (`α = τ/I`). The existing velocity clamp (6 rad/s) will *constantly* fire on fingertips, which reads as tremor/jitter. **Expect to re-tune all 30 finger gains and likely drop them well below the current 5/1** — but 5/1 was tuned for the *weak spherical* path, so the numbers don't transfer. This is a full re-tune, not a transplant.
- **Hinge-axis correctness is empirical and brittle.** `REVOLUTE_AXIS` is hard-coded `{1,0,0}` and correct for knees/elbows only because those bones happen to be X-aligned. Finger flexion axes vary per segment and per hand. #12 itself punts: *"verify empirically with analyze_axes.py."* If the axis is wrong, fingers will curl sideways and the `x:[0,1.745]` limit will *clamp the wrong rotation*, producing visibly broken hands that are now *physically* wrong (before, they were just limp).
- **Coupling is software, not solver.** Step 4 writes `target(seg3)=0.7·target(seg2)` *before* the PD — but the solver then solves each revolute independently. Under contact load (pressing a key on the piano, which exists via `ObjectManager.spawnPiano`), the physical segments will *not* maintain the 0.7 ratio; only the targets do. So the "tendon" is cosmetic under load. A true tendon requires a joint-to-joint constraint Rapier doesn't trivially give you here.
- **Regression surface: every existing animation/pose file** (`model data/*.json`, `diagnostic_poses.js`, `coordinator/programs/primitives/stand_upright.json`) that writes finger targets was authored against the spherical path. Switching actuation changes the response curve; poses that looked fine may now snap or oscillate.

**Verdict on A:** **Highest correctness payoff, highest tuning risk.** The benefit is real but localized to hands (a small fraction of behavior). The risk is *system-wide jitter* if the 30 micro-inertia revolute motors are mis-gained. Do it, but expect a dedicated tuning pass and gate it behind a flag so you can A/B.

---

### PLAN B — Aggregate Center of Mass / balance controller

**What it does:** adds `computeCenterOfMass()`, builds a support polygon from foot contacts, replaces/augments the `Kp=200/Kd=80` upright spring with a CoM-over-support controller, exposes CoM to `ObservationBuilder`.

**Benefits (the highest-leverage of all four):**
- **Attacks the actual reason the character balances by brute force.** Today balance is a *verticality spring* on a 70-kg capsule — it torques toward "up" regardless of where mass actually is. A CoM/ZMP controller is the *correct* mechanism and generalizes to leaning, single-stance, and pushes (which `push()` already exposes).
- **Cheapest correctness-per-line.** `computeCenterOfMass` is `Σ(mᵢ·pᵢ)/Σmᵢ` over ~46 bodies — one loop, ~46 `translation()` reads per frame. Negligible cost. The support-polygon contacts are *already computed* every step into `contactForceRegistry`; Plan B just reads them.
- **Big AI payoff.** Feeding CoM into `ObservationBuilder.buildVLMProprioception` gives the model a *causal* balance signal it currently lacks. This directly improves the agent's ability to learn walking — arguably more than any other single change.

**Consequences / risks (moderate):**
- **CoM ≠ stability on its own.** A CoM-over-support controller needs a *strategy* (ankle strategy, hip strategy, step). The plan says "apply corrective horizontal force/ankle torque" — but the character's feet are 1.1-kg bodies with weak spherical torque. The controller's *output actuator* is still fundamentally the capsule spring. You risk building an accurate CoM sensor that feeds the *same* weak actuator, yielding marginal balance improvement for the added complexity.
- **Tuning coupling with the existing spring.** `BALANCE_KP=200/KD=80` was deliberately tuned (ζ=0.894). Layering a CoM term on top without re-deriving gains can fight the spring and *destabilize* what currently works. This is a "two controllers, one plant" hazard.
- **Support-polygon from contacts is noisy.** `contactForceRegistry` updates are best-effort (the drain is wrapped in silent try/catch) and `inContact` flapping will make the polygon jitter frame-to-frame, injecting noise into the balance torque. Needs hysteresis/filtering not mentioned in the plan.

**Verdict on B:** **Best long-term value, especially for AI proprioception** — but scope it as *"add CoM sensing + expose to observation"* first (low risk, high value) and treat *"replace the balance controller"* as a separate, riskier phase. Do not conflate the two.

---

### PLAN C — Ground friction + stance-foot grip

**What it does:** sets explicit friction on feet (1.2) and ground (1.0), adds stance-phase stiction in `applyKinematicGroundReactionForces`, reconciles the weariness magnet.

**Benefits (highest visible-behavior payoff, lowest code risk):**
- **Fixes a genuine omission, not a tuning nuance.** The ground collider and all per-bone foot colliders **never call `setFriction`** — confirmed. The *only* explicit friction in the entire sim is the capsule's 0.5. So foot-ground friction is the Rapier combine-rule default (~0.5), and it is currently doing all walking traction by accident. Setting `1.2/1.0` is a 2-line change with a large, immediate effect on whether K-GRF walking slips.
- **Directly enables walking.** Walking is emergent from `applyKinematicGroundReactionForces` (KGRF_MULTIPLIER = 150). That force is useless if the stance foot slides. Friction is the *prerequisite*; without it Plans B and D are building on a slipping foundation.
- **Kills a contradiction.** The weariness magnet is *disabled* in multi-body (`!this.mbActive`) yet #12 treats it as a walking aid. Plan C forces a decision (port it as double-support-only downforce, or delete it). Either resolution removes a latent "two systems fighting" bug.

**Consequences / risks (low-to-moderate):**
- **Friction is a global, not per-contact, value in this code path.** Raising foot friction to 1.2 affects *every* foot contact, including when you *want* slide (e.g., a foot swinging into place). Without stance/swing phase gating, high friction can cause the foot to "grab" mid-swing and trip the gait. The plan's stiction impulse *is* the phase gate — so the friction raise and the stiction logic must land together, not separately.
- **Stiction can mask bad gaits.** Artificially damping a slow-moving stance foot can make a *wrong* gait look stable, hiding problems from the AI's proprioception and from dataset export (`coordinator/src/datasetExporter.ts`). You may export "successful" walks that only succeed because of the hack.
- **Magnet reconciliation is behaviorally visible.** If you port the magnet into multi-body as downforce, jumps (Plan D) get harder (you're adding downward force); if you delete it, any reliance on it in kinematic mode breaks. It's a real fork with observable consequences either way.

**Verdict on C:** **Do this first.** Lowest risk, highest and most immediate behavioral payoff, and it's the foundation B and D stand on. The friction-only part (set friction on feet + ground) is nearly free; the stiction/magnet part is where the design care is needed.

---

### PLAN D — Limb-driven jumping / richer actions

**What it does:** generalizes `executeJump` into `executeLimbJump` (crouch-detect → extension-velocity-proportional impulse + leg PD thrust), adds `run/crouch/vault` handlers in `executeProgramSequence`.

**Benefits:**
- **Unblocks real athletic behavior.** Today `executeProgramSequence` *explicitly ignores* everything except names containing "jump," and `executeJump` only fires a 6.0 vertical capsule impulse when `_isGrounded`. The agent literally cannot run or vault. Plan D is the only path to those.
- **Builds naturally on B (CoM) and C (friction).** A crouch→extend jump needs feet that grip (C) and a body that knows its mass distribution (B).

**Consequences / risks (highest of all four — do NOT do first):**
- **It's the most under-specified plan.** "Detect a crouch" and "impulse proportional to leg-extension velocity" are research problems, not implementations. The mapping from joint targets to a clean ballistic trajectory is exactly the hard part of legged control.
- **Collides with the velocity clamps.** A jump wants >8 m/s? No — 6.0 impulse on 70 kg gives Δv ≈ 0.086 m/s *per the impulse*, but real jump exit velocity approaches the 8 m/s linear clamp. The clamp will silently truncate athletic motion, and the 6 rad/s angular clamp will clip the leg swing. You'll fight your own safety rails.
- **Depends on A+B+C being stable first.** A limb-thrust jump on top of jittery fingers (A), a brute-force balance spring (no B), and slippery feet (no C) will be chaos. #12 even labels it "optional, builds on A+B." Correct — treat it as the *last* thing you do.

**Verdict on D:** **Highest ceiling, highest risk, strictly last.** Do not start here.

---

## Cross-cutting consequences (the things that bite regardless of plan)

1. **Tuning is the dominant cost, not compute.** Body count barely changes. But three of four plans re-tune gains that were *deliberately* set (ζ=0.894 balance, `MIN_GAIN=0.30` soft-start, `MAX_TORQUE=15`). Changing actuation paths invalidates those tunings. Budget for a re-tuning pass per plan, guided by `HUMANOID_PHYSICS_TESTING_GUIDE.md`.
2. **Velocity clamps are a hidden ceiling.** `MAX_LINEAR_VELOCITY=8`, `MAX_ANGULAR_VELOCITY=6`. Plans A (micro-inertia fingers) and D (jumping) both push against these. They're currently *saving* you from instability; raising them to enable athletic motion also removes a safety net. This is a genuine tension the plans don't acknowledge.
3. **Two stale comments will mislead the implementer.** (a) The `updateMotorTargets` "fingers have no rigid bodies" comment contradicts the manager. (b) `HumanoidMultiBodyManager.txt` / `physicsEngine.txt` at repo root are snapshots that will drift. Implementing Plan A *without* fixing the comment guarantees the next reader re-learns the wrong model.
4. **Observation/dataset coupling.** B and C change proprioception and contact behavior → they change what `datasetExporter` records. If you have existing exports, they become non-comparable across the change. Version your exports.
5. **Sequencing is forced by physics, not preference.** C (friction) → B (CoM sensing) → A (fingers, flagged) → D (jumping). Reordering puts a hard problem on an unstable base.

## Statistical summary (effort vs. payoff, honestly bounded)

| Plan | Bodies added | Solver-iter cost | Tuning risk | Behavior payoff | AI/obs payoff | Do it? |
|---|---|---|---|---|---|---|
| **C friction/grip** | 0 | ~0 | Low | **High** (walking works) | Med | **First** |
| **B CoM (sense only)** | 0 | ~46 reads/frame | Low | Med | **High** | **Second (sensing)** |
| **B CoM (controller)** | 0 | +1 control loop | **High** | High | Med | Third, carefully |
| **A fingers** | 0 (type swap) | +30 revolute in solve | **High** | Med (hands only) | Low | Fourth, behind flag |
| **D jumping** | 0 | +control logic | **Highest** | High (ceiling) | Med | **Last** |

**Bottom line:** Implementing #12 is *net positive and mostly body-count-free*, but the cost is concentrated in **gain re-tuning and solver stability**, not performance. The correct order is **C → B(sensing) → B(controller) → A → D**. The single best ROI in the whole document is **Plan C's two `setFriction` calls** — a 2-line change that fixes a real omission and unlocks walking. The single worst ROI-to-risk is **Plan D first**. And Plan A is widely misunderstood (including by #12): the fingers already have bodies — you're not adding them, you're *restraining and re-driving* the most inertia-fragile bodies in the simulation.
