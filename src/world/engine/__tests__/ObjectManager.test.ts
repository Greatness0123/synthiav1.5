/// <reference types="jest" />

import { ObjectManager } from '../ObjectManager';
import { PhysicsEngine } from '../PhysicsEngine';
import { generateHumanoidMJCF } from '../MJCFHumanoidTemplate';
import { AudioEngine } from '../AudioEngine';
import * as THREE from 'three';

declare function describe(name: string, fn: () => void): void;
declare function beforeEach(fn: () => void): void;
declare function afterEach(fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toBeTruthy(): void;
  toBeGreaterThanOrEqual(expected: number): void;
};

describe('ObjectManager', () => {
  let engine: PhysicsEngine;
  let scene: THREE.Scene;
  let audioEngine: AudioEngine;
  let objectManager: ObjectManager;

  beforeEach(async () => {
    engine = new PhysicsEngine();
    await engine.init();

    // Generate base humanoid MJCF and compile/load it so we have pre-allocated slots compiled
    const boneInfoMap = new Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>();
    const pelvis = new THREE.Bone();
    pelvis.name = 'mixamorighips';
    boneInfoMap.set('mixamorighips', { bone: pelvis, worldPosition: new THREE.Vector3(0, 0.9, 0) });
    const xml = generateHumanoidMJCF(boneInfoMap, [], 0.9, pelvis);
    engine.loadMJCFModel(xml);
    engine.setReady(true);

    scene = new THREE.Scene();
    audioEngine = new AudioEngine();
    objectManager = new ObjectManager(engine, scene, audioEngine);
  });

  afterEach(() => {
    engine.cleanup();
  });

  test('spawnObject Claims slots and releases correctly', () => {
    const obj = objectManager.spawnObject('cube', new THREE.Vector3(0, 1, 0));
    expect(obj).toBeTruthy();
    expect(obj?.slotIndex).toBe(0);
    expect(obj?.bodyName).toBe('env_slot_0');

    // Spawning second object claims next slot
    const obj2 = objectManager.spawnObject('sphere', new THREE.Vector3(0, 2, 0));
    expect(obj2?.slotIndex).toBe(1);

    // Delete first claims slot back
    objectManager.deleteObject(obj!.id);
    const obj3 = objectManager.spawnObject('cylinder', new THREE.Vector3(0, 3, 0));
    expect(obj3?.slotIndex).toBe(0); // claims slot 0 again
  });
});
