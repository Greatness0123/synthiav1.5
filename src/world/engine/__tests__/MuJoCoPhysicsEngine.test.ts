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

  test('quaternion conversion helpers work correctly', () => {
    // 1. Identity quaternion
    const identityThree = { x: 0, y: 0, z: 0, w: 1 };
    const convertedIdentity = MuJoCoPhysicsEngine.threeQuatToMuJoCo(identityThree);
    // Should be transformed via Q_align conjugation
    // Q_align = (-90 deg about X) = [w: 0.7071, x: -0.7071, y: 0, z: 0]
    // Under identity, converted should be [0.7071, -0.7071, 0, 0] (or similar normalized, depending on direction)
    const backToThreeIdentity = MuJoCoPhysicsEngine.mujocoQuatToThree(convertedIdentity);

    // Check back conversion gives back identity
    expect(Math.abs(backToThreeIdentity.x)).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(backToThreeIdentity.y)).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(backToThreeIdentity.z)).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(backToThreeIdentity.w - 1)).toBeLessThanOrEqual(1e-5);

    // 2. Clean 90 deg rotation about X
    // (x: sin(45) = 0.7071, y: 0, z: 0, w: cos(45) = 0.7071)
    const rotXThree = { x: 0.70710678, y: 0, z: 0, w: 0.70710678 };
    const convertedRotX = MuJoCoPhysicsEngine.threeQuatToMuJoCo(rotXThree);
    const backToThreeRotX = MuJoCoPhysicsEngine.mujocoQuatToThree(convertedRotX);

    expect(Math.abs(backToThreeRotX.x - 0.70710678)).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(backToThreeRotX.y)).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(backToThreeRotX.z)).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(backToThreeRotX.w - 0.70710678)).toBeLessThanOrEqual(1e-5);
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

  test('mj_ray function call probe', async () => {
    await engine.init();
    const module = (MuJoCoPhysicsEngine as any).mujocoModule;
    if (module) {
      const testMJCF = `
<mujoco model="synthia_phase1_ray_test">
  <compiler angle="radian"/>
  <worldbody>
    <geom name="test_box" type="box" size="1 1 1" pos="0 0 1" contype="1" conaffinity="1"/>
  </worldbody>
</mujoco>
      `.trim();
      module.FS.writeFile('/test_ray_model.xml', testMJCF);
      const model = module.MjModel.mj_loadXML('/test_ray_model.xml');
      const data = new module.MjData(model);

      // Update global positions first!
      module.mj_forward(model, data);

      console.log('Model ngeom:', model.ngeom);
      for (let i = 0; i < model.ngeom; i++) {
        console.log(`Geom ${i} name:`, module.mj_id2name(model, module.mjtObj.mjOBJ_GEOM.value, i), 'pos:', data.geom_xpos[i * 3], data.geom_xpos[i * 3 + 1], data.geom_xpos[i * 3 + 2]);
      }

      const pnt = [0, 0, 5];
      const dir = [0, 0, -1];
      const geomgroup = [1, 1, 1, 1, 1, 1];

      const geomIdBuffer = new module.IntBuffer(1);
      geomIdBuffer.GetView()[0] = -1;
      const distBuffer = new module.DoubleBuffer(1);
      distBuffer.GetView()[0] = -1;

      // Call mj_ray with standard JS arrays for input, but WASM buffers for output pointers!
      const dist = module.mj_ray(model, data, pnt, dir, geomgroup, true, -1, geomIdBuffer, null);

      console.log('mj_ray probe results: dist =', dist, 'geomIdBuffer =', geomIdBuffer.GetView()[0]);
      expect(dist).toBeGreaterThanOrEqual(0);
      expect(geomIdBuffer.GetView()[0]).toBe(0); // hits test_box (id 0)

      geomIdBuffer.delete();
      model.delete();
      data.delete();
    }
  });
});
