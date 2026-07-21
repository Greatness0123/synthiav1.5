/// <reference types="jest" />

import { MuJoCoCollisionAdapter } from '../MuJoCoCollisionAdapter';
import { MainModule, MjModel, MjData } from '@mujoco/mujoco';

declare function describe(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toBeTruthy(): void;
  toEqual(expected: unknown): void;
};

describe('MuJoCoCollisionAdapter', () => {
  test('preset conversion returns correct shapes and sizes', () => {
    const spherePreset = { id: 'sphere', name: 'Sphere', category: 'Primitives' as const, icon: 'Circle', mass: 1, friction: 0.3, restitution: 0.8 };
    const cubePreset = { id: 'cube', name: 'Cube', category: 'Primitives' as const, icon: 'Cube', mass: 1, friction: 0.5, restitution: 0.2 };

    const sphereGeom = MuJoCoCollisionAdapter.objectPresetToMJCFGeom(spherePreset);
    expect(sphereGeom.geomType).toBe('sphere');
    expect(sphereGeom.size).toBe('0.5');

    const cubeGeom = MuJoCoCollisionAdapter.objectPresetToMJCFGeom(cubePreset);
    expect(cubeGeom.geomType).toBe('box');
    expect(cubeGeom.size).toBe('0.5 0.5 0.5');
  });
});
