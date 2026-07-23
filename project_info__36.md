# Synthia v1.5 — Root Cause Analysis: Model Hovering & Capsule Architecture

## Summary

This report addresses two questions: (1) why the humanoid model hovers ~80mm above the ground with no foot contact, causing constant backward falling, and (2) why the capsule architecture is still present in the MuJoCo version. The answer to both is found in the interaction between the motor controller's idle stance and the bind pose kinematics.

---

## ROOT CAUSE: Idle Stance Joint Angles Shorten Effective Leg Length

**The model hovers because the idle balance stance (`MotorController.ts` lines 81-105) applies non-zero hip, knee, and ankle angles relative to the T-pose bind pose, which shortens the effective distance from hip to foot. The capsule cannot sink further because it contacts the floor. Result: feet hover ~80mm above ground.**

### The Kinematics Chain

In the T-pose bind pose (which is the initial state at simulation start), all joint angles = 0:
- Hips: neutral (0°)
- Knees: full extension (0°) 
- Ankles: neutral (0°, foot sole parallel to ground)

The distance from hip joint to foot sole in this configuration is the maximum possible (full leg extension ≈ 0.95m, per `hipToFootDistance` calculation).

When the idle stance engages, it drives the joints to non-zero targets (from `MotorController.ts:getIdleTargets()`):

| Joint | Target | Effect |
|-------|--------|--------|
| `mixamorigleftupleg` (hip) | x = -0.10 rad (-5.7°) | Thigh rotates forward, foot rises |
| `mixamorigrightupleg` (hip) | x = -0.10 rad (-5.7°) | Same |
| `mixamorigleftleg` (knee) | x = -0.12 rad (-6.9°) | Knee bends, shin rotates back, foot rises |
| `mixamorigrightleg` (knee) | x = -0.12 rad (-6.9°) | Same |
| `mixamorigleftfoot` (ankle) | x = +0.10 rad (+5.7°) | Dorsiflexion, toes up |
| `mixamorigrightfoot` (ankle) | x = +0.10 rad (+5.7°) | Same |

The net effect of these rotations is to shorten the hip-to-foot-sole distance by approximately 0.08m (80mm). Since the capsule (attached to the hips via the spine and pelvis bones) is already resting on the ground, it cannot move downward to compensate. The feet therefore hover 80mm above the floor.

### Proof from the Log

From `logs.md`:
```
2.28s Lfoot gap=10.0mm   bodyZ=0.0mm   ← Spawn, feet at ground
2.37s Lfoot gap=114.6mm  bodyZ=104.6mm ← 0.09s later, feet rise 10cm!
2.42s Lfoot gap=121.3mm  bodyZ=111.3mm ← Rising further as motors ramp
2.87s Lfoot gap=133.9mm  bodyZ=123.9mm ← Peak hover
3.17s Lfoot gap=128.6mm  bodyZ=118.6mm ← Settling
4.03s Lfoot gap=107.6mm  bodyZ=97.6mm  ← Oscillating
5.21s Lfoot gap=84.1mm   bodyZ=74.1mm  ← Steady state hover
5.24s-11.58s Lfoot gap=~80.6mm  bodyZ=~70.6mm ← PERSISTENT 80mm HOVER
```

The `rampFactor = Math.min(1.0, simulationStepCount / 20)` in `MotorController.setTargets()` causes the motors to ramp up over ~20 physics steps (~0.33 seconds). The hover fully establishes by ~2.9 seconds and never recovers.

### Why the Model Falls Backward

With an 80mm gap between feet and ground:
1. **No foot-ground contact** → no friction force (µN = 0 since N = 0)
2. **No lateral ground reaction forces** from KGRF (the `applyKinematicGroundReactionForces` method only fires when `state.inContact` is true for foot bone colliders)
3. **The capsule alone contacts the ground** but provides only vertical support and balance torque — no forward/backward friction control
4. **Any forward or backward tilt** from the balance controller creates a moment that can't be counteracted by friction, causing the model to topple

The system enters a catch-22: the idle stance lifts the feet → no friction → model tips → balance controller tries to compensate by tilting more → no friction to resist → fall.

---

## Why the Capsule Exists (and Wasn't Scrapped)

The capsule is **not an artifact of the Rapier version** — it's integral to the MuJoCo physics model. It serves these functions:

### 1. Ground Contact Surface
The capsule (`root_capsule`) is the only body that consistently contacts the ground. It's a vertical capsule with radius=0.2m and half-height=0.7m, centered at ~0.9m above the floor. Its bottom touches the ground for vertical support.

### 2. Mass Carrier
The capsule carries 70kg of the humanoid's mass (`<inertial pos="0 0 0" mass="70" diaginertia="10.0 10.0 10.0"/>` in MJCF). Individual bones carry smaller masses (8.5kg for each thigh, 4.2kg for each shin, etc.).

### 3. Balance Control Platform
The `applyCapsuleBalance()` method in MotorController.ts computes an upright-stabilizing torque based on the capsule's tilt angle and angular velocity. This is the primary balance mechanism — it directly applies torque to the capsule body via `xfrc_applied`.

### 4. Parent for All Bones
All three kinematic branches (spine, left leg, right leg) are attached as children of the capsule body in the MJCF. The capsule provides the inertial reference frame for all joint movements.

### 5. Simplified Control Abstraction
The capsule + multi-body PD architecture provides a clean separation: the capsule handles global position/orientation and balance, while the joints handle pose/gesture. This is a standard approach in humanoid robotics (inverted pendulum model).

**The capsule was NOT scrapped.** The migration from Rapier to MuJoCo preserved the capsule concept because it models the physical reality that most of a humanoid's mass is concentrated in the torso, and the legs primarily provide ground contact and pose configuration.

---

## Secondary Issues Found

### Issue 1: Foot Collider Offset at `pos="0 0 0.02"`
In `MJCFHumanoidTemplate.ts` line 141:
```xml
<geom name="${boneName}_geom" type="box" ... pos="0 0 0.02" .../>
```
The foot geom is offset 0.02m (20mm) above the foot bone origin. This adds to the effective hover gap. With `FOOT_OFFSET_Z = 0.02` and `FOOT_HALF_HEIGHT = 0.01` in `footGroundDistance.ts`, the diagnostic code already accounts for this, but the actual collision geometry sits higher than the true foot bottom.

### Issue 2: KGRF Depends on Foot Contact
`applyKinematicGroundReactionForces()` in `HumanoidPhysicsBinder.ts` (lines 344-415) only applies forces when:
```typescript
const state = registry.get(colliderHandle);
if (!state || !state.inContact || state.impulse_magnitude < 0.5) continue;
```
Since the feet hover, this entire system is inert. The fallback path (lines 394-415) tracks previous foot positions to detect motion relative to the ground, but this also requires `currentPos.y <= this.groundSurfaceY + 0.15` which is never true at 80mm hover.

### Issue 3: Spawn Alignment Runs Only Once
In `syncVisuals()`, the spawn alignment code:
```typescript
if (!this.targetSpawnGrounded && dist >= 0) {
  // ... compute delta and setCapsulePosition
  this.targetSpawnGrounded = true;
}
```
This fires on the first sync frame but the motors haven't ramped up yet. The alignment correctly places the feet on the ground at spawn, but **the hover develops over the next 20-30 frames as the motors ramp** and the alignment code never re-runs.

### Issue 4: No Active Hover Correction
There is no system that detects the foot hover and corrects it by either:
- Extending the legs (changing joint targets)
- Lowering the capsule
- Applying downward force on the feet

The hover is a steady-state equilibrium with no feedback loop to close the gap.

---

## Failed Files & Specific Lines

### PRIMARY FILE: `src/world/engine/MotorController.ts`
- **Line 81-105**: `getIdleTargets()` — defines the biomechanically-stable standing stance with bent knees and dorsiflexed ankles
- **Line 120**: `activeTargets = this.idleModeActive ? this.getIdleTargets() : currentTargets` — idle stance overrides any external targets
- **Line 114**: `rampFactor = Math.min(1.0, this.simulationStepCount / 20)` — motors ramp over ~0.33s
- **Line 152-165**: `applyCapsuleBalance()` — applies upright torque to capsule but cannot fix foot hover

### PRIMARY FILE: `src/world/engine/HumanoidPhysicsBinder.ts`
- **Line 268-290**: `syncVisuals()` — spawn alignment (fires once, doesn't re-correct)
- **Line 343-415**: `applyKinematicGroundReactionForces()` — inert because feet don't contact ground
- **Line 209**: `GROUND_SNAP_THRESHOLD = 0.12` — grounded detection uses generous 12cm threshold, masking the real issue
- **Line 270**: `this._isGrounded = capsuleBottomY <= (this.groundSurfaceY + this.GROUND_SNAP_THRESHOLD)` — always reports grounded because capsule touches ground

### PRIMARY FILE: `src/debug/footGroundDistance.ts`
- **Line 15-17**: `FOOT_HALF_HEIGHT = 0.01, FOOT_OFFSET_Z = 0.02` — accounts for geom offset in its gap calculation
- **Line 21**: `bodyZ = data.xpos[idx + 2]` — reads body center Z in MuJoCo space, adds offset/half-height to compute gap

### PRIMARY FILE: `src/world/engine/MJCFHumanoidTemplate.ts`
- **Line 137-143**: Foot box geom: `size="0.05 0.11 0.01" pos="0 0 0.02"` — the actual collision geometry for feet
- **Line 95**: Capsule size: `capsuleRadius = 0.2, capsuleHalfHeight = max(0.1, (modelHeight/2) - capsuleRadius)` = 0.7m
- **Line 177-179**: Three branches (spine, left leg, right leg) attached to capsule

---

## Recommended Fixes (for Act Mode)

1. **In `MotorController.ts:getIdleTargets()`**: Set ALL leg joint targets to 0 (straight leg) for the idle stance. The current "biomechanically stable" stance with bent knees is actually destabilizing because it lifts the feet.

2. **Add foot-ground contact height correction**: In `syncVisuals()`, add persistent re-grounding logic that runs every frame and adjusts the capsule height to maintain foot-ground contact within a tolerance.

3. **Fix foot collider position**: Change the foot geom offset in `MJCFHumanoidTemplate.ts` from `pos="0 0 0.02"` to `pos="0 0 0.01"` or 0 to eliminate the artificial offset.

4. **Add soft foot-ground contact**: Configure MuJoCo contact parameters to allow slight foot penetration (soft constraint) so the feet can "sink" into the ground slightly and generate friction even when the kinematics don't perfectly reach.

5. **Reduce idle stance aggressiveness**: Use smaller initial angles with a slower ramp to let the physics settle the capsule position naturally.
