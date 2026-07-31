/// <reference types="jest" />

import * as THREE from 'three';
import { generateHumanoidMJCF } from '../MJCFHumanoidTemplate';
import { PhysicsEngine } from '../PhysicsEngine';

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
};

describe('Multi-Agent Client Architecture Tests', () => {
  let engine: PhysicsEngine;

  beforeEach(() => {
    engine = new PhysicsEngine();
  });

  afterEach(() => {
    engine.cleanup();
  });

  test('consecutive multi-agent MJCF generation is successful and unique', async () => {
    await engine.init();

    const boneInfoMap = new Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>();

    const pelvis = new THREE.Bone();
    pelvis.name = 'mixamorighips';
    boneInfoMap.set('mixamorighips', { bone: pelvis, worldPosition: new THREE.Vector3(0, 0.9, 0) });

    const spine = new THREE.Bone();
    spine.name = 'mixamorigspine';
    pelvis.add(spine);
    boneInfoMap.set('mixamorigspine', { bone: spine, worldPosition: new THREE.Vector3(0, 1.1, 0) });

    // Specify 3 agents sequentially
    const agentsList = [
      { id: 'agent_0', spawnOffset: { x: 0, y: 0, z: 0 } },
      { id: 'agent_1', spawnOffset: { x: 2.0, y: 0, z: 0 } },
      { id: 'agent_2', spawnOffset: { x: 4.0, y: 0, z: 0 } }
    ];

    const xml = generateHumanoidMJCF(boneInfoMap, [], 0.9, pelvis, null, null, agentsList);

    expect(xml).toBeTruthy();

    // Check prefixed elements
    expect(xml.includes('<body name="agent_agent_0_root_capsule"')).toBe(true);
    expect(xml.includes('<body name="agent_agent_1_root_capsule"')).toBe(true);
    expect(xml.includes('<body name="agent_agent_2_root_capsule"')).toBe(true);

    expect(xml.includes('<freejoint name="agent_agent_0_root_freejoint"/>')).toBe(true);
    expect(xml.includes('<freejoint name="agent_agent_1_root_freejoint"/>')).toBe(true);
    expect(xml.includes('<freejoint name="agent_agent_2_root_freejoint"/>')).toBe(true);

    expect(xml.includes('name="agent_agent_0_mixamorigspine_yaw"')).toBe(true);
    expect(xml.includes('name="agent_agent_1_mixamorigspine_yaw"')).toBe(true);
    expect(xml.includes('name="agent_agent_2_mixamorigspine_yaw"')).toBe(true);

    // Load XML into MuJoCo without crashes
    let loadFailed = false;
    try {
      engine.loadMJCFModel(xml);
      engine.setReady(true);
    } catch (err) {
      loadFailed = true;
      console.error(err);
    }
    expect(loadFailed).toBe(false);
    expect(engine.isBroken).toBe(false);
  });
});
