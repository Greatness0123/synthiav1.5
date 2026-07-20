# Phase 2 Physics Stabilization Documentation

## Ragdoll Architecture Refactor

The ragdoll system has been refactored from a joint-based rigid body model to a **bone-based rigid body model**.

### 1. Bone-Based Rigid Bodies
Previously, rigid bodies were created at each joint position with zero volume. This caused unstable oscillations.
Now, each rigid body represents a bone segment. The body is centered at the midpoint between its parent joint and its own joint position.
- **Geometry**: `CapsuleGeometry` and `RAPIER.ColliderDesc.capsule` are used, oriented along the bone direction.
- **Anchors**: `anchor1` and `anchor2` are calculated as local offsets from the bone centers to the shared joint position.

### 2. Collision Filtering
To prevent self-interference, we implemented a 32-bit collision group system:
- `RAGDOLL_GROUP = 0x0001`
- `ENVIRONMENT_GROUP = 0x0002`
Ragdoll parts belong to `RAGDOLL_GROUP` and are filtered to ONLY collide with `ENVIRONMENT_GROUP`. This eliminates jitter caused by overlapping bone colliders.

### 3. Native Joint Motors
Manual impulse application has been replaced with Rapier's native joint motors:
- **SphericalJoints**: Use `configureMotorPosition` with quaternions for 3-DOF joints.
- **RevoluteJoints**: Use `configureMotorPosition` for 1-DOF joints.
- **Stiffness (Kp)** and **Damping (Kd)** are sourced from the joint configuration (defaulting to 150/12).

### 4. Stabilized Body Types
Proportions and hierarchies have been fully defined in `bodyTypes.ts`:
- **Humanoid**: Standard humanoid proportions with a complete 80-joint (or 15-joint simplified) hierarchy.
- **Quadruped**: Dog-like proportions (approx. 0.4m spine, 0.2m leg segments).
- **Robotic Arm**: 6-DOF articulated arm with 0.3m main segments.

## Verification
- **Rigid Mode**: Skeleton holds its `upright_preset` position using motors, standing stable under gravity.
- **Ragdoll Mode**: Motors are disabled (kp=0), allowing the skeleton to collapse naturally.
- **No Explosion**: The 80-joint skeleton remains connected without exponential stretching or violent oscillation.
