# Synthia-1 — Ragdoll Physics & Humanoid Stability Analysis

## Summary
Synthia-1 is an AI-controlled humanoid simulation built with React, Three.js, and Rapier physics. The core issue reported is that the humanoid exhibits "explosive" and "jittery" behavior, resembling a ragdoll rather than a stable, controllable body. This analysis traces the physics control pipeline to identify why stability forces are insufficient and where the "adhesive" force (joint stiffness/damping) is failing to maintain a coherent upright posture.

## Architecture
The physics system is a hybrid multi-body PD (Proportional-Derivative) controller layered over Rapier rigid bodies. It uses a **capsule root + articulated bone bodies** model:

- **Root**: A single 70kg capsule (`HumanoidPhysicsBinder.ts`) acts as the physics anchor.
- **Articulation**: Each bone (spine, arms, legs, fingers) gets a dynamic rigid body connected via spherical or revolute joints (`HumanoidMultiBodyManager.ts`).
- **Control**: A PD motor controller applies torques to track target rotations (`RapierJointMotorController.ts`).
- **Visual Sync**: `AvatarSynchronizer.ts` lerps visual bones to physics states.

## Directory Structure
```
src/world/engine/
├── HumanoidPhysicsBinder.ts      — Main orchestrator; loads GLB, creates capsule, activates multi-body
├── HumanoidMultiBodyManager.ts   — Manages per-bone rigid bodies, joints, and PD torque application
├── RapierJointMotorController.ts — Low-level Rapier motor API wrapper (revolute joints only)
├── AvatarSynchronizer.ts         — Syncs visual Three.js bones to physics rigid bodies
├── PhysicsEngine.ts              — Rapier world wrapper; stepping, velocity clamping, event queue
├── RagdollBuilder.ts             — Legacy/simple ragdoll builder (not used for AI control)
├── ProceduralHumanoidBuilder.ts  — Builds a procedural (non-GLB) humanoid for ragdoll mode
├── ProceduralMotorController.ts  — PD controller for procedural humanoid
├── ObjectManager.ts              — Spawns/manages environmental objects
└── ObservationBuilder.ts         — Builds proprioception payloads for the AI
```

## Key Abstractions

### HumanoidPhysicsBinder
- **File**: `src/world/engine/HumanoidPhysicsBinder.ts`
- **Responsibility**: Owns the humanoid lifecycle. Loads `x-bot.glb`, creates the root capsule, and delegates multi-body articulation to `HumanoidMultiBodyManager`.
- **Interface**: `loadAndVisualizeBindPose()`, `createRigidBodiesAndColliders()`, `activateMultiBody()`, `syncVisuals()`, `setMotorTargets()`
- **Lifecycle**: Initialized by `useWorld.ts`. Progresses through steps A→B→C→D. Step D activates the multi-body PD system.

### HumanoidMultiBodyManager
- **File**: `src/world/engine/HumanoidMultiBodyManager.ts`
- **Responsibility**: Creates a rigid body for every tracked bone, connects them with Rapier joints, and applies per-frame PD torques.
- **Interface**: `activate()`, `setTargets()`, `syncVisuals()`, `setGainScale()`
- **Key Logic**: 
  - `BONE_PD_GAINS` map defines stiffness/damping per bone.
  - `setTargets()` iterates all bones, computes quaternion error, converts to axis-angle, applies `addTorque()`.
  - Applies a **balance torque** to the capsule root to keep it upright.

### RapierJointMotorController
- **File**: `src/world/engine/RapierJointMotorController.ts`
- **Responsibility**: Wraps Rapier's `configureMotorPosition()` for **revolute joints only**.
- **Critical Limitation**: Spherical joints do **not** use Rapier's built-in motors. They rely entirely on manual PD torque application in `HumanoidMultiBodyManager.setTargets()`.

### PhysicsEngine
- **File**: `src/world/engine/PhysicsEngine.ts`
- **Responsibility**: Owns the Rapier `World`. Steps physics at 60Hz, clamps velocities, and drains contact events.
- **Key Constants**: `MAX_LINEAR_VELOCITY = 8.0`, `MAX_ANGULAR_VELOCITY = 6.0` (from `anatomicalLimits.ts`).

## Data Flow
1. AI sends action → `useWorld.ts` event handler → `HumanoidPhysicsBinder.setMotorTargets()`
2. `setMotorTargets()` stores parsed targets in `currentTargets` Map.
3. Physics step loop (`WorldEngine.start()`) calls `HumanoidPhysicsBinder.updateMotorTargets()`.
4. `updateMotorTargets()` calls `HumanoidMultiBodyManager.setTargets()`.
5. `setTargets()` computes PD torques and applies them via `addTorque()`.
6. `syncVisuals()` lerps visual bones to match physics.

## Non-Obvious Behaviors & Design Decisions

### 1. Spherical Joints Have No Native Rapier Motors
Rapier's `ImpulseJoint` motor API (`configureMotorPosition`) only works for **revolute** joints. For spherical joints (shoulders, hips, spine, neck), the code manually computes PD torques in `HumanoidMultiBodyManager.setTargets()`. This means:
- **Stability depends entirely on the correctness of the PD implementation**.
- If gains are too low, joints are floppy. If too high, they explode.

### 2. PD Gains Are Likely Too Low for Stability
The `BONE_PD_GAINS` in `HumanoidMultiBodyManager.ts` are:

| Bone Group | Stiffness | Damping | Mass (kg) | Inertia (approx) |
|------------|-----------|---------|-----------|------------------|
| Spine      | 100–150   | 25–37   | 4–6       | 0.06–0.20        |
| Arms       | 40–100    | 10–25   | 0.4–2.2   | 0.002–0.03       |
| Legs       | 120–200   | 30–50   | 1.1–8.5   | 0.005–0.15       |
| Fingers    | 5         | 1       | 0.008–0.02| 0.00001–0.0001   |

**The Problem**: For a 2.2kg arm segment with inertia ~0.03, a stiffness of 100 N·m/rad is insufficient to counteract gravity and inertial coupling from the 70kg capsule. The arm acts like a pendulum with weak spring force, causing oscillation and "jitter."

### 3. EMA Filtering Introduces Lag
`HumanoidMultiBodyManager.ts` uses an EMA filter (`EMA_ALPHA = 0.30`) on target quaternions. This smooths AI commands but adds lag. The PD controller then tracks a moving target, which can cause overshoot and oscillation if the gains aren't tuned for the filtered signal.

### 4. AvatarSynchronizer Adds More Lag
`AvatarSynchronizer.ts` uses `smoothingAlpha = 0.5` for visual bone slerping. This is a **second** layer of smoothing on top of the EMA filter. The visual bones trail the physics bodies by multiple frames, making the system feel "mushy" and less responsive.

### 5. Velocity Clamping Is Reactive, Not Preventive
`PhysicsEngine.step()` clamps velocities **after** the Rapier step:
```typescript
this.clampRegisteredBodyVelocities();
```
This means bodies can gain huge velocities during the solver step (especially from joint constraint forces) before being clamped. The clamping itself can inject energy or cause popping.

### 6. Balance Torque Is Applied to the Capsule, Not the Bones
The `BALANCE_KP = 200` and `BALANCE_KD = 80` torque is applied to the **capsule root only**. This keeps the capsule upright but does nothing to prevent individual limbs from flailing. The limbs are only stabilized by their own PD gains, which are too weak.

### 7. Joint Limits Are Asymmetric and Potentially Conflicting
`rigConstraints.ts` defines limits for revolute joints, but spherical joints use a single `primaryLimit` computed as:
```typescript
const primaryLimit = Math.min(
  Math.abs(constraint.x[1] - constraint.x[0]) / 2,
  Math.abs(constraint.y[1] - constraint.y[0]) / 2,
  Math.abs(constraint.z[1] - constraint.z[0]) / 2
);
```
This collapses 3D limits into a single scalar, which is overly restrictive for some joints and insufficient for others. When limits are violated, Rapier applies corrective impulses that can conflict with PD torques.

### 8. The "Explosion" Likely Comes from Gain Ramping
On activation, `HumanoidMultiBodyManager` ramps gains from 0.1 to 1.0 over 15 frames (`RAMP_FRAMES = 15`). During this ramp, the PD controller is severely under-damped. If the AI issues a command during ramp-up, the low stiffness cannot counteract the initial transient, causing the body to "explode" outward before the gains catch up.

## Root Cause Analysis

The user's intuition is correct: **there is not enough "adhesive force" (stiffness/damping) to hold the body together**.

The current system behaves like a ragdoll because:

1. **Spherical joints lack native motors**: They rely on manual PD, which is weaker than Rapier's constraint solver.
2. **PD gains are tuned for gentleness, not stability**: Values like `stiffness: 50, damping: 12` for shoulders are appropriate for a 0.5kg limb, not a 2.2kg arm attached to a 70kg torso.
3. **No feedforward gravity compensation**: The PD controller only reacts to error. It doesn't proactively apply torque to cancel gravity, so limbs sag and oscillate.
4. **Multiple smoothing layers**: EMA + visual slerp = delayed feedback, causing the PD to overcorrect.
5. **Gain ramping creates a vulnerability window**: The first 15 frames after activation are unstable by design.

## Recommendations (For Act Mode)

To make the body "stable but not frozen," the following changes are needed:

### 1. Increase PD Gains Significantly
Multiply `BONE_PD_GAINS` by 3–5× for major joints:
- Legs: `stiffness: 600–1000, damping: 120–200`
- Arms: `stiffness: 300–500, damping: 60–100`
- Spine: `stiffness: 400–600, damping: 80–120`

### 2. Add Feedforward Gravity Compensation
In `HumanoidMultiBodyManager.setTargets()`, compute the torque needed to hold each limb against gravity and add it as a feedforward term:
```typescript
const gravityTorque = computeGravityTorque(bodyData, parentBody);
localTorque.add(gravityTorque);
```

### 3. Reduce or Remove EMA Filtering
Lower `EMA_ALPHA` to 0.1 or remove it entirely for stability-critical joints (spine, legs). The AI's command rate (60Hz) is already smooth enough.

### 4. Use Rapier's `configureMotorModel` for Spherical Joints
Investigate if Rapier's `JointData.spherical()` supports motor models in newer versions. If not, consider decomposing spherical joints into 3 revolute joints (gimbal) to use native motors.

### 5. Remove Gain Ramping
The `RAMP_FRAMES` mechanism should be removed or replaced with an instant high-gain activation. The body should be stable from frame 0.

### 6. Add Joint Damping at the Rapier Level
Call `joint.setDamping()` on all impulse joints during creation. This adds passive stability independent of the PD controller.

### 7. Implement a "Hold Pose" Mode
When no AI command is active, the PD target should be the **current bind pose**, not zero. This makes the body actively hold its posture rather than drift.

## Module Reference

| File | Purpose |
|------|---------|
| `src/world/engine/HumanoidMultiBodyManager.ts` | Core PD controller. **Needs gain tuning and feedforward.** |
| `src/world/engine/HumanoidPhysicsBinder.ts` | Orchestrator. Handles capsule creation and multi-body activation. |
| `src/world/engine/RapierJointMotorController.ts` | Revolute motor wrapper. **Spherical joints bypass this.** |
| `src/world/engine/AvatarSynchronizer.ts` | Visual sync. **Adds smoothing lag.** |
| `src/world/engine/PhysicsEngine.ts` | Rapier world. **Post-step velocity clamping is reactive.** |
| `src/constants/physics.ts` | Mass/inertia matrix. **Values are reasonable.** |
| `src/constants/rigConstraints.ts` | Joint limits. **Spherical limit calculation is flawed.** |
| `src/constants/anatomicalLimits.ts` | Velocity limits. **MAX_ANGULAR_VELOCITY = 6.0 may be too high.** |

## Suggested Reading Order
1. `src/world/engine/HumanoidMultiBodyManager.ts` — Understand the PD loop and gain values.
2. `src/world/engine/HumanoidPhysicsBinder.ts` — See how the capsule and multi-body are activated.
3. `src/world/engine/RapierJointMotorController.ts` — Learn why spherical joints are weaker.
4. `src/constants/rigConstraints.ts` — Review joint limit definitions.
5. `src/world/hooks/useWorld.ts` — Trace the action pipeline from AI to physics.
