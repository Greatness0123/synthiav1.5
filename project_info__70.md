# Synthia — Walking Without Root-Capsule Teleport: Feature Audit & Root-Cause

## Summary
This report answers the question: **"Is there any feature/function/code that allows walking WITHOUT assigning values to the root capsule (teleporting it) — i.e., where the legs themselves move the body?"**

**Short answer: YES, the mechanism exists — but it is switched off, and the teleport path it was meant to replace is also broken.** The feature is the **kinematic ground-reaction-force (GRF) injector** in `src/world/engine/HumanoidPhysicsBinder.ts` → `applyKinematicGroundReactionForces()`. It is the designed answer to exactly this problem: instead of teleporting the root capsule, the legs' relative motion against the floor is converted into a **velocity impulse on the root freejoint** (`qvel`), so the body is pushed by its own legs. It is gated behind `const ENABLE_KINEMATIC_GRF_INJECTOR = false;` (compile-time) for the active multi-body path, and the legacy kinematic fallback only runs when the multi-body system is off. Meanwhile the `synthia:rootMotion` event handler — the teleport-style path that `console_walking.js`/captured animations rely on — calls `capsuleBody.setTranslation(...)` which **does not exist on `BodyProxy`**, so it throws a TypeError and does nothing.

Result: today the *only* code paths that translate the capsule are `setCapsulePosition()` (a direct `qpos` write = teleport) and `push()` (an arbitrary external impulse). A purely leg-driven walk cannot happen until the GRF injector is enabled and foot–floor contact is real.

---

## Direct Answer: Where leg-driven walking (no teleport) lives

### 1. `applyKinematicGroundReactionForces()` — the intended leg-driven locomotion
- **File**: `src/world/engine/HumanoidPhysicsBinder.ts` (private method, called every frame from `syncVisuals()`)
- **What it does**: converts foot motion/contact into a **linear-velocity impulse on the root capsule's freejoint DOFs** (`qvel[dofAdr..+2]`). It never writes `qpos` — the capsule is never teleported by this code.
- **Two branches**:

  **(a) Multi-body branch (`if (this.mbActive)`)** — the "proper" contact-driven one:
  - Gated by `ENABLE_KINEMATIC_GRF_INJECTOR`; currently `false` → immediate `return` when multi-body PD is active (which is the default app state).
  - Uses `PhysicsEngine.getContactForceRegistry()` (populated by `drainContactForceEventsInternal()` after each `mj_step` from real MuJoCo contacts).
  - For `mixamorigleftfoot` / `mixamorigrightfoot` geoms: requires `inContact`, `impulse_magnitude >= 0.5`, contact normal `nz >= 0.3` (floor contact).
  - Computes the lateral component of the contact normal projected onto the model's forward vector `(0,0,-1)` rotated by `modelRoot.quaternion`.
  - Forward push: `impulseMag = clamp(state.impulse_magnitude / 60, 0, 8.0)`; `grf = forward * forwardComponent * impulseMag`; `deltaV = grf / 70kg` written into `qvel[dofAdr + 0..2]` (MuJoCo coordinate conversion via `worldToMuJoCo`).
  - Turn: `torqueY` from foot offset × forward component, clamped to ±5.0, injected into the angular part `qvel[dofAdr + 3..5]` divided by inertia 10.
  - **This is the "legs move the body" physics**: the foot pushes against the ground; the ground's reaction pushes the freejoint.

  **(b) Kinematic fallback branch (when `mbActive === false`)** — runs unconditionally:
  - Tracks `previousFootPositions` for `mixamoriglefttoebase`/`mixamorigrighttoebase`.
  - When a toe is near the ground (`currentPos.y <= groundSurfaceY + 0.15`) and has planar movement (`deltaMag > 0.001`, forward component `> 0.002`), it injects `grf = -forwardMotion * KGRF_MULTIPLIER (150.0)`, capped at `MAX_GRF_IMPULSE = 16.0`, into the same `qvel` freejoint slots.
  - This branch is **not** flag-gated, but it is effectively inert because the shipped app activates multi-body PD (`useMultiBodyPD` defaults `true` in `src/store/worldStore.ts`, and `useWorld.ts` calls `activateMultiBody()`), so `mbActive` is `true` and branch (a)'s early return wins.

### 2. `synthia:rootMotion` — the teleport event is BROKEN
- **File**: `src/world/hooks/useWorld.ts` — `handleRootMotion` listener registered for `window` event `'synthia:rootMotion'`:
  ```ts
  const capsuleBody = humanoidPhysicsBinderRef.current.getCapsuleBody();
  ...
  capsuleBody.setTranslation({ x: t.x + dx, y: t.y, z: t.z + dz }, true);  // ← throws
  ```
- `getCapsuleBody()` returns a `BodyProxy` (HumanoidPhysicsBinder.ts). **`BodyProxy` has no `setTranslation` method** — its full API is `isValid()`, `translation()`, `rotation()`, `linvel()`, `angvel()`. Calling `setTranslation` throws `TypeError: capsuleBody.setTranslation is not a function`, so this handler never moves anything.
- This means the "root motion" path documented in `project_info__70`-era notes and in `console_walking.js` (which dispatches `synthia:rootMotion` / `setTranslation` to walk the captured animation) is **dead code in the current MuJoCo implementation**. The working teleport equivalent is `HumanoidPhysicsBinder.setCapsulePosition(x, y, z)` — a direct `qpos[qposadr..qposadr+2]` write that zeroes all 6 freejoint velocities.

### 3. What DOES translate the capsule today
| Method | Location | Mechanism | Teleport? |
|---|---|---|---|
| `setCapsulePosition(x,y,z)` | `HumanoidPhysicsBinder` | direct `qpos` write + zero `qvel` | ✅ yes (teleport) |
| `push(partName, impulse)` | `HumanoidPhysicsBinder` | `qvel` linear impulse, ignores `partName`, mass=70 | no (impulse) |
| `executeJump(force)` | `HumanoidPhysicsBinder` | zeroes 6 root velocities + `+Z` impulse | no (impulse) |
| `applyCapsuleBalance` | `MotorController` | `xfrc_applied[3..5]` torque only; **force `[0..2]` hard-zeroed** | no (can never translate) |
| `applyKinematicGroundReactionForces` | `HumanoidPhysicsBinder` | freejoint `qvel` impulse from foot/ground reaction | **no — the intended leg-driven walk** |
| `synthia:rootMotion` handler | `useWorld.ts` | calls missing `BodyProxy.setTranslation` | ❌ broken (TypeError) |

---

## Why leg-driven walking fails today (verified chain)

1. **The GRF injector is compile-time disabled** in the branch that matters: `const ENABLE_KINEMATIC_GRF_INJECTOR = false;` (HumanoidPhysicsBinder.ts, module scope). The multi-body branch returns before doing any work.
2. **Multi-body is on by default**: `useMultiBodyPD: true` in `worldStore.ts`; `useWorld.ts` build step calls `binder.activateMultiBody()` when truthy → `mbActive === true` → the flag guard applies.
3. **Foot–floor contact is marginal in practice**: `src/world/logs.md` from `src/debug/footGroundDistance.ts` shows idle feet hovering ~80 mm above the floor (`Lfoot gap=80.6mm bodyZ=70.6mm`). If planted feet don't generate real contact (`impulse_magnitude >= 0.5`), even an enabled injector would see `!state.inContact` and skip the push.
4. **The balance controller is translation-blind by design**: `applyCapsuleBalance` writes corrective torque into `xfrc[3..5]` and `0` force into `xfrc[0..2]` — it actively cancels lean (the very lean a walk needs) and can never assist forward motion.
5. **The position servos hold targets; nothing commands push-off**: hip/knee/ankle actuators are MuJoCo `position` actuators with kp 900–1000. They drag the legs to targets but the walk frames (diagnostic `Walk Cycle`) use tiny amplitudes (hip +25–30°, knee −25–30°, 250 ms per frame) with no hip extension beyond neutral, no ankle plantarflexion, and no forward CoM bias — so there is nothing for the GRF to convert even in principle.
6. **`handleRootMotion` dead**: as above, `BodyProxy.setTranslation` is missing, so the captured-walk teleport approach is also non-functional in this build.

## How to make leg-driven walking actually work (minimal changes)
- **Enable the injector**: flip `ENABLE_KINEMATIC_GRF_INJECTOR` to `true`.
- **Add `setTranslation` to `BodyProxy`** (write `qpos` via `model.jnt_qposadr`/`root_freejoint`, mirroring `setCapsulePosition`) *or* re-point `handleRootMotion` at `binder.setCapsulePosition()`.
- **Verify foot contact**: run `window.highlight_embed()` / `list()` from `console_highlight_geoms.js` and check `mixamorigleftfoot_geom`/`mixamorigrightfoot_geom` (box geoms, friction 1.5, contype=2, conaffinity=1) actually touch the floor (`floor` geom contype=1 conaffinity=2) in `data.contact` / the contact registry.
- **Use realistic gait data**: the captured `model data/sequenced animation/simple walking.json` (fps 30, 32 frames) is the ground-truth walk — hips reach ~±0.24–0.31 rad knee flex ~0.48 rad, plus real pelvis `Hips.pos` deltas (e.g. frame 0 `pos [0.093, 102.342, 1.614]` → frame 2 `[0.425, 103.094, 11.905]` — cm units, Z is forward here) — not the 25–30° diagnostic values.
- **Optionally relax the balance controller** during `activeGaitPhase` (it actively fights the forward lean a walk requires).

---

## Architecture (as relevant to this audit)

```
[AI action] coordinator: agentLoop.ts → WS 'action'
  → CoordinatorContext.tsx re-dispatches window 'synthia:action'
  → useWorld.ts handleAction() → validateAndApplyTimeline() → setMotorTargets()
  → MotorController.setTargets() → ctrl[yaw,pitch,roll]  (position servos, kp up to 1000)
  → WorldEngine.start() loop:  PhysicsEngine.step() @ 500 Hz (mj_step, timestep 0.002)
  → PhysicsEngine.drainContactForceEventsInternal()  → contactForceRegistry
  → useWorld.ts per-frame: binder.updateMotorTargets() + binder.syncVisuals()
      └─ syncVisuals() → applyKinematicGroundReactionForces()  ← THE LEG-DRIVEN WALK (disabled)
      └─ updateMotorTargets() → applyCapsuleBalance()  ← torque-only root balance
```

### The leg-driven loop as designed
1. Feet push against floor in a real MuJoCo contact (`foot_geom` contype=2 ↔ `floor` conaffinity=2).
2. `drainContactForceEventsInternal` records per-geom `inContact`, `impulse_magnitude`, `contact_normal` (force computed via `mj_contactForce`, DoubleBuffer).
3. `applyKinematicGroundReactionForces` (mbActive branch) projects the contact's lateral force onto model-forward; magnitude `min(impulse/60, 8.0)`.
4. `deltaV = impulse/70 kg` added to `qvel[dofAdr..+2]` → MuJoCo integrates the freejoint → capsule (and thus the whole body) translates. **No `qpos` write — no teleport.**
5. Yaw torque from foot position offset gives turning; body pivots around the planted foot.

The kinematic fallback branch does the same thing but from *visual* toe-base position deltas (`KGRF_MULTIPLIER = 150`, capped 16.0) instead of true contact force — it runs whenever `mbActive` is false.

## Module Reference

| File | Role in walking-without-teleport |
|---|---|
| `src/world/engine/HumanoidPhysicsBinder.ts` | `applyKinematicGroundReactionForces` — the leg-driven GRF walk (flag `ENABLE_KINEMATIC_GRF_INJECTOR = false`); `setCapsulePosition` (teleport); `push` (impulse); `executeJump`; `BodyProxy` (missing `setTranslation`) |
| `src/world/hooks/useWorld.ts` | `handleAction` (pose/timeline input), `handleRootMotion` — **calls missing `BodyProxy.setTranslation` → broken**; per-frame `updateMotorTargets()` / `syncVisuals()` |
| `src/world/engine/MotorController.ts` | `setTargets` (position-servo ctrl mapping, ramp 20 steps), `applyCapsuleBalance` (**torque-only, force=0 → can never translate**) |
| `src/world/engine/MJCFHumanoidTemplate.ts` | foot box geoms 26 cm × 10 cm, friction 1.5, contype=2 conaffinity=1; floor contype=1 conaffinity=2; position actuators (knee kp=1000, hip 900, ankle 600) — the contact pair the GRF injector reads |
| `src/world/engine/PhysicsEngine.ts` | 500 Hz `mj_step`; `drainContactForceEventsInternal` → `contactForceRegistry` consumed by the GRF injector; world↔MuJoCo conversions |
| `src/world/engine/BodyManager.ts` | `activate()` builds the MJCF + `bodyMap`/`geomMap`/`actuatorMap`; `getBoneColliderHandle('mixamorigleftfoot')` source for GRF contact lookup |
| `src/store/worldStore.ts` | `useMultiBodyPD: true` (default) → `mbActive` true → disabled injector branch wins |
| `src/world/engine/WorldEngine.ts` | fixed 2 ms timestep accumulator; calls `step()` then `onStep` (diag capture) and `onFrame` (motor/visual sync) |
| `coordinator/src/agentLoop.ts` | `parseAndValidateAction` — normalizes degrees→radians, supports `sequence` timelines and `gaze_target`→head override; forwards `activeGaitPhase` |
| `coordinator/src/payloadBuilder.ts` | `buildPerceptionSummary` — tells the LLM "move via joint angles; capsule translates when foot-to-ground contact produces forces" (the intended behavior that is currently disabled) |
| `diagnostic_poses_v2.js` | `Walk Cycle 1 Full Stride` — 4 frames @ 250 ms, amplitudes 25–30°, no root motion → demonstrates the failure mode |
| `model data/sequenced animation/simple walking.json` | Ground-truth captured walk: 30 fps, 32 frames, `Hips.pos` deltas + full 3-element quaternion joints — the correct alternative to teleport-based walking |
| `console_highlight_geoms.js` | `highlight_embed()` / `list()` — verify foot–floor contact visually and inspect geom contype/conaffinity |

## Suggested Reading Order

1. `src/world/engine/HumanoidPhysicsBinder.ts` → `applyKinematicGroundReactionForces` — the entire answer: the leg-driven mechanism, its two branches, the flag.
2. `src/world/hooks/useWorld.ts` → `handleRootMotion` — why the teleport alternative is dead (`BodyProxy.setTranslation` missing), and `handleAction`.
3. `src/world/engine/PhysicsEngine.ts` → `drainContactForceEventsInternal` — how the contact registry the injector reads is built.
4. `src/world/engine/MJCFHumanoidTemplate.ts` → foot geom + floor contype/conaffinity + actuator gains — the contact pair and servos governing whether GRF can fire.
5. `src/world/engine/MotorController.ts` → `applyCapsuleBalance` — why the balance controller resists walking lean and never contributes translation.
