/// <reference types="jest" />

declare function describe(name: string, fn: () => void): void;
declare function beforeEach(fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare function expect(actual: unknown): {
  toBeTruthy(): void;
  toBe(expected: unknown): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeGreaterThan(expected: number): void;
};

import * as THREE from 'three';
import { HumanoidPhysicsBinder } from '../HumanoidPhysicsBinder';

function makeSkeletonWithBones(names: string[]): THREE.Skeleton {
  const bones = names.map((n) => {
    const b = new THREE.Bone();
    b.name = n;
    return b;
  });
  const skel = new THREE.Skeleton(bones);
  return skel;
}

type BinderResult = {
  rejections: string[];
  appliedTimeline: Array<{ overrides: Record<string, any> }>;
  clampingNotes: string[];
  injections: string[];
};

describe('Rig Validation', () => {
  let binder: HumanoidPhysicsBinder;
  let skeleton: THREE.Skeleton;

  beforeEach(() => {
    const scene = new THREE.Scene();
    binder = new (HumanoidPhysicsBinder as any)({} as any, scene);
    // create bones for keys we will test
    const keys = [
      'mixamorigrightleg',
      'mixamorigleftarm',
      'mixamorigleftshoulder',
      'mixamorigleftindex1',
      'mixamorigleftindex2',
      'mixamorigleftupleg',
    ];
    skeleton = makeSkeletonWithBones(keys);
    // ensure binder has empty currentTargets map
    (binder as any).currentTargets = new Map();
  });

  test('rejects unknown bone', () => {
    const seq = [{ timeOffsetMs: 0, overrides: { NotABone: 0.5 } }];
    const res = (binder as any).validateAndApplyTimeline(skeleton, seq) as BinderResult;
    expect(res.rejections.some((r) => r.startsWith('unknown_bone'))).toBeTruthy();
  });

  test('clamps positive on 1-DOF hinge with max 0', () => {
    const seq = [{ timeOffsetMs: 0, overrides: { mixamorigRightLeg: 0.5 } }];
    const res = (binder as any).validateAndApplyTimeline(skeleton, seq) as BinderResult;
    const applied = res.appliedTimeline[0].overrides['mixamorigrightleg'];
    expect(applied).toBe(0);
    expect(res.clampingNotes.some((n: string) => n.includes('mixamorigrightleg:positive_x_clamped_to_0'))).toBeTruthy();
  });

  test('scapulohumeral injection for large arm abduction', () => {
    const seq = [{ timeOffsetMs: 0, overrides: { mixamorigLeftArm: [0, 0, 0.7] } }];
    const res = (binder as any).validateAndApplyTimeline(skeleton, seq) as BinderResult;
    expect(res.injections.some((i) => i.startsWith('scapulohumeral_inject'))).toBeTruthy();
    const shoulderOverride = res.appliedTimeline[0].overrides['mixamorigleftshoulder'];
    expect(Array.isArray(shoulderOverride)).toBeTruthy();
    const z = (shoulderOverride as number[])[2];
    expect(Math.abs(z)).toBeGreaterThan(0);
  });

  test('tendon synergy rejects independent PIP/DIP without base flexion', () => {
    const seq = [{ timeOffsetMs: 0, overrides: { mixamorigLeftIndex2: -0.5 } }];
    const res = (binder as any).validateAndApplyTimeline(skeleton, seq) as BinderResult;
    expect(res.rejections.some((r) => r.includes('tendon_synergy_violation'))).toBeTruthy();
  });

  test('locomotion cap scales leg limits when active gait', () => {
    // attempt to set left upleg X beyond its allowed 2.094, expect clamping to scaled cap
    const seq = [{ timeOffsetMs: 0, overrides: { mixamorigLeftUpLeg: [3.0, 0, 0] } }];
    const res = (binder as any).validateAndApplyTimeline(skeleton, seq, { activeGaitPhase: true }) as BinderResult;
    const applied = res.appliedTimeline[0].overrides['mixamorigleftupleg'] as number[];
    // scaled max = 2.094 * 0.78
    const scaledMax = 2.094 * 0.78;
    expect(applied[0]).toBeLessThanOrEqual(scaledMax + 1e-6);
  });
});
