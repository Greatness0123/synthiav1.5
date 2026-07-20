# Synthia — Critical Cost/Benefit Analysis of Implementing project_info__12.md (Plans A–D)

I re-read the actual source (`HumanoidMultiBodyManager`, `HumanoidPhysicsBinder`, `PhysicsEngine`, `RapierJointMotorController`, `physics.ts`, `rigConstraints.ts`, `anatomicalLimits.ts`, `joint.ts`) to ground every claim. Full report saved to **`project_info__14.md`**. Here's the substance.

## First, a correction to #12 that changes Plan A's cost

#12 says *"fingers have NO Rapier rigid bodies"* and that their `BONE_PD_GAINS` are dead code. **That's wrong.** `trackedBones` is built from `BONE_JOINT_TYPE` keys, and the finger block **does** populate `BONE_JOINT_TYPE` (all 30 finger/thumb segments as `'spherical'`). So fingers **already get** rigid bodies, colliders, spherical impulse joints, and motor configs. What's actually true:
- Their spherical joints get **no angular limit** — the spherical branch only sets `limitsEnabled` when `constraint.dof >= 2`, and fingers are `dof:1`. (Confirmed.)
- They're driven by the **manual spherical PD torque** path (stiffness 5 / damping 1, torque-clamped at 15 N·m), not the revolute motor — so "dead code" is really "live but extremely weak."
- The `updateMotorTargets` comment claiming the kinematic path handles fingers is **stale** and contradicts the manager.

**So Plan A is not "give fingers bodies" — it's "restrain and re-drive bodies that already exist and are under-constrained."** That's a subtle, high-risk change, not an additive one.

## The baseline in numbers (what all consequences are measured against)

- 16 solver iterations, fixed 1/60 s step.
- Velocity safety clamps: **8 m/s linear, 6 rad/s angular** (`anatomicalLimits`).
- Today: **~46 dynamic bodies + ~45 impulse joints** (capsule + 15 major + 30 finger).
- Finger inertia Iyy as low as **1e-5 kg·m²**; mass 0.008–0.02 kg.
- Friction: capsule 0.5 explicit; **ground and foot colliders never call `setFriction`** (confirmed — Rapier default ~0.5).

**The single most important non-obvious fact:** these plans are **cheap in bodies (≈0 added), expensive in solver-stability and gain re-tuning.** The cost is tuning fragility, not performance.

## Plan-by-plan verdicts

**Plan C — friction/grip → DO FIRST.** The ground and foot colliders genuinely never set friction (a real omission, not a tuning nuance). Two `setFriction` calls (feet 1.2, ground 1.0) is a near-free, high-payoff fix that walking *depends* on — K-GRF force (multiplier 150) is useless if the stance foot slides. Risk is low: friction is global here, so pair the raise with the stance/swing stiction gate or feet grab mid-swing; and stiction can mask bad gaits from `datasetExporter`. **Best ROI in the whole document.**

**Plan B — CoM/balance → SECOND, but split it.** Cheapest correctness-per-line: `computeCenterOfMass` is one loop over ~46 bodies reading contacts already in `contactForceRegistry`. The **big payoff is AI proprioception** (`buildVLMProprioception` gains a causal balance signal). But do **sensing first** (low risk, high value); treat **replacing the Kp=200/Kd=80 spring** as a separate risky phase — a CoM term layered on the tuned spring is a "two controllers, one plant" hazard, and contact flapping injects noise without filtering.

**Plan A — fingers → FOURTH, behind a flag.** Highest correctness payoff (closes the only unconstrained joints in the rig) but highest tuning risk. You're putting ForceBased revolute motors on **1e-5 kg·m²** bodies — `α=τ/I` explodes, the 6 rad/s clamp fires constantly, and the current 5/1 gains were tuned for the *weak spherical* path so they don't transfer. `REVOLUTE_AXIS={1,0,0}` is correct for knees/elbows by luck; finger axes vary per segment, and #12 itself punts to `analyze_axes.py`. The "tendon coupling" is software-only (targets, not solver), so it's cosmetic under contact load (e.g., the piano). Expect a dedicated re-tune; existing pose/animation JSONs may regress.

**Plan D — jumping → LAST, highest risk.** Most under-specified (crouch-detect → extension-velocity impulse is a research problem). It collides with the velocity clamps (8 m/s, 6 rad/s) that are currently *saving* you, and it needs A+B+C stable first or it's chaos. **Worst ROI-to-risk if done early.**

## Cross-cutting consequences

1. **Tuning, not compute, is the dominant cost** — three plans invalidate deliberately-set gains (ζ=0.894 balance, MIN_GAIN=0.30, MAX_TORQUE=15).
2. **Velocity clamps are a hidden ceiling** — A and D both push against them; raising them removes a safety net.
3. **Two stale comments will mislead implementers** (the "no rigid bodies" comment; root `.txt` snapshots).
4. **B and C change proprioception/contacts → existing dataset exports become non-comparable.** Version exports.
5. **Sequencing is forced by physics: C → B(sense) → B(control) → A → D.**

## Statistical summary

| Plan | Bodies added | Solver cost | Tuning risk | Behavior payoff | AI/obs payoff | Order |
|---|---|---|---|---|---|---|
| **C** friction | 0 | ~0 | Low | **High** | Med | **1st** |
| **B** CoM sense | 0 | ~46 reads/f | Low | Med | **High** | **2nd** |
| **B** CoM ctrl | 0 | +1 loop | High | High | Med | 3rd |
| **A** fingers | 0 (swap) | +30 revolute | High | Med | Low | 4th (flag) |
| **D** jump | 0 | +logic | Highest | High (ceiling) | Med | **Last** |

**Bottom line:** Net positive and body-count-free, but the cost is concentrated in **gain re-tuning and solver stability**, not performance. Best ROI = Plan C's two `setFriction` lines. Worst ROI-to-risk = Plan D first. And Plan A is widely misunderstood — the fingers already have bodies; you're re-driving the most inertia-fragile bodies in the sim.