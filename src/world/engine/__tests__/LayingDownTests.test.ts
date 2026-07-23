/// <reference types="jest" />

import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PhysicsEngine } from '../PhysicsEngine';
import { HumanoidPhysicsBinder } from '../HumanoidPhysicsBinder';

declare function describe(name: string, fn: () => void): void;
declare function beforeAll(fn: () => void): void;
declare function afterAll(fn: () => void): void;
declare function test(name: string, fn: () => void): void;

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

describe('Lying Down and Standing Stability Tests', () => {
  test('600+ step standing stability check', async () => {
    console.log('\n--- STARTING 600+ STEP STANDING STABILITY TEST ---');
    const engine = new PhysicsEngine();
    await engine.init();
    const scene = new THREE.Scene();
    const binder = new HumanoidPhysicsBinder(engine, scene);

    (global as any).__SYNTHIA_HUMANOID_BINDER__ = binder;

    await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    binder.repositionModel(0, 0.05, 0);
    await binder.createRigidBodiesAndColliders();
    await binder.createJointsWithZeroMotors();
    await binder.activateMotorsWithStiffnessAndDamping(80, 10);
    await binder.activateMultiBody();

    binder.resetPose({ x: 0, y: 0.05, z: 0 });

    let stableSteps = 0;
    for (let step = 0; step < 650; step++) {
      binder.updateMotorTargets();
      engine.step();
      binder.syncVisuals();

      if (!engine.isBroken && !binder.isOutOfWorldBounds()) {
        stableSteps++;
      }
    }

    console.log(`Standing stability test complete: stable for ${stableSteps}/650 steps.`);
    engine.cleanup();
    binder.cleanup();
  });

  test('Deliberate fall and rest test with detailed metrics tracking', async () => {
    console.log('\n--- STARTING DELIBERATE FALL AND REST TEST ---');
    const engine = new PhysicsEngine();
    await engine.init();
    const scene = new THREE.Scene();
    const binder = new HumanoidPhysicsBinder(engine, scene);

    (global as any).__SYNTHIA_HUMANOID_BINDER__ = binder;

    await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    binder.repositionModel(0, 0.05, 0);
    await binder.createRigidBodiesAndColliders();
    await binder.createJointsWithZeroMotors();
    await binder.activateMotorsWithStiffnessAndDamping(80, 10);
    await binder.activateMultiBody();

    binder.resetPose({ x: 0, y: 0.05, z: 0 });

    const world = engine.getWorld();
    const model = world.model;
    const data = world.data;
    const module = PhysicsEngine.getModule()!;

    const capsuleBodyId = binder.getMultiBodyManager().getCapsuleBody()!;

    // 1. Induce a deliberate fall by activating ragdoll (limp mode)
    binder.setMode('ragdoll');

    let groundedTransitions = 0;
    let prevGrounded = binder.getIsGrounded();

    const stepsToRun = 300; // 5 seconds of fall/settle simulation
    const peakQvels: number[] = [];

    for (let step = 0; step < stepsToRun; step++) {
      binder.updateMotorTargets();
      engine.step();
      binder.syncVisuals();

      // Track _isGrounded value & transitions
      const isGrounded = binder.getIsGrounded();
      if (isGrounded !== prevGrounded) {
        groundedTransitions++;
        prevGrounded = isGrounded;
      }

      // Compute capsule lowest point Z
      const capXpos = [
        data.geom_xpos[capsuleBodyId * 3],
        data.geom_xpos[capsuleBodyId * 3 + 1],
        data.geom_xpos[capsuleBodyId * 3 + 2]
      ];
      const capGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'root_capsule_geom');
      const capRad = model.geom_size[capGeomId * 3];
      const capHalfH = model.geom_size[capGeomId * 3 + 1];
      const localBottom = [0, 0, -(capHalfH + capRad)];
      const r6 = data.geom_xmat[capGeomId * 9 + 6];
      const r7 = data.geom_xmat[capGeomId * 9 + 7];
      const r8 = data.geom_xmat[capGeomId * 9 + 8];
      const capLowestZ = capXpos[2] + r6 * localBottom[0] + r7 * localBottom[1] + r8 * localBottom[2];

      // Compute capsule tilt angle from vertical Z axis (which is vertical in MuJoCo Z-up space)
      const qW = data.xquat[capsuleBodyId * 4];
      const qX = data.xquat[capsuleBodyId * 4 + 1];
      const qY = data.xquat[capsuleBodyId * 4 + 2];
      const qZ = data.xquat[capsuleBodyId * 4 + 3];
      const threeQuatObj = PhysicsEngine.mujocoQuatToThree([qW, qX, qY, qZ]);
      const q = new THREE.Quaternion(threeQuatObj.x, threeQuatObj.y, threeQuatObj.z, threeQuatObj.w);
      const capsuleUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q); // world vertical in three is Y
      const tiltRad = Math.acos(Math.min(1, Math.max(-1, capsuleUp.y)));
      const tiltDeg = tiltRad * (180 / Math.PI);

      // Log _isGrounded and other parameters
      if (step >= 180 && step % 10 === 0) { // Settle period (last 2 seconds)
        console.log(`[FALL-TEST-FRAME] Step ${step}: _isGrounded=${isGrounded} | Tilt Angle=${tiltDeg.toFixed(1)}° | Capsule Lowest Z=${capLowestZ.toFixed(4)}m | Floor Z=0.0m`);
      }

      // Track qvel magnitude during the last 2 seconds (steps 180 to 300)
      if (step >= 180) {
        const dofAdr = model.body_dofadr[capsuleBodyId];
        const lx = data.qvel[dofAdr];
        const ly = data.qvel[dofAdr + 1];
        const lz = data.qvel[dofAdr + 2];
        const ax = data.qvel[dofAdr + 3];
        const ay = data.qvel[dofAdr + 4];
        const az = data.qvel[dofAdr + 5];
        const qvelMag = Math.sqrt(lx * lx + ly * ly + lz * lz + ax * ax + ay * ay + az * az);
        peakQvels.push(qvelMag);
      }
    }

    const peakQvel = Math.max(...peakQvels);
    console.log(`[FALL-TEST SUMMARY]`);
    console.log(`- _isGrounded Transitions Count: ${groundedTransitions}`);
    console.log(`- Last tracked _isGrounded state: ${binder.getIsGrounded()}`);
    console.log(`- Peak root qvel magnitude during rest (last 2s): ${peakQvel.toFixed(4)} rad/s / m/s`);

    engine.cleanup();
    binder.cleanup();
  });
});
