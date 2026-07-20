/// <reference types="jest" />

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

import { MuJoCoPhysicsEngine } from '../MuJoCoPhysicsEngine';

describe('MuJoCoPhysicsEngine', () => {
  let engine: MuJoCoPhysicsEngine;

  beforeEach(() => {
    engine = new MuJoCoPhysicsEngine();
  });

  afterEach(() => {
    engine.cleanup();
  });

  test('WASM initialization and loading without crash', async () => {
    await engine.init();
    expect(engine.isReady).toBe(false); // starts not ready by default, matches Rapier initialization
    engine.setReady(true);
    expect(engine.isReady).toBe(true);
    expect(engine.isBroken).toBe(false);
  });

  test('step() execution runs 65 times without WASM memory faults', async () => {
    await engine.init();
    engine.setReady(true);

    for (let i = 0; i < 65; i++) {
      engine.step();
    }

    expect(engine.isBroken).toBe(false);
  });

  test('setting and getting gravity works', async () => {
    await engine.init();
    engine.setGravity(-5.0);
    const world = engine.getWorld();
    const gravityZ = world.model.opt.gravity[2];
    expect(gravityZ).toBe(-5.0);
  });

  test('velocity clamping works correctly on registered bodies', async () => {
    // Add a free body to the scene to test velocity clamping
    const testMJCF = `
<mujoco model="synthia_phase1_velocity_clamp_test">
  <compiler angle="radian"/>
  <option gravity="0 0 -9.81" timestep="0.01667"/>
  <worldbody>
    <light directional="true" pos="0 0 3" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="100 100 0.1" rgba="0.8 0.9 0.8 1"/>
    <body name="test_box" pos="0 0 1">
      <freejoint name="free_joint"/>
      <geom type="box" size="0.1 0.1 0.1"/>
    </body>
  </worldbody>
</mujoco>
    `.trim();

    // Since we need to write this to virtual filesystem to parse it, we initialize manually
    const module = (MuJoCoPhysicsEngine as any).mujocoModule;
    if (module) {
      module.FS.writeFile('/test_model.xml', testMJCF);
      const testModel = module.MjModel.mj_loadXML('/test_model.xml');
      const testData = new module.MjData(testModel);

      // Store them in the engine using non-public bypass for testing
      (engine as any).model = testModel;
      (engine as any).data = testData;
      (engine as any).initialized = true;
      engine.setReady(true);

      const bodyId = module.mj_name2id(testModel, module.mjtObj.mjOBJ_BODY.value, 'test_box');
      expect(bodyId).toBeGreaterThanOrEqual(0);

      engine.registerVelocityClampBody(bodyId);

      // Set extremely high linear and angular velocities (above limit of 10.0)
      const qvel = engine.qvel;
      qvel[0] = 50.0;
      qvel[1] = 0.0;
      qvel[2] = 0.0;
      qvel[3] = 50.0;
      qvel[4] = 0.0;
      qvel[5] = 0.0;

      // Executing a step will trigger clamping
      engine.step();

      const clampedQVel = engine.qvel;
      expect(clampedQVel[0]).toBeLessThanOrEqual(10.1);
      expect(clampedQVel[3]).toBeLessThanOrEqual(10.1);
    }
  });
});
