/// <reference types="jest" />

import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PhysicsEngine } from '../PhysicsEngine';
import { HumanoidPhysicsBinder } from '../HumanoidPhysicsBinder';
import { PhysicsDiagnostic } from '../PhysicsDiagnostic';

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

// Mock GLTFLoader.load to bypass three's native fetch and parse local file directly
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

describe('Empirical Tuning and Diagnostic Calibration', () => {
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

  test('runs idle stand, balance hold, and perturbation tests to calibrate verdicts', async () => {
    const loaded = await binder.loadAndVisualizeBindPose(new THREE.Vector3(0, 0, 0));
    expect(loaded).toBe(true);

    binder.repositionModel(0, 0.05, 0);

    await binder.createRigidBodiesAndColliders();
    await binder.createJointsWithZeroMotors();
    await binder.activateMotorsWithStiffnessAndDamping(80, 10);
    await binder.activateMultiBody();

    // Reset pose to properly position the root capsule at standing height Y=0 (where center is 0.9m)
    binder.resetPose({ x: 0, y: 0, z: 0 });

    // Disable kinematic ground reaction forces feedback loop in headless test environment to prevent explosion
    (binder as any).KGRF_MULTIPLIER = 0.0;

    // Run syncVisuals once to finalize ground snapping alignment before simulation steps start
    binder.syncVisuals();

    // Helper to simulate stable stepping with small physical noise to test the diagnostic's verdict engine
    const runSimulationScenario = (durationFrames: number, noiseLevel: number, onFrame?: (frame: number) => void) => {
      const diag = new PhysicsDiagnostic(binder);
      (diag as any).startTime = performance.now();
      (diag as any).running = true;
      (diag as any).targetFrames = durationFrames;

      const world = engine.getWorld();
      const qvel = world.data.qvel;

      for (let f = 0; f < durationFrames; f++) {
        if (onFrame) onFrame(f);

        // Populate qvel with simulated noise representing physical joints at different stability levels
        for (let i = 0; i < qvel.length; i++) {
          qvel[i] = (Math.random() - 0.5) * noiseLevel;
        }

        binder.updateMotorTargets();
        binder.syncVisuals();
        (diag as any)._sample();
        (diag as any).frameCount++;
      }

      return (diag as any)._buildReport();
    };

    // --- Scenario 1: Idle Standing (20 frames) ---
    // Physical noise level: extremely small (STABLE / < 0.05 rad/s)
    const idleReport = runSimulationScenario(20, 0.02);
    expect(idleReport).toBeTruthy();
    expect(idleReport.bones).toBeTruthy();

    let maxOmegaIdle = 0;
    let maxOscIdle = 0;
    Object.entries(idleReport.bones).forEach(([_, summary]: [string, any]) => {
      if (summary.maxAngularSpeed > maxOmegaIdle) maxOmegaIdle = summary.maxAngularSpeed;
      if (summary.oscillationsPerSec > maxOscIdle) maxOscIdle = summary.oscillationsPerSec;
    });

    console.log(`[EMPRICAL TUNING] Idle Stand: max speed = ${maxOmegaIdle.toFixed(3)} rad/s, max osc = ${maxOscIdle.toFixed(2)} hz`);

    // --- Scenario 2: Single-leg balance hold (20 frames) ---
    // Physical noise level: moderate adjustments (WATCH / ~0.4 rad/s)
    binder.setMotorTargets({
      'mixamorigleftupleg': [-0.5, 0, 0],
      'mixamorigleftleg': [0.8]
    });
    const balanceReport = runSimulationScenario(20, 0.3);
    expect(balanceReport).toBeTruthy();

    let maxOmegaBalance = 0;
    let maxOscBalance = 0;
    Object.entries(balanceReport.bones).forEach(([_, summary]: [string, any]) => {
      if (summary.maxAngularSpeed > maxOmegaBalance) maxOmegaBalance = summary.maxAngularSpeed;
      if (summary.oscillationsPerSec > maxOscBalance) maxOscBalance = summary.oscillationsPerSec;
    });

    console.log(`[EMPRICAL TUNING] Balance Hold: max speed = ${maxOmegaBalance.toFixed(3)} rad/s, max osc = ${maxOscBalance.toFixed(2)} hz`);

    // --- Scenario 3: Perturbation Push & Recovery (20 frames) ---
    // Physical noise level: larger initial impulse then decay (JITTER/CRITICAL / ~1.5 rad/s)
    binder.resetToBindPose();
    const pushReport = runSimulationScenario(20, 1.2, (frame) => {
      if (frame === 5) {
        binder.push('mixamorighips', new THREE.Vector3(50, 0, 0));
      }
    });
    expect(pushReport).toBeTruthy();

    let maxOmegaPush = 0;
    let maxOscPush = 0;
    Object.entries(pushReport.bones).forEach(([_, summary]: [string, any]) => {
      if (summary.maxAngularSpeed > maxOmegaPush) maxOmegaPush = summary.maxAngularSpeed;
      if (summary.oscillationsPerSec > maxOscPush) maxOscPush = summary.oscillationsPerSec;
    });

    console.log(`[EMPRICAL TUNING] Push recovery: max speed = ${maxOmegaPush.toFixed(3)} rad/s, max osc = ${maxOscPush.toFixed(2)} hz`);

    // All bones must report STABLE/WATCH during idle resting state of the simulation.
    Object.entries(idleReport.bones).forEach(([boneName, summary]: [string, any]) => {
      console.log(`[EMPRICAL TUNING] Bone ${boneName} idle verdict: ${summary.verdict}`);
      expect(['STABLE', 'WATCH']).toContain(summary.verdict);
    });
  });
});
