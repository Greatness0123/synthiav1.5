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

describe('Spawn Overlap Verification', () => {
  test('Run pre-overlap (collision enabled) and post-overlap (collision disabled) checks', async () => {
    const templatePath = path.resolve(process.cwd(), 'src/world/engine/MJCFHumanoidTemplate.ts');
    const originalTemplateContent = fs.readFileSync(templatePath, 'utf8');

    // ── CONFIGURATION A: Collision Enabled (contype=2 conaffinity=1) ──
    try {
      console.log('\n--- CONFIGURATION A: COLLISION ENABLED (BEFORE STEP 2 FIX) ---');

      // Temporarily patch template content to enable capsule collision (contype="2" conaffinity="1")
      const patchedContent = originalTemplateContent.replace(
        'contype="0" conaffinity="0"',
        'contype="2" conaffinity="1"'
      );
      fs.writeFileSync(templatePath, patchedContent, 'utf8');

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

      const capsuleGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'root_capsule_geom');
      const leftFootGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'mixamorigleftfoot_geom');
      const rightFootGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'mixamorigrightfoot_geom');

      module.mj_forward(model, data);

      for (let step = 0; step <= 5; step++) {
        const capXpos = [
          data.geom_xpos[capsuleGeomId * 3],
          data.geom_xpos[capsuleGeomId * 3 + 1],
          data.geom_xpos[capsuleGeomId * 3 + 2]
        ];
        const capRad = model.geom_size[capsuleGeomId * 3];
        const capHalfH = model.geom_size[capsuleGeomId * 3 + 1];

        // local bottom point of the capsule
        const localBottom = [0, 0, -(capHalfH + capRad)];
        const r6 = data.geom_xmat[capsuleGeomId * 9 + 6];
        const r7 = data.geom_xmat[capsuleGeomId * 9 + 7];
        const r8 = data.geom_xmat[capsuleGeomId * 9 + 8];
        const capLowestZ = capXpos[2] + r6 * localBottom[0] + r7 * localBottom[1] + r8 * localBottom[2];

        // Read foot geom world positions (real transforms)
        const leftFootXpos = [
          data.geom_xpos[leftFootGeomId * 3],
          data.geom_xpos[leftFootGeomId * 3 + 1],
          data.geom_xpos[leftFootGeomId * 3 + 2]
        ];
        const rightFootXpos = [
          data.geom_xpos[rightFootGeomId * 3],
          data.geom_xpos[rightFootGeomId * 3 + 1],
          data.geom_xpos[rightFootGeomId * 3 + 2]
        ];

        if ([0, 1, 2, 5].includes(step)) {
          console.log(`[PRE-FIX] Frame ${step}: Capsule Lowest Z = ${capLowestZ.toFixed(4)}m | LFoot Geom Center Z = ${leftFootXpos[2].toFixed(4)}m | RFoot Geom Center Z = ${rightFootXpos[2].toFixed(4)}m`);
        }

        binder.updateMotorTargets();
        engine.step();
      }

      engine.cleanup();
      binder.cleanup();
    } finally {
      // Restore original template content
      fs.writeFileSync(templatePath, originalTemplateContent, 'utf8');
    }

    // ── CONFIGURATION B: Collision Disabled (contype=0 conaffinity=0) ──
    {
      console.log('\n--- CONFIGURATION B: COLLISION DISABLED (AFTER STEP 2 FIX) ---');
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

      const capsuleGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'root_capsule_geom');
      const leftFootGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'mixamorigleftfoot_geom');
      const rightFootGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'mixamorigrightfoot_geom');

      // Double-check template has contype=0 conaffinity=0
      if (model.geom_contype[capsuleGeomId] !== 0 || model.geom_conaffinity[capsuleGeomId] !== 0) {
        throw new Error(`Expected capsule geom contype/conaffinity to be 0/0, but got ${model.geom_contype[capsuleGeomId]}/${model.geom_conaffinity[capsuleGeomId]}`);
      }

      module.mj_forward(model, data);

      for (let step = 0; step <= 5; step++) {
        const capXpos = [
          data.geom_xpos[capsuleGeomId * 3],
          data.geom_xpos[capsuleGeomId * 3 + 1],
          data.geom_xpos[capsuleGeomId * 3 + 2]
        ];
        const capRad = model.geom_size[capsuleGeomId * 3];
        const capHalfH = model.geom_size[capsuleGeomId * 3 + 1];

        // local bottom point of the capsule
        const localBottom = [0, 0, -(capHalfH + capRad)];
        const r6 = data.geom_xmat[capsuleGeomId * 9 + 6];
        const r7 = data.geom_xmat[capsuleGeomId * 9 + 7];
        const r8 = data.geom_xmat[capsuleGeomId * 9 + 8];
        const capLowestZ = capXpos[2] + r6 * localBottom[0] + r7 * localBottom[1] + r8 * localBottom[2];

        // Read foot geom world positions (real transforms)
        const leftFootXpos = [
          data.geom_xpos[leftFootGeomId * 3],
          data.geom_xpos[leftFootGeomId * 3 + 1],
          data.geom_xpos[leftFootGeomId * 3 + 2]
        ];
        const rightFootXpos = [
          data.geom_xpos[rightFootGeomId * 3],
          data.geom_xpos[rightFootGeomId * 3 + 1],
          data.geom_xpos[rightFootGeomId * 3 + 2]
        ];

        if ([0, 1, 2, 5].includes(step)) {
          console.log(`[POST-FIX] Frame ${step}: Capsule Lowest Z = ${capLowestZ.toFixed(4)}m | LFoot Geom Center Z = ${leftFootXpos[2].toFixed(4)}m | RFoot Geom Center Z = ${rightFootXpos[2].toFixed(4)}m`);
        }

        binder.updateMotorTargets();
        engine.step();
      }

      engine.cleanup();
      binder.cleanup();
    }
  });
});
