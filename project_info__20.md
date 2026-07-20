# Synthia — Can the Model Push or Pick Up a Spawned Cube?

## Short Answer

- **Pushing: YES — physically possible today, with the current architecture, no code changes needed.** A spawned cube is a fully dynamic Rapier rigid body that collides with the ragdoll's bone colliders. When the model drives its arm/hand bones into the cube via PD torque control, real contact impulse is transmitted and the cube moves.
- **Picking up (grasping/lifting): NOT possible as a true grasp.** There is no grasp/attach/constraint mechanism, and the finger actuation is far too weak to generate the normal force + friction needed to lift even a 1 kg cube. The model can push, shove, roll, or knock the cube over, but cannot "grab and hold" it.

The limiting factor is **not** the physics world (which fully supports cube↔body collision) — it is the **strength and fidelity of the model's actuation** and the absence of any grasp primitive.

---

## Why Pushing Works (evidence from the code)

### 1. A spawned cube is a dynamic body that collides with the ragdoll
`src/world/engine/ObjectManager.ts` → `spawnObject()`:
- Cube preset (`src/constants/objectPresets.ts`): `{ id:'cube', mass:1, friction:0.5, restitution:0.2 }` → `mass > 0` so it gets `RAPIER.RigidBodyDesc.dynamic()`.
- Collider is a `cuboid(0.5,0.5,0.5)` and, critically, its collision mask is:
  `getCollisionMask(ENVIRONMENT_GROUP, RAGDOLL_GROUP | ENVIRONMENT_GROUP)` — i.e. it is in the **ENVIRONMENT_GROUP** and **collides with RAGDOLL_GROUP**.

### 2. The ragdoll's bones collide with the environment group
`src/world/engine/HumanoidMultiBodyManager.ts` → `activate()`:
- Each bone collider is created with `colDesc.setCollisionGroups(getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP))` — ragdoll bones collide with ENVIRONMENT_GROUP.
- Hands/forearms are real dynamic bodies with capsule colliders, real mass (`hand 0.4 kg`, `forearm 1.4 kg`, `arm 2.2 kg` in `src/constants/physics.ts`) and `CONTACT_FORCE_EVENTS` enabled.

→ Because **ragdoll ↔ environment collision is enabled both ways**, the hand can make physical contact with the cube and exchange momentum. Shoving the arm into the cube produces a real contact force that displaces it.

### 3. The model can drive the arm into the cube
- The model emits `joint_overrides` (bone target rotations). `HumanoidMultiBodyManager.setTargets()` converts these into PD **torques** on each bone rigid body (`bodyData.rigidBody.addTorque(...)`).
- Arm gains are substantial: `leftarm/rightarm stiffness 400`, `forearm 240`, `hand 160` (`BONE_PD_GAINS`). Shoulder/elbow spherical/revolute joints let the model swing the arm and push.
- So the model can reach out and shove the cube, and the physics engine resolves the collision — the cube slides/rolls.

### 4. The model can *feel* the contact (tactile feedback loop)
- Bone colliders have `ActiveEvents.CONTACT_FORCE_EVENTS`, and `coordinator/src/payloadBuilder.ts` → `buildTactileContext()` turns `contact_forces` into natural-language ("Your right hand is pressing against something with firm contact (8.3 N·s)").
- So the model gets proprioceptive confirmation that it is touching the cube and can adjust — this is what makes deliberate pushing (rather than accidental bumps) feasible.

---

## Why Picking Up Does NOT Work

1. **No grasp/attach primitive exists.** There is no fixed joint, weld, "parent to hand," or magnetic-grip mechanism anywhere in `ObjectManager`, `HumanoidMultiBodyManager`, or the motor controller. Grasping would have to emerge purely from contact friction between finger colliders and the cube.

2. **Finger actuation is deliberately microscopic.** In `BONE_PD_GAINS`, every finger phalanx and thumb segment is hardcoded to `{ stiffness: 5.0, damping: 1.0 }`, with micro-mass (0.008–0.02 kg) in the physics matrix. The comments explicitly say this is to keep "fine-motor PD updates from dragging the entire arm structure." Five-stiffness finger motors cannot clamp a 1 kg cube with enough normal force to lift it against gravity.

3. **Torque is clamped.** Per-bone torque is capped at `MAX_TORQUE = 15.0` (and capsule balance torque at 60). Even the arm cannot pin-and-hold a cube indefinitely; it can impart impulses, not sustain a stable grip.

4. **Grasping needs the cube resting on the palm + opposed thumb friction.** With a 0.5-unit cube and capsule finger colliders of radius 0.04, the contact geometry is too crude for a stable force-closure grasp, and friction (cube 0.5) plus weak fingers won't hold it.

---

## What the Model *Can* Do With a Cube Today
- Push / shove / slide it across the floor.
- Knock it over, roll it, nudge it with hands, arms, feet, or body.
- Feel that it made contact (via tactile context) and react.

## What It *Cannot* Do
- Grasp, lift, carry, or hold the cube.
- Precisely manipulate (stack, orient, place) — no fine motor force and no grasp constraint.

---

## What Would Be Required to Enable Picking Up
(For Act Mode — not done here.)
1. A **grasp primitive**: e.g. a RAPIER fixed/joint constraint created between the hand rigid body and the cube's rigid body when contact + a "grasp" intent is detected, destroyed on "release." This is the standard shortcut and avoids needing real finger force.
2. OR dramatically stronger finger/wrist gains + higher `MAX_TORQUE` + better finger collider geometry to achieve friction-based force closure (much harder to tune, risks the "jackhammer" instability the micro-mass design was built to avoid).
3. A way for the model to express **grasp intent** (a new `program_sequence` like `["grasp"]` / `["release"]`, or a dedicated action channel), since today only `joint_overrides` + locomotion programs are honored.

---

## Key Files
| File | Role in this question |
|------|------------------------|
| `src/world/engine/ObjectManager.ts` | Spawns cube as dynamic body; sets ENVIRONMENT_GROUP collision mask that lets it hit the ragdoll |
| `src/constants/objectPresets.ts` | Cube = mass 1, friction 0.5 (dynamic, pushable) |
| `src/world/engine/HumanoidMultiBodyManager.ts` | Builds bone colliders (RAGDOLL_GROUP) that collide with environment; applies PD torques; caps torque |
| `src/constants/physics.ts` | Bone masses/inertia; collision-group bitmask helpers |
| `src/world/engine/RapierJointMotorController.ts` | Revolute motor position control for elbows/knees |
| `coordinator/src/payloadBuilder.ts` | Turns contact forces into tactile text so the model can feel the cube |
