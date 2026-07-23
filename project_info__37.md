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
5.21s Lfoot gap=84.1mm   bodyZ=74.1mm  ← Steady state hover at ~80mm
5.24s-11.58s Lfoot gap=~80.6mm  bodyZ=~70.6mm ← PERSISTENT 80mm HOVER
```

The `rampFactor = Math.min(1.0, simulationStepCount / 20)` in `MotorController.setTargets()` causes the motors to ramp up over ~20 physics steps (~0.33 seconds). The hover fully establishes by ~2.9 seconds and never recovers. The gap plateaus at exactly 80mm because that's the amount of leg shortening from the combined hip, knee, and ankle angles.

Note the **oscillation pattern** between 2.9s-5.2s: the gap peaks at 133.9mm, drops to 78.0mm, then oscillates before settling at 80mm. This is the balance controller fighting the hover — tilting the capsule changes the effective height, causing the oscillation.

### Why the Model Falls Backward

With an 80mm gap between feet and ground:
1. **No foot-ground contact** → no normal force → no friction force (µN = 0 since N = 0)
2. **No lateral ground reaction forces** from KGRF (the `applyKinematicGroundReactionForces` method only fires when `state.inContact` is true for foot bone colliders)
3. **The capsule alone contacts the ground** but provides only vertical support and balance torque — no forward/backward friction control
4. **Any forward or backward tilt** from the balance controller creates a moment that can't be counteracted by friction, causing the model to topple

The system enters a catch-22: the idle stance lifts the feet → no friction → model tips → balance controller tries to compensate by tilting more → no friction to resist → fall.

### Why You Feel "No Grip of the Ground = Falling Hence the Constant Falling Backward"

You're exactly right. The feet have no contact with the ground because they're 80mm above it. The foot geoms in the MJCF have `contype="2" conaffinity="1"` which means they collide with `contype=1` objects. The floor has `contype="1" conaffinity="2"`. So collision configuration is correct — the only problem is **geometric**: the feet are physically above the floor surface.

---

## Why the Capsule Exists (and Wasn't Scrapped)

The capsule is **not an artifact of the Rapier version** — it's integral to the MuJoCo physics model and serves these essential functions:

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

**So no, the capsule was never scrapped.** It's the core structural element of the MuJoCo model.

---

## Secondary Issues Found

### Issue 1: Foot Collider Offset at `pos="0 0 0.02"`
In `MJCFHumanoidTemplate.ts` line 141:
```xml
<geom name="${boneName}_geom" type="box" size="0.05 0.11 0.01" pos="0 0 0.02" contype="2" conaffinity="1"/>
```
The foot geom is offset 0.02m (20mm) ABOVE the foot bone origin, and it's only 0.01m half-height (so the bottom of the foot box is at z=0.01, 10mm above the bone origin). This adds an extra 10mm to the effective hover gap.

### Issue 2: KGRF Depends on Foot Contact
`applyKinematicGroundReactionForces()` in `HumanoidPhysicsBinder.ts` (lines 344-415) only applies forces when:
```typescript
const state = registry.get(colliderHandle);
if (!state || !state.inContact || state.impulse_magnitude < 0.5) continue;
```
Since the feet hover, this entire system is inert — the registry never gets a contact update for the foot geoms because they never touch anything.

### Issue 3: Spawn Alignment Runs Only Once
In `syncVisuals()`, the spawn alignment code:
```typescript
if (!this.targetSpawnGrounded && dist >= 0) {
  const delta = this.groundSurfaceY - lowestFootY;
  if (Math.abs(delta) > 0.001) {
    this.setCapsulePosition(t.x, t.y + delta - this.capsuleCenterY, t.z);
  }
  this.targetSpawnGrounded = true;
}
```
This fires on the first sync frame but the motors haven't ramped up yet. The `targetSpawnGrounded` flag is set to `true` after the first correction and **never resets**. The hover develops over the next 20-30 frames as the motors ramp, and the alignment code never re-runs.

### Issue 4: No Active Hover Correction System
There is no system that detects the foot gap and corrects it. This means the hover is a **steady-state equilibrium with no feedback loop to close the gap**.

### Issue 5: `_isGrounded` Mask
In `HumanoidPhysicsBinder.ts` line 270:
```typescript
this._isGrounded = capsuleBottomY <= (this.groundSurfaceY + this.GROUND_SNAP_THRESHOLD);
```
With `GROUND_SNAP_THRESHOLD = 0.12` (12cm) and the capsule bottom touching the ground, `_isGrounded` is always `true` even when the feet are 80mm in the air. This means **the system thinks it's grounded when it's not**, masking the root cause.

---

## Key Files & Lines

| File | Lines | What |
|------|-------|------|
| `src/world/engine/MotorController.ts` | 81-105 | `getIdleTargets()` — the idle stance targets that cause the hover |
| `src/world/engine/MotorController.ts` | 114 | `rampFactor` — motor ramp over 20 frames |
| `src/world/engine/MotorController.ts` | 120 | `activeTargets = this.idleModeActive ? this.getIdleTargets() : currentTargets` |
| `src/world/engine/HumanoidPhysicsBinder.ts` | 268-290 | Spawn alignment in `syncVisuals()` — fires once, never repeats |
| `src/world/engine/HumanoidPhysicsBinder.ts` | 343-415 | `applyKinematicGroundReactionForces()` — inert when feet hover |
| `src/world/engine/HumanoidPhysicsBinder.ts` | 209 | `GROUND_SNAP_THRESHOLD = 0.12` — masks the real issue |
| `src/world/engine/MJCFHumanoidTemplate.ts` | 137-143 | Foot box geom with 20mm upward offset |
| `src/world/engine/MJCFHumanoidTemplate.ts` | 95 | Capsule radius=0.2, half-height=0.7 |
| `src/debug/footGroundDistance.ts` | 10-24 | Diagnostic that measures the gap |
| `src/world/logs.md` | Full | The log data showing the hover evolution |

---

## Recommended Fixes (for Act Mode)

1. **In `MotorController.ts:getIdleTargets()`**: Set ALL leg joint targets to 0 (full extension) for the idle stance. The hip targets should be 0, knee targets 0, ankle targets 0. The current "biomechanically stable" stance with bent knees is actually destabilizing because it lifts the feet off the ground.

2. **Add persistent ground correction**: In `HumanoidPhysicsBinder.ts:syncVisuals()`, remove the `targetSpawnGrounded` flag guard or add a continuous foot-ground gap correction that runs every frame (with a small threshold to avoid oscillation).

3. **Fix foot collider offset**: Change `pos="0 0 0.02"` to `pos="0 0 0"` in `MJCFHumanoidTemplate.ts` for the foot geoms, or at minimum to `pos="0 0 0.005"` to eliminate the artificial upward offset.

4. **Reduce `GROUND_SNAP_THRESHOLD`**: Change from 0.12 to 0.02 so `_isGrounded` accurately reports whether the feet are actually contacting the ground.

5. **The capsule is correct and should stay.** It's the core structural element, not a leftover.