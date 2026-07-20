# SYNTHIA EXTRACTION REPORT (amica)

## ROLE
Senior Simulation Systems Architect Performing Forensic Code Extraction.

---

## Excluded — out of scope
- `.github/` & `.vscode/` (CI/CD workflows and local IDE workspace setups)
- `public/` & `scripts/` (static assets and automation utilities)
- `src-tauri/` (native desktop application wrapper configuration and Rust bindings)
- `src/i18n/` (localization dictionaries and translation configurations)
- `src/pages/` (Next.js client-side page routing and API handler endpoints)
- `src/components/` (React UI layout, menu overlay, and control panels)
- `src/hooks/` (general React lifecycle hooks for keyboard shortcuts, transcription, and background web workers)
- `src/features/chat/`, `src/features/functionCalling/`, `src/features/plugins/` (LLM connectors, tool call handlers, and social platform integrations)
- `src/features/vrmStore/` (IndexedDB caching layer and storage context providers for model files)
- `src/features/alert/`, `src/features/amicaLife/`, `src/features/externalAPI/` (background alert, schedule life loops, and system processors)
- `src/features/coquiLocal/`, `src/features/elevenlabs/`, `src/features/kokoro/`, `src/features/localXTTS/`, `src/features/openaiTTS/`, `src/features/openaiWhisper/`, `src/features/piper/`, `src/features/rvc/`, `src/features/speecht5/`, `src/features/whispercpp/` (Audio recording, text-to-speech generators, and local Whisper/Piper neural networks)

---

## DELIVERABLE 1: Repo Topology & Operational Blueprint

This section provides a file-by-file map of files in this repository that match the scope of joint definitions, asset parsing, procedural movement, and rigging adjustments.

### Geometry / Rigging Subsystem

#### 1. `src/features/vrmViewer/model.ts`
- **Primary operational function**: Manages loading, lifecycle, memory allocation, material config, expressions, and bone/animation updates of a single loaded 3D VRM humanoid avatar.
- **Critical runtime dependencies**: `@pixiv/three-vrm`, `three`, `./proceduralAnimation`, `./viewer`.
- **Ripple effect**: GLTF loaded -> parses VRM extensions -> extracts `vrm` object -> registers dynamic bone nodes -> enables per-frame rotation updates from mixers and procedural scripts -> rotates skeletal mesh bones on render.

#### 2. `src/lib/VRMAnimation/VRMAnimationLoaderPlugin.ts`
- **Primary operational function**: Intercepts standard glTF GLTFLoader parsing to resolve custom `VRMC_vrm_animation` extensions, transforming raw bones and rotations into canonical, retargeted coordinate spaces.
- **Critical runtime dependencies**: `three`, `@pixiv/three-vrm`.
- **Ripple effect**: Parses GLTF structure -> maps glTF nodes to VRM canonical bones -> extracts world matrices -> transforms animation tracks via parent/bone space change (invert/multiply) -> outputs retargeted `VRMAnimation` tracks.

#### 3. `src/lib/VRMAnimation/VRMAnimation.ts`
- **Primary operational function**: Repackages parsed keyframe tracks into a standard Three.js `AnimationClip` mapped specifically to the active VRM avatar’s bone structure.
- **Critical runtime dependencies**: `three`, `@pixiv/three-vrm`.
- **Ripple effect**: Maps track name to humanoid bone -> checks VRM specification version (0.x vs 1.0) -> flips translation/rotation sign/axes -> updates Three.js `KeyframeTrack` -> feeds tracks into active `AnimationMixer`.

#### 4. `src/lib/VRMAnimation/loadMixamoAnimation.ts`
- **Primary operational function**: Loads raw Mixamo FBX animations, retargets the rotation track coordinates to standard VRM bones using a rig mapping dictionary.
- **Critical runtime dependencies**: `three`, `@pixiv/three-vrm`, `FBXLoader`, `./mixamoVRMRigMap`.
- **Ripple effect**: Parses Mixamo tracks -> resolves corresponding VRM bone nodes -> computes relative rest pose matrices -> transforms coordinate systems via inverse/premultiply rotations -> binds tracks to humanoid bones.

---

### Joint / Constraint Subsystem

#### 5. `src/lib/VRMAnimation/mixamoVRMRigMap.ts`
- **Primary operational function**: Holds the static bone-name mapping dictionary that resolves Mixamo-specific skeletal node identifiers to canonical VRM humanoid bone names.
- **Critical runtime dependencies**: None.
- **Ripple effect**: Provides string keys -> translates source bone names -> assigns animation track bindings to the correct destination humanoid joint index.

#### 6. `src/features/proceduralAnimation/proceduralAnimation.ts`
- **Primary operational function**: Calculates dynamic sine-wave-based bone rotation offsets over elapsed time to simulate idle or auxiliary breathing/limb movements without static files.
- **Critical runtime dependencies**: `@pixiv/three-vrm`.
- **Ripple effect**: Ticks clock -> modifies `.rotation.x` and `.rotation.z` of normalized bones like `spine`, `neck`, and upper/lower limbs directly -> shifts bone coordinate frames -> updates skeletal mesh hierarchy.

---

### Physics Stepping Subsystem

#### 7. `src/features/vrmViewer/viewer.ts`
- **Primary operational function**: Sets up the WebGL/WebGPU Three.js environment, handles WebXR inputs/pinches, maintains the main requestAnimationFrame loop, and invokes per-frame model updates.
- **Critical runtime dependencies**: `three`, `./model`, `./room`, `OrbitControls`, `three-mesh-bvh`.
- **Ripple effect**: Receives system animation ticks -> calls `model.update(delta)` -> ticks animation mixers and procedural animation -> applies final local orientations to standard bones -> triggers Three.js renderer draw call.

---

## DELIVERABLE 2: Core Deep-Tech Mechanisms & Problem Solving

This section extracts the actual source code patterns that implement joint resolving, coordinate transforms, and dynamic animation in `amica`.

### 2.1 — Model Dynamicity & Asset Loading

`amica` implements dynamic asset loading by leveraging `@pixiv/three-vrm` on top of Three's `GLTFLoader`. It completely avoids hardcoding bone names or skeletal structures by utilizing the `VRMLoaderPlugin` which parses the glTF's extensions mapping table to map arbitrary joint indexes to standard humanoid joint names (`hips`, `spine`, `leftUpperArm`, etc.).

#### Snippet A — GLTFLoader Plugin Registration (`src/features/vrmViewer/model.ts`)
Shows how `three-vrm` hooks into Three's loading ecosystem to intercept models.
```typescript
    loader.register((parser) => {
      const options: any = {
        lookAtPlugin: new VRMLookAtSmootherLoaderPlugin(parser),
        mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, {
          materialType,
        }),
      };

      if (config("debug_gfx") === "true") {
        options.helperRoot = helperRoot;
      }

      return new VRMLoaderPlugin(parser, options);
    });
```

#### Snippet B — Dynamic Bone-Name Index Map Resolution (`src/lib/VRMAnimation/VRMAnimationLoaderPlugin.ts`)
Extracts the glTF node index and maps it to canonical bone names based on VRM specifications.
```typescript
  private _createNodeMap(
    defExtension: VRMCVRMAnimation
  ): VRMAnimationLoaderPluginNodeMap {
    const humanoidIndexToName: Map<number, VRMHumanBoneName> = new Map();
    const expressionsIndexToName: Map<number, string> = new Map();
    let lookAtIndex: number | null;

    // humanoid
    const humanBones = defExtension.humanoid?.humanBones;

    if (humanBones) {
      Object.entries(humanBones).forEach(([name, bone]) => {
        const { node } = bone;
        humanoidIndexToName.set(node, name as VRMHumanBoneName);
      });
    }
```

#### Snippet C — Bone World Matrix Map Capture (`src/lib/VRMAnimation/VRMAnimationLoaderPlugin.ts`)
Captures actual world transformations of loaded joints to map offsets dynamically at runtime.
```typescript
  private async _createBoneWorldMatrixMap(
    gltf: GLTF,
    defExtension: VRMCVRMAnimation
  ): Promise<VRMAnimationLoaderPluginWorldMatrixMap> {
    gltf.scene.updateWorldMatrix(false, true);

    const threeNodes = (await gltf.parser.getDependencies(
      "node"
    )) as THREE.Object3D[];

    const worldMatrixMap: VRMAnimationLoaderPluginWorldMatrixMap = new Map();

    for (const [boneName, { node }] of Object.entries(
      defExtension.humanoid.humanBones
    )) {
      const threeNode = threeNodes[node];
      worldMatrixMap.set(boneName as VRMHumanBoneName, threeNode.matrixWorld);

      if (boneName === "hips") {
        worldMatrixMap.set(
          "hipsParent",
          threeNode.parent?.matrixWorld ?? MAT4_IDENTITY
        );
      }
    }
```

#### Snippet D — Relative Joint Retargeting Transform (`src/lib/VRMAnimation/VRMAnimationLoaderPlugin.ts`)
Converts animation quaternions relative to the canonical rest-pose of the parent/bone transforms.
```typescript
        } else if (path === "rotation") {
          const worldMatrix = worldMatrixMap.get(boneName)!;
          const parentWorldMatrix = worldMatrixMap.get(parentBoneName)!;

          _quatA.setFromRotationMatrix(worldMatrix).normalize().invert();
          _quatB.setFromRotationMatrix(parentWorldMatrix).normalize();

          const trackValues = arrayChunk(origTrack.values, 4).flatMap((q) =>
            _quatC.fromArray(q).premultiply(_quatB).multiply(_quatA).toArray()
          );
```

#### Snippet E — VRM 0.x vs 1.0 Version Mapping & Coordinate Normalization (`src/lib/VRMAnimation/VRMAnimation.ts`)
Flips bone rotation track signs dynamically depending on whether the loaded model uses VRM 0.x.
```typescript
        const metaVersionZero = metaVersion === "0";
        let sign = metaVersionZero ? -1 : 1;
        let opposite = metaVersionZero ? 1 : 1;
        let prevQuaternion = new THREE.Quaternion();

        for (let i = 0; i < origTrack.values.length; i += 4) {
          const quaternion = new THREE.Quaternion(
            origTrack.values[i],
            origTrack.values[i + 1],
            origTrack.values[i + 2],
            origTrack.values[i + 3]
          );
          if (prevQuaternion.dot(quaternion) < 0 && metaVersionZero) {
            sign *= -1;
            opposite *= -1;
          }
          newValues.push(
            sign * origTrack.values[i],
            opposite * origTrack.values[i + 1],
            sign * origTrack.values[i + 2],
            opposite * origTrack.values[i + 3]
          );
```

#### Snippet F — VRM 0.x vs 1.0 Translation Axis & Scale Adaptation (`src/lib/VRMAnimation/VRMAnimation.ts`)
Scales translation track values to fit physical character bone length ratios and negates relative coordinate directions for VRM 0.x.
```typescript
    for (const [name, origTrack] of this.humanoidTracks.translation.entries()) {
      const nodeName = humanoid.getNormalizedBoneNode(name)?.name;

      if (nodeName != null) {
        const animationY = this.restHipsPosition.y;
        const humanoidY =
          humanoid.getNormalizedAbsolutePose().hips!.position![1];
        const scale = humanoidY / animationY;

        const track = origTrack.clone();
        track.values = track.values.map(
          (v, i) => (metaVersion === "0" && i % 3 !== 1 ? -v : v) * scale
        );
```

---

### 2.2 — Joint Calibration & PD Control Loops

#### Status: ABSENT
`amica` is a rendering-centric visual pipeline; there are no active physical forces, PD loops, rigid body torques, or joint torque clamping mechanisms in this codebase.

#### Contrast Analysis & Adjacent Mechanisms
Instead of a dynamic physics control system, the character's bone targets are achieved through direct, kinematic orientation overwriting in Three's hierarchical bone tree. To smooth out rotations and target adjustments without causing joint snapping, the project uses interpolation (lerps/slerps) inside custom loader plugins and auto-look-at solvers:

#### Snippet G — Slerped Head/Bone Rotational Smoothing (`src/lib/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmoother.ts`)
```typescript
        _eulerA.set(
          -this._pitchDamped * THREE.MathUtils.DEG2RAD,
          this._yawDamped * THREE.MathUtils.DEG2RAD,
          0.0,
          VRMLookAt.EULER_ORDER
        );
        _quatA.setFromEuler(_eulerA);

        const head = this.humanoid.getRawBoneNode("head")!;
        this._tempFirstPersonBoneQuat.copy(head.quaternion);
        head.quaternion.slerp(_quatA, 0.4);
        head.updateMatrixWorld();
```

---

### 2.3 — Observation Baking & State Vectors

#### Status: ABSENT
There is no reinforcement learning interface or state vector observation baking in `amica`.

#### Contrast Analysis
The state is maintained implicitly by Three.js's native hierarchical scene graph (`Object3D`). Coordinates and bone rotations are evaluated dynamically via `getWorldPosition()` or `getWorldQuaternion()` on demand rather than packed into a flat neural network observation buffer.

---

### 2.4 — AI/LLM Decoupling & Prompt/Protocol Engineering

#### Status: PARTIALLY INFERRED (Adjacent Animation Coupling)
The LLM integration inside `amica` does not stream fine-grained physical joint targets. Instead, the AI models output screenplays containing emotional state labels (e.g. `happy`, `sad`, `neutral`) or phonetic texts, which are subsequently resolved into high-level expressions or procedural facial animations.

#### Viseme & Mouth Movement Smoothing
To prevent packet delays, network jitter, or dropped connections from causing visible mouth jitter or freeze, the project decouples network retrieval from playback. Audio buffers are downloaded first, and mouth expressions are driven in real-time by checking Web Audio API buffer amplitude values.

#### Snippet H — Viseme/Mouth Volume Curve Smoothing (`src/features/lipSync/lipSync.ts`)
```typescript
    this.analyser.getFloatTimeDomainData(this.timeDomainData);

    let volume = 0.0;
    for (let i = 0; i < TIME_DOMAIN_DATA_LENGTH; i++) {
      volume = Math.max(volume, Math.abs(this.timeDomainData[i]));
    }

    // cook
    volume = 1 / (1 + Math.exp(-45 * volume + 5));
    if (volume < 0.1) volume = 0;
```

---

### 2.5 — Physics-to-Visual Synchronization

#### Status: ABSENT (Ammo.js simulation code is disabled/commented out)

#### Contrast Analysis
There is no physics simulation "truth" to copy onto visual bones. The bones are themselves the simulation "truth," animated kinematically by:
1. `clock.getDelta()` is evaluated.
2. Procedural breathing/limb oscillations are directly written onto bone rotation objects.
3. Custom look-at / blinking calculations are executed.
4. Three's `AnimationMixer` resolves active keyframe track curves and writes quaternions onto bone properties.
5. `vrm.update()` updates passive springs (VRM spring bone system) and updates world transform matrices.
6. The renderer renders the results.

---

## DELIVERABLE 3: Synthia Translation Blueprint (Three.js + Rapier)

This blueprint details how to port `amica`'s dynamic asset parsing and bone mapping to a dynamic physical skeleton utilizing `@dimforge/rapier3d-compat` and Three.js.

### 3.1 — Architectural Mockup (TypeScript)

This TS architecture demonstrates how Synthia can dynamically map an arbitrary loaded GLTF/VRM mesh to a Rapier physical humanoid ragdoll with active motor joints, solving the bone-mapping and hardcoding bottlenecks.

```typescript
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export interface IBoneMapping {
  vrmBoneName: string;       // e.g., 'leftUpperArm'
  threeBoneName: string;     // Resolved three.js object name
  parentBoneName?: string;   // For hierarchical matrix transformations
}

export class SynthiaRigidBodyBridge {
  private vrmModel: THREE.Object3D;
  private physicsWorld: RAPIER.World;
  private boneMap: Map<string, THREE.Bone> = new Map();
  private physicsJoints: Map<string, RAPIER.ImpulseJoint> = new Map();
  private rigidBodies: Map<string, RAPIER.RigidBody> = new Map();

  constructor(vrmModel: THREE.Object3D, world: RAPIER.World) {
    this.vrmModel = vrmModel;
    this.physicsWorld = world;
  }

  /**
   * 1. Dynamic Bone Resolution (Ported from amica's VRMHumanoid resolver)
   */
  public resolveSkeletalBones(mappings: IBoneMapping[]): void {
    mappings.forEach((mapping) => {
      let resolvedBone: THREE.Bone | null = null;
      this.vrmModel.traverse((node) => {
        if (node instanceof THREE.Bone && node.name === mapping.threeBoneName) {
          resolvedBone = node;
        }
      });
      if (resolvedBone) {
        this.boneMap.set(mapping.vrmBoneName, resolvedBone);
      }
    });
  }

  /**
   * 2. Dynamic Physics Ragdoll Creation (Maps VRM Skeleton to Rapier Bodies/Joints)
   */
  public createPhysicalRagdoll(): void {
    this.boneMap.forEach((bone, canonicalName) => {
      // Create Rigid Body
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      bone.getWorldPosition(worldPos);
      bone.getWorldQuaternion(worldQuat);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w });

      const body = this.physicsWorld.createRigidBody(bodyDesc);
      
      // Add Collider (capsule matching bone length)
      const colliderDesc = RAPIER.ColliderDesc.capsule(0.05, 0.1);
      this.physicsWorld.createCollider(colliderDesc, body);

      this.rigidBodies.set(canonicalName, body);
    });

    // Create Spherical/Revolute ImpulseJoints connecting parent-child rigid bodies
    // Utilizes RevoluteImpulseJoint or SphericalImpulseJoint for PD motor simulation
  }

  /**
   * 3. Joint PD Motor Control (Directly fixes Synthia's snap-bug by utilizing motors instead of direct coordinates overrides)
   */
  public applyPDTargetJointAngles(canonicalName: string, targetLocalRotation: THREE.Quaternion): void {
    const joint = this.physicsJoints.get(canonicalName);
    if (!joint) return;

    // Convert local target rotation to target angle/axis for motors
    // Avoids "violently overwriting raw angles" by driving via torque motors
    if (joint.isSphericalJoint()) {
      const spherical = joint as RAPIER.SphericalImpulseJoint;
      // Configure spherical motor targets
    } else if (joint.isRevoluteJoint()) {
      const revolute = joint as RAPIER.RevoluteImpulseJoint;
      revolute.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      revolute.configureMotor(targetLocalRotation.x, 0.0, 10.0, 1.0); // Kp, Kd
    }
  }

  /**
   * 4. Physics-to-Visual Synchronizer
   */
  public synchronizeVisuals(): void {
    this.boneMap.forEach((bone, canonicalName) => {
      const body = this.rigidBodies.get(canonicalName);
      if (!body) return;

      const translation = body.translation();
      const rotation = body.rotation();

      // Copy physics truth to bone visual puppet
      bone.position.set(translation.x, translation.y, translation.z);
      bone.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    });
  }
}
```

---

### 3.2 — Explicit Concept Mapping

The following table demonstrates how concepts extracted from `amica` map directly to the Rapier.js API:

| `amica` (Python / Three-VRM concept) | `@dimforge/rapier3d-compat` API Method / Class | Mapping & Porting Notes |
| :--- | :--- | :--- |
| **VRMHumanoid / HumanBones** | `RAPIER.RigidBody` & `RAPIER.Collider` | Iterate through resolved `vrm.humanoid` bone objects; create dynamic bodies at the bone's world coordinates. |
| **Direct Bone Euler overwriting** | `RAPIER.RevoluteImpulseJoint` / `SphericalImpulseJoint` | **DO NOT overwrite raw bone rotations.** Wrap bone linkages in Rapier constraints and configure motors. |
| **Mixer Target Interpolation** | `revoluteJoint.configureMotor(target, targetVel, Kp, Kd)` | Feeds interpolation target values into the dynamic Rapier motor controller rather than raw visual offsets. |
| **Spring Bones** | `RAPIER.PrismaticImpulseJoint` with springs | Passive visual hair/cloth dynamics can be modeled with custom spring joints or left in Three-VRM thread if non-colliding. |
| **Skeleton Bounds Tree (BVH)** | `RAPIER.ColliderDesc.trimesh` | If collision boundary matching is necessary, standard mesh geometry can be passed directly as a Trimesh collider. |

---

### 3.3 — Frame Loop Slots (`requestAnimationFrame`)

The synchronization and simulation updates must occur in distinct, sequential steps inside the main `requestAnimationFrame` render loop:

```
+-------------------------------------------------------------+
|               requestAnimationFrame Loop                    |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| 1. FIXED PHYSICS SUBSTEP (Accumulated dt)                   |
|    - Retrieve network targets / local gameplay inputs        |
|    - Update PD Motor targets: revoluteJoint.configureMotor()|
|    - Step Physics simulation: world.step()                  |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| 2. RENDER INTERPOLATION STEP (Transform copy)              |
|    - Copy rigid body transforms to visual skeleton bones    |
|    - Apply scale & capsule-to-mesh origin offsets           |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| 3. THREE.JS DRAW CALL                                       |
|    - renderer.render(scene, camera)                         |
+-------------------------------------------------------------+
```

1. **Fixed Physics Substep (Accumulator-based)**:
   - *Logic*: Retrieve target joint angles, apply them as motor setpoints on Rapier joints (`configureMotor()`), and advance physics `world.step()`.
   - *Reason*: Avoids kinematic snapping. It ensures constraints, joint range limits, and collisions are resolved realistically.
2. **Render Interpolation Step (Visual Transform Copy)**:
   - *Logic*: Extract the body's coordinates (`body.translation()`, `body.rotation()`) and copy them onto the Three.js `Bone` transforms. Apply necessary capsule-to-mesh space offsets.
   - *Reason*: Aligns the visual puppet with the physical simulation truth before painting the frame.

---

### 3.4 — Gaps and Non-Equivalent Features

1. **Dynamic Rest Pose & Skeleton Bone-Name Extraction**:
   - *Problem*: Rapier has no concept of glTF/VRM hierarchies, bone-name mappings, or rest-poses. It is purely a raw linear algebra/geometry solver.
   - *Mitigation*: Synthia must maintain a dedicated Three.js bone-to-rigid-body registry (like `SynthiaRigidBodyBridge` in 3.1) and implement a custom parser to map joint indices to Rapier colliders on mesh initialization.
2. **Coordinate Specification Version Adaptation**:
   - *Problem*: Rapier operates entirely in global coordinate systems. VRM files contain bone local transforms with specification-dependent directions (e.g. VRM 0.x vs 1.x flip signs).
   - *Mitigation*: The translation bridge must normalize bone quaternions first using local-to-world transform conversions before mapping them to the Rapier joints, mimicking `VRMAnimationLoaderPlugin`'s matrix transformations.

---

## Confidence & Gaps

- **2.1 — Model Dynamicity & Asset Loading**: **HIGH CONFIDENCE**. Found clear, powerful implementations mapping arbitrary bones and indices dynamically to canonical joint schema under `VRMAnimationLoaderPlugin.ts` and `VRMAnimation.ts`, as well as version translation matrices.
- **2.2 — Joint Calibration & PD Control Loops**: **ABSENT** in source. Replaced with kinematic bone-overwriting and look-at/blinking slerp interpolations. Excellent contrast case for Synthia.
- **2.3 — Observation Baking & State Vectors**: **ABSENT** in source. Explicitly noted.
- **2.4 — AI/LLM Decoupling & Prompt/Protocol Engineering**: **ABSENT** for physics; high-level screenplay emotive coupling exists alongside client-side mouth amplitude lipsync smoothing.
- **2.5 — Physics-to-Visual Synchronization**: **ABSENT** in source. Visual bones act directly as simulation truth.
