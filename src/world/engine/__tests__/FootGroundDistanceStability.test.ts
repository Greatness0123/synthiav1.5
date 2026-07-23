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

describe('Foot Ground Distance Stability Log', () => {
  test('Run standing-idle and trace foot-ground distance over 30 steps (~0.5s)', async () => {
    console.log('\n--- FOOT-GROUND DISTANCE DRIFT TRACE ---');
    const engine = new PhysicsEngine();
    await engine.init();
    const scene = new THREE.Scene();
    const binder = new HumanoidPhysicsBinder(engine, scene);

    // Expose to global for rehydrate compatibility
    (global as any).__SYNTHIA_HUMANOID_BINDER__ = binder;

    const loaded = await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    if (!loaded) throw new Error('Binder failed to load');

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

    const leftFootGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'mixamorigleftfoot_geom');
    const rightFootGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'mixamorigrightfoot_geom');

    for (let step = 0; step < 30; step++) {
      binder.updateMotorTargets();
      engine.step();

      // Compute exact corner-aware bottom Z of both feet
      const computeMinZ = (geomId: number) => {
        const hx = model.geom_size[geomId * 3];
        const hy = model.geom_size[geomId * 3 + 1];
        const hz = model.geom_size[geomId * 3 + 2];
        const posZ = data.geom_xpos[geomId * 3 + 2];
        const r6 = data.geom_xmat[geomId * 9 + 6];
        const r7 = data.geom_xmat[geomId * 9 + 7];
        const r8 = data.geom_xmat[geomId * 9 + 8];

        let minZ = Infinity;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const cz = posZ + r6 * (sx * hx) + r7 * (sy * hy) + r8 * (sz * hz);
              if (cz < minZ) minZ = cz;
            }
          }
        }
        return minZ;
      };

      const lMinZ = computeMinZ(leftFootGeomId);
      const rMinZ = computeMinZ(rightFootGeomId);

      const leftBodyZ = data.xpos[module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, 'mixamorigleftfoot') * 3 + 2];
      const rightBodyZ = data.xpos[module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, 'mixamorigrightfoot') * 3 + 2];

      const ts = (step * 0.01667).toFixed(2);
      console.log(`[foot-ground-trace] ${ts}s Lfoot gap=${(lMinZ * 1000).toFixed(1)}mm bodyZ=${(leftBodyZ * 1000).toFixed(1)}mm | Rfoot gap=${(rMinZ * 1000).toFixed(1)}mm bodyZ=${(rightBodyZ * 1000).toFixed(1)}mm`);
    }

    engine.cleanup();
    binder.cleanup();
  });
});
