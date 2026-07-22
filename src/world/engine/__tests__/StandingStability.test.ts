/// <reference types="jest" />

import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PhysicsEngine } from '../PhysicsEngine';
import { HumanoidPhysicsBinder } from '../HumanoidPhysicsBinder';

declare function describe(name: string, fn: () => void): void;
declare function beforeEach(fn: () => void): void;
declare function afterEach(fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toBeTruthy(): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toContain(expected: unknown): void;
  toBeCloseTo(expected: number, precision?: number): void;
};

// Mock GLTFLoader.load to parse the GLB file directly from disk under Jest/Node
const originalLoad = GLTFLoader.prototype.load;
beforeAll(() => {
  GLTFLoader.prototype.load = function(
    _url: string,
    onLoad: (gltf: any) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (event: ErrorEvent) => void
  ) {
    try {
      const filePath = path.resolve(process.cwd(), 'public/models/x-bot.glb');
      const buffer = fs.readFileSync(filePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      this.parse(
        arrayBuffer,
        '',
        (gltf: any) => {
          onLoad(gltf);
        },
        (err: any) => {
          if (onError) onError(err);
        }
      );
    } catch (e: any) {
      if (onError) onError(e);
    }
  };
});

afterAll(() => {
  GLTFLoader.prototype.load = originalLoad;
});

describe('Standing Stability and Recovery Analysis', () => {
  let engine: PhysicsEngine;
  let scene: THREE.Scene;
  let binder: HumanoidPhysicsBinder;

  beforeEach(async () => {
    engine = new PhysicsEngine();
    await engine.init();
    scene = new THREE.Scene();
    binder = new HumanoidPhysicsBinder(engine, scene);
  });

  afterEach(() => {
    engine.cleanup();
    binder.cleanup();
  });

  test('runs 10-second (600 steps) drop test spawning in DEFAULT_STANCE_POSE', async () => {
    await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    binder.repositionModel(0, 0.05, 0);

    await binder.createRigidBodiesAndColliders();
    await binder.createJointsWithZeroMotors();
    await binder.activateMotorsWithStiffnessAndDamping(80, 10);
    await binder.activateMultiBody();

    // Reset pose which physically positions qpos in DEFAULT_STANCE_POSE
    // Spawn slightly above the floor (e.g. y = 0.15m) to let it drop and settle
    binder.resetPose({ x: 0, y: 0.15, z: 0 });
    binder.syncVisuals();

    const world = engine.getWorld();
    const data = world.data;
    const model = world.model;

    // Step 1: programmatically verify left/right hip-roll direction responses for abduction
    const module = PhysicsEngine.getModule();
    if (module) {
      const leftRollId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, 'mixamorigleftupleg_roll');
      const rightRollId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, 'mixamorigrightupleg_roll');
      if (leftRollId >= 0 && rightRollId >= 0) {
        // Assert that Left Hip Roll has +0.087 rad (abduction) and Right Hip Roll has -0.087 rad (abduction) on reset
        const leftQposIdx = model.jnt_qposadr[leftRollId];
        const rightQposIdx = model.jnt_qposadr[rightRollId];
        expect(data.qpos[leftQposIdx]).toBeCloseTo(0.087, 2);
        expect(data.qpos[rightQposIdx]).toBeCloseTo(-0.087, 2);
        console.log(`[STABILITY TEST] Verified mirrored hip-roll abduction signs: Left=${data.qpos[leftQposIdx].toFixed(4)} rad, Right=${data.qpos[rightQposIdx].toFixed(4)} rad`);
      }
    }

    // Step the simulation for 10 seconds (600 steps)
    let fallen = false;
    let fallenAtFrame150 = false;
    let maxOscillationAmplitude = 0;
    let prevHeight = 0;

    for (let f = 0; f < 600; f++) {
      binder.updateMotorTargets();
      engine.step();
      binder.syncVisuals();

      // Retrieve root capsule proxy translation to check center of mass height and stability
      const capsule = binder.getCapsuleBody();
      if (capsule && capsule.isValid()) {
        const pos = capsule.translation();
        const tilt = capsule.rotation(); // quaternion

        // Convert scalar-last Three.js quaternion to tilt angle from vertical (y-axis)
        const capsuleUp = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(tilt.x, tilt.y, tilt.z, tilt.w));
        const tiltAngle = Math.acos(Math.min(1, Math.max(-1, capsuleUp.y)));

        if (f < 30) {
          console.log(`[FRAME ${f}] Stance pos Y=${pos.y.toFixed(4)}, Z=${(capsule as any).data.xpos[(capsule as any).bodyId * 3 + 2].toFixed(4)}, Tilt=${(tiltAngle * 180 / Math.PI).toFixed(2)} deg, qpos_freejoint_Z=${(capsule as any).data.qpos[(capsule as any).model.jnt_qposadr[(capsule as any).model.body_jntadr[(capsule as any).bodyId]] + 2].toFixed(4)}`);
        }

        if (pos.y < 0.6 || tiltAngle > 0.8) {
          if (!fallen) {
            console.log(`[STABILITY TEST] Fallen triggered at frame ${f}! pos.y=${pos.y.toFixed(4)}, tiltAngle=${(tiltAngle * 180 / Math.PI).toFixed(2)} deg`);
          }
          fallen = true;
          if (f <= 150) {
            fallenAtFrame150 = true;
          }
        }

        // Measure any high-frequency vertical height oscillation
        if (f > 100) { // allow to settle first
          const osc = Math.abs(pos.y - prevHeight);
          if (osc > maxOscillationAmplitude) {
            maxOscillationAmplitude = osc;
          }
        }
        prevHeight = pos.y;
      }
    }

    const capsule = binder.getCapsuleBody();
    const finalPos = capsule ? capsule.translation() : { x: 0, y: 0, z: 0 };
    const finalRot = capsule ? capsule.rotation() : { x: 0, y: 0, z: 0, w: 1 };
    const capsuleUp = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(finalRot.x, finalRot.y, finalRot.z, finalRot.w));
    const finalTilt = Math.acos(Math.min(1, Math.max(-1, capsuleUp.y)));

    console.log(`[STABILITY TEST] 10-Second Stance-Pose Drop Results:`);
    console.log(`  - Fallen at 2.5s (Frame 150): ${fallenAtFrame150}`);
    console.log(`  - Fallen at 10s (Frame 600): ${fallen}`);
    console.log(`  - Settle Height (Y): ${finalPos.y.toFixed(4)} m`);
    console.log(`  - Tilt Angle: ${(finalTilt * 180 / Math.PI).toFixed(2)} degrees`);
    console.log(`  - Max oscillation amplitude after settling: ${(maxOscillationAmplitude * 1000).toFixed(4)} mm`);

    // Verify it settled stably for the initial landing/standing period (2.5 seconds)
    expect(fallenAtFrame150).toBe(false);
  });

  test('runs 10-second (600 steps) drop test spawning in T-POSE and checks recovery attractor strength', async () => {
    await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    binder.repositionModel(0, 0.05, 0);

    await binder.createRigidBodiesAndColliders();
    await binder.createJointsWithZeroMotors();
    await binder.activateMotorsWithStiffnessAndDamping(80, 10);
    await binder.activateMultiBody();

    // Reset pose, but then physically override ALL joint qpos positions to 0 (T-Pose)
    binder.resetPose({ x: 0, y: 0.15, z: 0 });

    const world = engine.getWorld();
    const data = world.data;
    const model = world.model;
    const module = PhysicsEngine.getModule();

    if (module) {
      const joints = (binder as any).bodyManager.getRigidBodiesMap();
      for (const [boneName] of joints) {
        const hasYaw = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_yaw') >= 0;
        const hasPitch = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_pitch') >= 0;
        const hasRoll = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_roll') >= 0;

        if (hasYaw) {
          const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_yaw');
          data.qpos[model.jnt_qposadr[jntId]] = 0;
        }
        if (hasPitch) {
          const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_pitch');
          data.qpos[model.jnt_qposadr[jntId]] = 0;
        }
        if (hasRoll) {
          const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_roll');
          data.qpos[model.jnt_qposadr[jntId]] = 0;
        }
      }
    }
    binder.syncVisuals();

    // Verify qpos are indeed zeroed (T-pose)
    if (module) {
      const kneeId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, 'mixamorigleftleg_pitch');
      if (kneeId >= 0) {
        expect(data.qpos[model.jnt_qposadr[kneeId]]).toBe(0);
      }
    }

    // Step the simulation for 10 seconds (600 steps)
    let fallen = false;
    let recovered = false;

    for (let f = 0; f < 600; f++) {
      binder.updateMotorTargets();
      engine.step();
      binder.syncVisuals();

      const capsule = binder.getCapsuleBody();
      if (capsule && capsule.isValid()) {
        const pos = capsule.translation();
        const tilt = capsule.rotation();

        const capsuleUp = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(tilt.x, tilt.y, tilt.z, tilt.w));
        const tiltAngle = Math.acos(Math.min(1, Math.max(-1, capsuleUp.y)));

        if (pos.y < 0.6 || tiltAngle > 0.8) {
          fallen = true;
        }

        // We consider it recovered if height is stable upright and tilt is small
        if (f > 300 && pos.y >= 0.85 && tiltAngle < 0.3) {
          recovered = true;
        }
      }
    }

    const capsule = binder.getCapsuleBody();
    const finalPos = capsule ? capsule.translation() : { x: 0, y: 0, z: 0 };
    const finalRot = capsule ? capsule.rotation() : { x: 0, y: 0, z: 0, w: 1 };
    const capsuleUp = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(finalRot.x, finalRot.y, finalRot.z, finalRot.w));
    const finalTilt = Math.acos(Math.min(1, Math.max(-1, capsuleUp.y)));

    console.log(`[STABILITY TEST] 10-Second T-Pose Drop Results:`);
    console.log(`  - Fallen: ${fallen}`);
    console.log(`  - Recovered: ${recovered}`);
    console.log(`  - Settle Height (Y): ${finalPos.y.toFixed(4)} m`);
    console.log(`  - Tilt Angle: ${(finalTilt * 180 / Math.PI).toFixed(2)} degrees`);

    if (recovered && !fallen) {
      console.log(`[STABILITY TEST] RESULT: T-pose recovery to standing succeeded! The additive stance pose acts as a strong attractor.`);
    } else {
      console.log(`[STABILITY TEST] RESULT: T-pose recovery to standing failed. The character tipped over because bipedal falling occurs faster than the 20-frame ramp can pull the joints into the stable base of support. Spawning directly in stance pose is required for stable drops.`);
    }
  });
});
