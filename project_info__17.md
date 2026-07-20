# Bones vs. Joints: Where the Weight Lives

## Short Answer

**The bones carry the weight (mass).** The joints carry **no mass at all** — they are massless constraints that connect the bone rigid bodies together.

## How It Works in This Codebase

The system uses a **multi-body ragdoll** architecture where each tracked bone gets its own physics rigid body with mass, and joints exist purely as mathematical linkages between those bodies.

### Mass lives on bones

In `src/constants/physics.ts`, the entire weight budget of the humanoid (~75 kg total) is distributed **per bone** in `COMPLETE_MIXAMO_PHYSICS_MATRIX`:

| Bone | Mass (kg) |
|------|-----------|
| Hips | 12.0 |
| Spine chain (4 segments) | 15.0 |
| Head | 4.3 |
| Each thigh (`upleg`) | 8.5 |
| Each upper arm | 2.2 |
| Each finger segment | 0.008–0.02 |

Each entry also has a **principal inertia tensor** (`Ixx, Iyy, Izz`) that describes how that bone resists rotation around its own axes.

In `HumanoidMultiBodyManager.ts` (line ~222), when each bone body is created, the mass is explicitly injected via Rapier:

```ts
rbDesc.setAdditionalMassProperties(
  phys.mass,                          // ← mass on the BONE body
  { x: 0, y: 0, z: 0 },               // center of mass (at bone origin)
  { x: phys.principalInertia.x, ... },// inertia tensor
  ...
);
```

The collider is deliberately given **zero density** (`colDesc.setDensity(0)`) so that mass comes *only* from the explicit per-bone matrix, not from collider shape. This means the capsule/sphere colliders are massless shells — all mass is assigned analytically per bone.

### Joints are massless constraints

Joints (`RAPIER.ImpulseJoint` — either `revolute` for hinge-like knees/elbows or `spherical` for ball-socket shoulders/hips) are created via `RAPIER.JointData.revolute(...)` / `JointData.spherical(...)` with just two anchor points and axis/limits. They contain **no mass property** — Rapier treats them as pure kinematic constraints between two rigid bodies.

The `BONE_PD_GAINS` table in `HumanoidMultiBodyManager.ts` assigns *stiffness/damping* per joint (for PD motor control), but these are **control gains**, not physical weight. They determine how strongly the joint motor pulls the child bone toward its target angle, not how heavy anything is.

### Anatomical rationale (documented in `physics.ts`)

The per-bone mass distribution follows a deliberate design:
- **Proximal-to-distal stepping**: each segment is 50–60% the mass of its parent (e.g., forearm 1.4 kg < upper arm 2.2 kg). This prevents "jackhammer" feedback where a light distal segment's PD controller overtorques its parent.
- **Iyy ≈ Ixx/3** for long bones — reflecting that real bones twist easily along their long axis but resist transverse bending.
- **Finger micro-mass** (0.008–0.02 kg) so fine motor control doesn't destabilize the arm.
- **Heavy thigh inertia** (0.15 kg·m²) to damp root sway on the capsule.

## Note on `RagdollBuilder.ts`

The older `RagdollBuilder` class also creates rigid bodies per *joint config* (using names like "left_shoulder", "left_elbow") — but those "joints" in its vocabulary are actually **body segments** (spheres at each anatomical landmark), and the mass comes implicitly from the collider density there. That system appears to be a legacy/simplified path; the active `HumanoidMultiBodyManager` system uses the explicit per-bone mass matrix.

## Bottom Line

- **Weight/mass** → assigned to **bones** (one rigid body per tracked bone, mass from `COMPLETE_MIXAMO_PHYSICS_MATRIX`)
- **Joints** → massless Rapier constraints (revolute/spherical) with PD motor gains for control
- **Colliders** → density explicitly set to 0 so they contribute no additional mass