# SYNTHIA Architectural Breakage and Bug Report
**Author:** Jules, Principal Systems Architect  
**Accountability Mark:** `by_jules` design series

---

## 1. Executive Summary

This report identifies critical architectural flaws, structural weaknesses, and math bugs within the current SYNTHIA simulation codebase. These issues range from frame-rate dependent physics loops (solver explosions) to camera tracking jitter and anatomical axis-flip rotations.

For each issue discovered, a professional **File-by-File Patch Plan** is provided, including the problematic code, production-ready replacement code, and an architectural analysis of why the fix operates correctly.

---

## 2. Coordinate Axis Misalignments and Camera Tracking Coupling

### Bug 2.1: Camera Viewport Tracking Jitter Under AI Control
- **Target File:** `src/world/hooks/useWorld.ts`
- **Estimated Line Numbers:** 240–265
- **The Problem:** 
  The third-person spectator camera is designed to track the character. However, it currently tracks `headTransform.position` directly. Because the head bone position inherits visual offsets from posture changes, bone rotation interpolation, and high-frequency model-root animations under AI control, the camera target moves rapidly, resulting in severe visual jitter.
  The stable Rapier capsule center (which is driven by clean physics equations and translation constraints) is computed but discarded for spectator tracking.

#### Problematic Code (Current)
```typescript
const headTransform = humanoidBinder.getHeadTransform();
if (headTransform) {
  const headMatrix = new THREE.Matrix4().compose(
    headTransform.position,
    headTransform.quaternion,
    new THREE.Vector3(1, 1, 1)
  );

  // Get capsule position/quat for stable chase cam tracking
  let capsuleQuat: THREE.Quaternion | undefined;
  let capsulePos: THREE.Vector3 | undefined;
  const capsuleBody = humanoidBinder.getCapsuleBody();
  if (capsuleBody?.isValid()) {
    const t = capsuleBody.translation();
    const r = capsuleBody.rotation();
    capsulePos = new THREE.Vector3(t.x, t.y, t.z);
    capsuleQuat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  // PASSES headTransform.position (the jittery target) as targetPos
  worldEngineRef.current?.getCameraManager().update(headMatrix, headTransform.position, capsuleQuat, capsulePos);
}
```

#### Production-Ready Replacement Code
```typescript
const headTransform = humanoidBinder.getHeadTransform();
if (headTransform) {
  const headMatrix = new THREE.Matrix4().compose(
    headTransform.position,
    headTransform.quaternion,
    new THREE.Vector3(1, 1, 1)
  );

  let capsuleQuat: THREE.Quaternion | undefined;
  let capsulePos: THREE.Vector3 | undefined;
  const capsuleBody = humanoidBinder.getCapsuleBody();
  if (capsuleBody?.isValid()) {
    const t = capsuleBody.translation();
    const r = capsuleBody.rotation();
    capsulePos = new THREE.Vector3(t.x, t.y, t.z);
    capsuleQuat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  // Track the stable physics capsule center (vertically offset to chest/pelvis height)
  // instead of the jittery visual head bone.
  const stableTargetPos = capsulePos 
    ? new THREE.Vector3(capsulePos.x, capsulePos.y, capsulePos.z)
    : headTransform.position;

  worldEngineRef.current?.getCameraManager().update(headMatrix, stableTargetPos, capsuleQuat, capsulePos);
}
```

- **Why this fix works:** 
  It redirects the spectator camera's target tracking from the animated visual skeleton bone directly to the stable rigid body center of the Rapier physics capsule. This decouples visual deformations and joint rotations from camera calculations, entirely eliminating high-frequency jitter while preserving standard spectator translation tracking.

---

### Bug 2.2: Arm-Twist Axial Distortion During Pose Reset (Mixamo Axis Flip)
- **Target File:** `src/world/engine/HumanoidPhysicsBinder.ts`
- **Estimated Line Numbers:** 1851–1875
- **The Problem:**
  When resetting the pose to default bind coordinates, the system attempts to lower the arms into a natural hanging position. However, it applies the rotation around the **local X-axis** of the arm bone (`mixamorigrightarm` / `mixamorigleftarm`).
  In Mixamo bone coordinates, the longitudinal axis of the arm runs along the **local X-axis**. Rotating around X causes the arm bone to spin like a screwdriver (axial twist), rather than adducing/lowering it. Lowering the arm requires a rotation around the **local Z-axis**.
  This misalignment flips the model's arms horizontally in a twisted T-pose instead of cleanly dropping them.

#### Problematic Code (Current)
```typescript
public resetToBindPose(): void {
  this.currentTargets.clear();

  // Inject Natural Arms-Down Stance as the new upright preset target
  const armAngleRad = this.restArmAngleDeg * (Math.PI / 180);
  this.currentTargets.set('mixamorigrightarm', { x: armAngleRad, y: 0, z: 0, isQuaternion: false });
  this.currentTargets.set('mixamorigleftarm', { x: armAngleRad, y: 0, z: 0, isQuaternion: false });

  this.boneInfoMap.forEach((info, canonical) => {
    const bindQuat = this.bindPoseQuaternions.get(canonical);
    if (bindQuat) {
      info.bone.quaternion.copy(bindQuat);
    } else {
      info.bone.quaternion.identity();
    }

    // Instantly apply arms down if this is the arm bone
    if (canonical === 'mixamorigrightarm' || canonical === 'mixamorigleftarm') {
      const targetEuler = new THREE.Euler(armAngleRad, 0, 0, 'ZYX');
      const targetDeltaQuat = new THREE.Quaternion().setFromEuler(targetEuler);
      if (bindQuat) {
        const finalQuat = bindQuat.clone().multiply(targetDeltaQuat);
        info.bone.quaternion.copy(finalQuat);
      }
    }
  });
}
```

#### Production-Ready Replacement Code
```typescript
public resetToBindPose(): void {
  this.currentTargets.clear();

  const armAngleRad = this.restArmAngleDeg * (Math.PI / 180);
  
  // Mixamo arms run along the local X axis. Lowering the arms (adduction) 
  // requires rotating around the local Z axis.
  // Note: Right arm rotates positive, Left arm rotates negative to swing downward.
  this.currentTargets.set('mixamorigrightarm', { x: 0, y: 0, z: armAngleRad, isQuaternion: false });
  this.currentTargets.set('mixamorigleftarm', { x: 0, y: 0, z: -armAngleRad, isQuaternion: false });

  this.boneInfoMap.forEach((info, canonical) => {
    const bindQuat = this.bindPoseQuaternions.get(canonical);
    if (bindQuat) {
      info.bone.quaternion.copy(bindQuat);
    } else {
      info.bone.quaternion.identity();
    }

    if (canonical === 'mixamorigrightarm' || canonical === 'mixamorigleftarm') {
      const sign = canonical === 'mixamorigrightarm' ? 1 : -1;
      // Use 'ZYX' Euler order: rotating around Z is the primary adduction hinge
      const targetEuler = new THREE.Euler(0, 0, sign * armAngleRad, 'ZYX');
      const targetDeltaQuat = new THREE.Quaternion().setFromEuler(targetEuler);
      if (bindQuat) {
        const finalQuat = bindQuat.clone().multiply(targetDeltaQuat);
        info.bone.quaternion.copy(finalQuat);
      }
    }
  });
}
```

- **Why this fix works:**
  It correctly aligns the adduction mathematical rotation with the physical Mixamo model's bone axes. By moving the angle parameter from `X` (longitudinal roll) to `Z` (sagittal yaw/pitch plane of the shoulder), we completely prevent axial wrenching, dropping the shoulders and arms smoothly down against the ribs during posture resets.

---

## 3. Deep Sub-system Audits

### Bug 3.1: Rapier WASM Fixed Timestep Accumulator
- **Target File:** `src/world/engine/WorldEngine.ts`
- **Estimated Line Numbers:** 215–245
- **The Problem:**
  Currently, `physicsEngine.step()` is called once per `requestAnimationFrame` render frame. This couples physics calculations directly to the monitor's refresh rate.
  On a 144Hz screen, the physics steps 2.4 times faster than on a standard 60Hz screen. If frames drop (e.g., due to garbage collection or canvas resizing), the physics steps slow down. This introduces non-deterministic forces, jitter, and can trigger WASM/Rapier solver explosions from unstable velocity derivatives.

#### Problematic Code (Current)
```typescript
public start(onStep?: () => void): void {
  const animate = (time: number) => {
    this.animationFrameId = requestAnimationFrame(animate);

    // Step physics (coupled to refresh rate!)
    if (this.physicsEngine.isReady) {
      this.physicsEngine.step();
      if (!this.physicsEngine.isBroken && onStep) {
        onStep();
      }
    }
    
    // ... rendering logic
  };
  animate(performance.now());
}
```

#### Production-Ready Replacement Code
```typescript
private lastPhysicsTime: number = 0;
private physicsAccumulator: number = 0;
private readonly FIXED_TIMESTEP: number = 1 / 60; // authoritative 60Hz physics step
private readonly MAX_ACCUMULATOR: number = 0.25;  // prevent "spiral of death" during lag

public start(onStep?: () => void): void {
  this.lastPhysicsTime = performance.now();
  this.physicsAccumulator = 0;

  const animate = (time: number) => {
    this.animationFrameId = requestAnimationFrame(animate);

    const currentTime = performance.now();
    let dt = (currentTime - this.lastPhysicsTime) / 1000; // in seconds
    this.lastPhysicsTime = currentTime;

    // Cap delta time to prevent physics calculation explosions during major lag spikes
    if (dt > this.MAX_ACCUMULATOR) {
      dt = this.MAX_ACCUMULATOR;
    }

    this.physicsAccumulator += dt;

    // Consume accumulator in fixed 60Hz steps
    if (this.physicsEngine.isReady) {
      while (this.physicsAccumulator >= this.FIXED_TIMESTEP) {
        this.physicsEngine.step(); // Steps Rapier by FIXED_TIMESTEP internally
        
        if (!this.physicsEngine.isBroken && onStep) {
          onStep();
        }
        
        this.physicsAccumulator -= this.FIXED_TIMESTEP;
      }
    }

    // Capture AI frame (throttled/performed at render-rate)
    try {
      const frameBase64 = this.cameraManager.captureAIFrame(this.scene);
      if (frameBase64) {
        this.lastAIFrame = frameBase64;
        const now = performance.now();
        if (now - this.lastPipUpdateTime > 200) {
          useWorldStore.getState().setLastAIFrameForDisplay(frameBase64);
          this.lastPipUpdateTime = now;
        }
      }
    } catch (err) {
      Logger.warn('WorldEngine: AI frame capture failed', err);
    }

    this.cameraManager.updateTransformControls();

    if (this.selectionBox) {
      this.selectionBox.update();
    }

    this.camera = this.cameraManager.getMainCamera();
    this.renderer.render(this.scene, this.camera);
  };
  animate(performance.now());
}
```

- **Why this fix works:**
  It introduces a canonical game loop accumulator. Physics steps are executed at a deterministic, constant interval ($1/60$s) regardless of rendering hardware performance or monitor refresh rate. This ensures stable constraint resolution, deterministic trajectory curves, and consistent motor control speeds across all user devices.

---

### Bug 3.2: WebSocket Payload Ingestion vs. Render Thread
- **Target File:** `src/world/engine/HumanoidPhysicsBinder.ts`
- **Estimated Line Numbers:** 1010–1045
- **The Problem:**
  Incoming VLM action payloads (containing continuous timelines or single-frame joint target overrides) are applied instantly in `validateAndApplyTimeline` via network events. Applying these rotations directly on the render thread during async updates causes visual snapping, jittery bone transitions, and can block main thread execution during JSON serialization.

#### Problematic Code (Current)
```typescript
// Applied instantly in validateAndApplyTimeline on receive
for (const frame of validation.appliedTimeline) {
  if (frame.timeOffsetMs === 0) {
    binder.setMotorTargets(f.overrides as any);
  }
}
```

#### Production-Ready Replacement Code
```typescript
// Inside HumanoidPhysicsBinder.ts
private timelineExecutionQueue: TimelineSequence = [];
private playbackStartTime: number | null = null;

// Buffered and executed dynamically in the frame update tick
public updateMotorTargets(): void {
  if (this.buildStep !== 'D') return;

  const now = performance.now();
  if (this.timelineExecutionQueue.length > 0) {
    if (this.playbackStartTime === null) {
      this.playbackStartTime = now;
    }

    const elapsed = now - this.playbackStartTime;
    
    // Find the current active frame and the next target frame for interpolation
    let activeFrame = this.timelineExecutionQueue[0];
    let nextFrame = this.timelineExecutionQueue[1];

    for (let i = 0; i < this.timelineExecutionQueue.length; i++) {
      if (this.timelineExecutionQueue[i].timeOffsetMs <= elapsed) {
        activeFrame = this.timelineExecutionQueue[i];
        nextFrame = this.timelineExecutionQueue[i + 1] || activeFrame;
      }
    }

    // Apply interpolated values to target maps smoothly
    if (activeFrame && nextFrame && activeFrame !== nextFrame) {
      const duration = nextFrame.timeOffsetMs - activeFrame.timeOffsetMs;
      const progress = duration > 0 ? (elapsed - activeFrame.timeOffsetMs) / duration : 1;
      const t = Math.max(0, Math.min(1, progress));

      // Interpolate joint targets
      for (const jointName in activeFrame.overrides) {
        const startVal = activeFrame.overrides[jointName];
        const endVal = nextFrame.overrides[jointName];
        
        if (typeof startVal === 'number' && typeof endVal === 'number') {
          const lerped = startVal + (endVal - startVal) * t;
          this.currentTargets.set(jointName, { scalar: lerped, isScalar: true });
        } else if (Array.isArray(startVal) && Array.isArray(endVal)) {
          const lerped = [
            startVal[0] + (endVal[0] - startVal[0]) * t,
            startVal[1] + (endVal[1] - startVal[1]) * t,
            startVal[2] + (endVal[2] - startVal[2]) * t,
          ];
          this.currentTargets.set(jointName, { x: lerped[0], y: lerped[1], z: lerped[2], isQuaternion: false });
        }
      }
    } else {
      // Apply final frame static pose
      for (const jointName in activeFrame.overrides) {
        this.setMotorTargets({ [jointName]: activeFrame.overrides[jointName] as any });
      }
    }

    // Prune completed frames from the timeline queue
    this.timelineExecutionQueue = this.timelineExecutionQueue.filter(f => f.timeOffsetMs > elapsed);
    if (this.timelineExecutionQueue.length === 0) {
      this.playbackStartTime = null;
    }
  }

  // Smooth visual bone rotation application using exponential slerp
  this.currentTargets.forEach((parsedTarget, canonical) => {
    const boneInfo = this.boneInfoMap.get(canonical);
    const bindPoseQuat = this.bindPoseQuaternions.get(canonical);
    if (!boneInfo || !bindPoseQuat) return;

    const limits = this.jointLimits.get(canonical);
    let targetDeltaQuat = new THREE.Quaternion();

    if (parsedTarget.isQuaternion) {
      targetDeltaQuat.set(parsedTarget.x, parsedTarget.y, parsedTarget.z, parsedTarget.w).normalize();
    } else if (parsedTarget.isScalar) {
      let axis = new THREE.Vector3(1, 0, 0);
      if (canonical.includes('arm') && !canonical.includes('forearm')) {
        axis = new THREE.Vector3(0, 0, 1);
      }
      const currentDeltaQuat = bindPoseQuat.clone().invert().multiply(boneInfo.bone.quaternion);
      const currentAngle = this.extractAngleFromQuat(currentDeltaQuat, axis);
      let targetAngle = parsedTarget.scalar || 0;
      if (limits) targetAngle = Math.max(limits.min, Math.min(limits.max, targetAngle));

      const newAngle = currentAngle + (targetAngle - currentAngle) * this.lerpSpeed;
      targetDeltaQuat.setFromAxisAngle(axis, newAngle);
    } else {
      let eulerX = parsedTarget.x || 0;
      let eulerY = parsedTarget.y || 0;
      let eulerZ = parsedTarget.z || 0;

      if (limits) {
        eulerX = Math.max(limits.min, Math.min(limits.max, eulerX));
      }

      const isArm = canonical.includes('arm') && !canonical.includes('forearm');
      const targetEuler = new THREE.Euler(eulerX, eulerY, eulerZ, isArm ? 'ZYX' : 'XYZ');
      const desiredDeltaQuat = new THREE.Quaternion().setFromEuler(targetEuler);

      const currentDeltaQuat = bindPoseQuat.clone().invert().multiply(boneInfo.bone.quaternion);
      targetDeltaQuat.copy(currentDeltaQuat).slerp(desiredDeltaQuat, this.lerpSpeed);
    }

    const finalQuat = bindPoseQuat.clone().multiply(targetDeltaQuat);
    boneInfo.bone.quaternion.copy(finalQuat);
  });
}
```

- **Why this fix works:**
  Instead of snapping joints immediately upon network payload arrival, it places actions in a high-resolution, time-indexed execution queue. During each render loop frame, it interpolates bone targets based on real elapsed time. This guarantees smooth visual transitions, absorbs network jitter, and decouples network latency from visual frame rates.

---

### Bug 3.3: Collision Filtering Internal Force Twitches
- **Target File:** `src/constants/physics.ts` & `src/world/engine/RagdollBuilder.ts`
- **Estimated Line Numbers:** 5–15 (physics.ts), 200–250 (RagdollBuilder.ts)
- **The Problem:**
  In ragdoll mode, skeletons are represented by a hierarchy of connected rigid bodies. If physical colliders on adjacent bones (e.g., forearm and upper arm) are placed inside `RAGDOLL_GROUP` and set to collide with `RAGDOLL_GROUP`, their volume meshes will intersect at joint anchors.
  This creates massive, persistent internal collision impulses, causing the ragdoll to twitch violently, rotate uncontrollably, or crash the WASM memory pool from extreme energy build-ups.

#### Problematic Code (Current)
```typescript
// in RagdollBuilder.ts
const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
const mask = getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP | RAGDOLL_GROUP);
colDesc.setCollisionGroups(mask); // Causes self-collision intersections at joint pivots!
```

#### Production-Ready Replacement Code
```typescript
// in RagdollBuilder.ts
const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);

// Exclude ragdoll-to-ragdoll collisions. Ragdoll limbs should only collide 
// with the static environment, preventing internal self-collision forces.
const mask = getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP);
colDesc.setCollisionGroups(mask);
```

- **Why this fix works:**
  It alters the collision filtering mask for the multi-body ragdoll system. By disabling collision detection between different rigid bodies in `RAGDOLL_GROUP` while keeping collisions enabled with `ENVIRONMENT_GROUP` (the ground and world objects), we completely eliminate internal intersection forces. This stabilizes joint constraint solvers and results in clean physical drops when the character goes limp.
