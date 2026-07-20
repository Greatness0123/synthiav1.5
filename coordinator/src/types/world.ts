/**
 * Types for the world state, objects, and physics.
 */

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export type BodyType = 'humanoid' | 'quadruped' | 'robotic_arm' | 'custom';
export type BodyMode = 'rigid' | 'ragdoll';

export interface WorldObject {
  id: string;
  type: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  isStatic: boolean;
  mass: number;
  friction: number;
  restitution: number;
  interactionZones?: string[];
}

export interface JointState {
  name: string;
  x: number;
  y: number;
  z: number;
  angularVelocity: number;
}

export type CameraMode = 'third_person' | 'first_person' | 'model_input';
