# HumanoidPhysicsBinder - Step-by-Step Testing Guide

## Architecture Rewrite Summary

The entire humanoid physics binding system has been rebuilt from scratch with explicit step isolation. The old `ModelRigBinder.ts` and first version of `RagdollBuilder.ts` have been deleted. The new `HumanoidPhysicsBinder.ts` replaces all humanoid physics logic.

### What Changed
- **Deleted**: `ModelRigBinder.ts`, old `RagdollBuilder.ts` (recreated as minimal non-humanoid-only version)
- **Created**: `HumanoidPhysicsBinder.ts` (complete rewrite)
- **Updated**: `useWorld.ts` hook to use new binder and expose console API

### Implementation: 4 Isolated Steps

#### STEP A: Bone Visualization (No Physics)
- Loads x-bot.glb model
- Extracts bones in bind pose
- Renders green debug spheres at each bone position
- **Entry point**: `loadAndVisualizeBindPose(spawnPoint)`
- **Console**: Model auto-loads when body type = 'humanoid'

#### STEP B: Rigid Bodies + Colliders (No Joints)
- Creates dynamic rigid bodies at each bone position
- Adds capsule colliders (length = bone length, radius = 0.015)
- **No joints yet** - bodies fall independently under gravity
- Should see separate capsules tumbling naturally
- **Entry point**: `createRigidBodiesAndColliders(spawnPoint)`
- **Console**: `await __SYNTHIA_HUMANOID_BINDER__.nextStep()`

#### STEP C: Joints with ZERO Motors
- Connects parent→child bones with spherical joints
- Motor stiffness = 0, damping = 0 (purely passive)
- Body should collapse like a floppy cloth doll, not explode
- **Entry point**: `createJointsWithZeroMotors(spawnPoint)`
- **Console**: `await __SYNTHIA_HUMANOID_BINDER__.nextStep()`

#### STEP D: Gradual Motor Activation
- Activates motors with tunable stiffness/damping
- Starts at LOW values (20/5) to avoid oscillation
- Increments: 20/5 → 50/8 → 100/10 → 150/12 (and beyond)
- **Entry point**: `activateMotorsWithStiffnessAndDamping(stiffness, damping)`
- **Console**: `await __SYNTHIA_HUMANOID_BINDER__.nextStep()` then tune with `adjustMotors(kp, kd)`

## Console API for Testing

Open browser DevTools (F12) and use these commands:

### Progress Through Steps
```javascript
await __SYNTHIA_HUMANOID_BINDER__.nextStep()
```
Progresses A→B→C→D automatically.

### Tune Motors (STEP D only)
```javascript
await __SYNTHIA_HUMANOID_BINDER__.adjustMotors(stiffness, damping)
```
Examples:
- `adjustMotors(20, 5)`   - Very soft
- `adjustMotors(50, 8)`   - Moderate
- `adjustMotors(100, 10)` - Stiffer
- `adjustMotors(150, 12)` - Target

### View Diagnostics
```javascript
__SYNTHIA_HUMANOID_BINDER__.getDiagnostics()
```
Returns:
- Build step (A/B/C/D)
- Bone/body/joint counts
- Current stiffness/damping
- Gravity/friction

### Get Motor Settings
```javascript
__SYNTHIA_HUMANOID_BINDER__.getMotorSettings()
```

### Apply External Impulse (Testing Recovery)
```javascript
__SYNTHIA_HUMANOID_BINDER__.push('mixamorighips', new THREE.Vector3(50, 0, 0))
```
Applies impulse to a specific bone. Observe how quickly/smoothly it recovers.

## Verification Checklist

Record observations for each step:

### STEP A
- [ ] Green spheres visible at bone positions
- [ ] Bones form recognizable human shape
- [ ] No physics artifacts

### STEP B
- [ ] Capsules separate and fall independently
- [ ] No collision/explosion
- [ ] Natural tumbling motion

### STEP C
- [ ] Ragdoll collapses smoothly like cloth
- [ ] No violent oscillation or folding
- [ ] Joints hold structure but allow passive motion

### STEP D (Incremental)
- [ ] At stiffness=20/5: Model stands but wobbles slightly?
- [ ] At stiffness=50/8: More stable, smooth?
- [ ] At stiffness=100/10: Very stable, any oscillation?
- [ ] At stiffness=150/12: Locked in place, or still stable?
- **Record**: At which stiffness level does oscillation first appear?

## Gravity & Friction Tuning (Once Stable)

Once STEP D is stable at some stiffness level:

### Test Gravity Increments
```javascript
__SYNTHIA_PHYSICS_ENGINE__.setGravity(-1)   // Very light
__SYNTHIA_PHYSICS_ENGINE__.setGravity(-5)   // Moderate
__SYNTHIA_PHYSICS_ENGINE__.setGravity(-9.81) // Earth standard
```
Record which feels most stable.

### Test Friction Increments
Friction is currently hardcoded in collider creation. If needed, modify and rebuild:
- `capsuleRadius = 0.015` → friction-like resistance
- Friction setting in collider desc → adjust in code

## Camera Stability Verification

The camera is bound to the humanoid head. Once model is stable:
- [ ] Camera does NOT shake in sync with model oscillation
- [ ] Third-person view is smooth
- [ ] No jittering or sudden movements

If camera still shakes with stable model → issue is in `CameraManager` or head transform interpolation, not physics.

## Output Files

- **New**: `src/world/engine/HumanoidPhysicsBinder.ts` (~800 lines)
- **Restored**: `src/world/engine/RagdollBuilder.ts` (minimal, non-humanoid only)
- **Updated**: `src/world/hooks/useWorld.ts` (imports, initialization, console exposure)

## Expected Behavior Summary

| Step | Expected Result | Failure Mode |
|------|-----------------|--------------|
| A | Green spheres at bone positions | Spheres deformed/off-position = bone reading bug |
| B | Separate capsules falling naturally | Explosion/violent motion = geometry/collision issue |
| C | Floppy ragdoll collapse | Oscillation at this stage = joint anchor problem |
| D @ 20/5 | Slight wobble | Immediate explosion = motor config issue |
| D @ 150/12 | Stable standing | Violent shaking = damping/stiffness ratio wrong |

---

**Status**: Code complete, ready for step-by-step testing via console API. No assumptions made about correct values—test incrementally and record exact values at which stability/instability occurs.
