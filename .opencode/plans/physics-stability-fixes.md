# Physics Stability Fixes — Plan

## Problem
The humanoid model collapses, contorts, and jitters violently after multi-body PD motor activation. Root causes identified:
1. No explicit mass on bone rigid bodies — Rapier auto-computes from collider volume, creating 8:1 mass ratios between femur and hand bones
2. PD gains are severely underdamped (ζ ≈ 0.10) — causes persistent oscillation
3. MAX_TORQUE = 50 Nm is too high — allows violent impulses
4. MAX_ANGULAR_VELOCITY = 3.0 rad/s fights the PD controller — creates jitter as clamp repeatedly cuts velocity
5. No per-frame velocity damping in the PD torque path — oscillation energy accumulates

## Files to Modify
- `src/world/engine/HumanoidMultiBodyManager.ts` (Fixes 1, 2, 3, 5)
- `src/constants/anatomicalLimits.ts` (Fix 4)

---

## Fix 1: Uniform Bone Mass
**File:** `HumanoidMultiBodyManager.ts` line ~270
**Change:** Add `.setMass(1.0)` to RigidBodyDesc chain

Before:
```typescript
const rbDesc = RAPIER.RigidBodyDesc.dynamic()
  .setTranslation(boneWorldPos.x, boneWorldPos.y, boneWorldPos.z)
  .setRotation({ x: boneWorldQuat.x, y: boneWorldQuat.y, z: boneWorldQuat.z, w: boneWorldQuat.w })
  .setGravityScale(1.0)
  .setLinearDamping(3.0)
  .setAngularDamping(3.0);
```

After:
```typescript
// Uniform mass (1.0 kg) prevents mass-ratio instability where tiny
// bones (hands) get near-zero mass and accelerate to infinity under PD torque.
const rbDesc = RAPIER.RigidBodyDesc.dynamic()
  .setTranslation(boneWorldPos.x, boneWorldPos.y, boneWorldPos.z)
  .setRotation({ x: boneWorldQuat.x, y: boneWorldQuat.y, z: boneWorldQuat.z, w: boneWorldQuat.w })
  .setMass(1.0)
  .setGravityScale(1.0)
  .setLinearDamping(3.0)
  .setAngularDamping(3.0);
```

---

## Fix 2: Critically-Damped PD Gains
**File:** `HumanoidMultiBodyManager.ts` lines 49-70
**Change:** Replace BONE_PD_GAINS with higher damping ratios (target ζ ≈ 0.20)

Before → After:
| Bone | Old Kp/Kd | New Kp/Kd | ζ Old → New |
|---|---|---|---|
| spine | 200/20 | 150/25 | 0.10 → 0.20 |
| neck | 100/10 | 80/18 | 0.10 → 0.20 |
| head | 80/8 | 60/15 | 0.10 → 0.19 |
| left/rightarm | 120/12 | 100/20 | 0.10 → 0.20 |
| left/rightforearm | 80/10 | 60/15 | 0.12 → 0.19 |
| left/righthand | 50/5 | 40/12 | 0.10 → 0.19 |
| left/rightupleg | 250/25 | 200/30 | 0.10 → 0.15 |
| left/rightleg | 250/25 | 200/30 | 0.10 → 0.15 |
| left/rightfoot | 150/15 | 120/22 | 0.10 → 0.18 |

---

## Fix 3: Reduce MAX_TORQUE
**File:** `HumanoidMultiBodyManager.ts` line ~612
**Change:** `const MAX_TORQUE = 50.0;` → `const MAX_TORQUE = 15.0;`

---

## Fix 4: Increase Angular Velocity Limit
**File:** `anatomicalLimits.ts` line 112
**Change:** `export const MAX_ANGULAR_VELOCITY = 3.0;` → `export const MAX_ANGULAR_VELOCITY = 6.0;`

---

## Fix 5: Per-Frame Velocity Damping
**File:** `HumanoidMultiBodyManager.ts` after line 608 (after localTorque computation)
**Change:** Add velocity-proportional damping before the magnitude clamp

Insert after line 608:
```typescript
// Explicit velocity damping to suppress oscillation at the source.
// Reduces energy accumulation that would otherwise cause jitter
// even with correctly tuned PD gains.
const VELOCITY_DAMPING = 0.3;
localTorque.x -= VELOCITY_DAMPING * localAngVel.x;
localTorque.y -= VELOCITY_DAMPING * localAngVel.y;
localTorque.z -= VELOCITY_DAMPING * localAngVel.z;
```

---

## Verification
After applying all fixes, run:
```
npx tsc --noEmit
```
