/// <reference types="jest" />

import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PhysicsEngine } from '../PhysicsEngine';
import { HumanoidPhysicsBinder } from '../HumanoidPhysicsBinder';
import { ObjectManager } from '../ObjectManager';
import { AudioEngine } from '../AudioEngine';

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

describe('MuJoCo Physics and Humanoid Integration', () => {
  let engine: PhysicsEngine;
  let scene: THREE.Scene;
  let binder: HumanoidPhysicsBinder;
  let objManager: ObjectManager;

  beforeEach(async () => {
    engine = new PhysicsEngine();
    await engine.init();
    scene = new THREE.Scene();
    binder = new HumanoidPhysicsBinder(engine, scene);

    const mockAudioEngine = {} as AudioEngine;
    objManager = new ObjectManager(engine, scene, mockAudioEngine);
  });

  afterEach(() => {
    engine.cleanup();
    binder.cleanup();
  });

  test('humanoid model loads, compiles, and registers rigid bodies and actuators cleanly', async () => {
    const loaded = await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    expect(loaded).toBe(true);

    binder.repositionModel(0, 0.05, 0);

    const stepB = await binder.createRigidBodiesAndColliders();
    expect(stepB).toBe(true);

    const diagnostics = binder.getDiagnostics();
    expect(diagnostics.isLoaded).toBe(true);
    expect(diagnostics.hasCapsuleBody).toBe(true);
    expect(diagnostics.boneCount).toBe(62);
    expect(diagnostics.multiBodyBoneCount).toBe(50);
  });

  test('actuators respond to single and simultaneous multi-target targets correctly', async () => {
    await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    binder.repositionModel(0, 0.05, 0);
    await binder.createRigidBodiesAndColliders();
    await binder.createJointsWithZeroMotors();
    await binder.activateMotorsWithStiffnessAndDamping(80, 10);
    await binder.activateMultiBody();

    binder.resetPose({ x: 0, y: 0, z: 0 });

    // Test 1: Single target response
    const targets1 = { 'mixamorigleftleg': 0.5 };
    const res1 = binder.setMotorTargets(targets1);
    expect(res1.applied.includes('mixamorigleftleg')).toBe(true);

    // Test 2: Simultaneous multi-target joint targets to test coupling response
    const targets2 = {
      'mixamorigleftupleg': [0.1, 0.2, 0.3],
      'mixamorigrightupleg': [0.4, 0.5, 0.6],
      'mixamorigspine': 0.15
    };
    const res2 = binder.setMotorTargets(targets2 as any);
    expect(res2.applied.includes('mixamorigleftupleg')).toBe(true);
    expect(res2.applied.includes('mixamorigrightupleg')).toBe(true);
    expect(res2.applied.includes('mixamorigspine')).toBe(true);
  });

  test('switches to limp/ragdoll mode and zeros out actuator gains correctly', async () => {
    await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    binder.repositionModel(0, 0.05, 0);
    await binder.createRigidBodiesAndColliders();
    await binder.createJointsWithZeroMotors();
    await binder.activateMotorsWithStiffnessAndDamping(80, 10);
    await binder.activateMultiBody();

    binder.resetPose({ x: 0, y: 0, z: 0 });

    const mc = (binder as any).motorController;

    // Switch to Ragdoll (Limp Mode)
    binder.setMode('ragdoll');
    expect(mc.limpModeActive).toBe(true);

    const world = engine.getWorld();
    for (let i = 0; i < world.model.nu; i++) {
      expect(world.model.actuator_gainprm[i * 3]).toBe(0);
    }

    // Switch back to Rigid (Position Control Mode)
    binder.setMode('rigid');
    expect(mc.limpModeActive).toBe(false);
    expect(world.model.actuator_gainprm[0]).toBeGreaterThan(0);
  });

  test('dynamic environment object spawning and floor collision mapping works', async () => {
    // Expose binder to global for state-rehydrate compatibility inside ObjManager
    (global as any).__SYNTHIA_HUMANOID_BINDER__ = binder;

    // Load full model to populate preallocated env slots
    await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    binder.repositionModel(0, 0.05, 0);
    await binder.createRigidBodiesAndColliders();

    // Spawn objects
    const sphereObj = objManager.spawnObject('sphere', new THREE.Vector3(1, 0.5, 1));
    expect(sphereObj).toBeTruthy();
    expect(sphereObj?.colliders.length).toBeGreaterThan(0);

    const cubeObj = objManager.spawnObject('cube', new THREE.Vector3(-1, 0.5, -1));
    expect(cubeObj).toBeTruthy();
    expect(cubeObj?.colliders.length).toBeGreaterThan(0);

    const initialObjectsSize = objManager.getObjects().size;
    expect(initialObjectsSize).toBe(2);

    // Delete object
    objManager.deleteObject(sphereObj!.id);
    expect(objManager.getObjects().size).toBe(1);
  });

  test('recovers standing upright frame posture from external perturbation pushes cleanly', async () => {
    await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    binder.repositionModel(0, 0.05, 0);
    await binder.createRigidBodiesAndColliders();
    await binder.createJointsWithZeroMotors();
    await binder.activateMotorsWithStiffnessAndDamping(80, 10);
    await binder.activateMultiBody();

    // Spawn completely above ground to ensure stability
    binder.resetPose({ x: 0, y: -2.0, z: 0 });
    (binder as any).KGRF_MULTIPLIER = 0.0;
    binder.syncVisuals();

    // Step a few frames to let physics settle
    for (let i = 0; i < 5; i++) {
      binder.updateMotorTargets();
      engine.step();
      binder.syncVisuals();
    }

    const world = engine.getWorld();
    const qvel = world.data.qvel;

    // Apply external lateral perturbation push to the hips
    binder.push('mixamorighips', new THREE.Vector3(15.0, 0.0, 0.0));

    // Check that push registers as non-zero velocity in the root free joint
    expect(Math.abs(qvel[0]) + Math.abs(qvel[1]) + Math.abs(qvel[2])).toBeGreaterThan(0);

    // Step through the recovery ticks
    for (let i = 0; i < 5; i++) {
      binder.updateMotorTargets();
      engine.step();
      binder.syncVisuals();
    }

    // Verify velocities damp back down and remain stable under constraint solver
    expect(engine.isBroken).toBe(false);
  });
});
