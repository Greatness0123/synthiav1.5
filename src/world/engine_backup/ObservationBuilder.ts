/**
 * ObservationBuilder — Local-Frame State Vectors for AI Proprioception
 *
 * Computes physics-state observation vectors in local coordinates, making
 * them translation-invariant and yaw-invariant. Produces both a raw
 * Float32Array for physics control and a VLM-friendly JSON format with
 * rolling temporal history.
 *
 * Based on ProtoMotion humanoid observation pattern:
 *   - Projected gravity vector (world gravity rotated into root local frame)
 *   - Local angular/linear velocity (world velocities rotated into root frame)
 *   - Joint angles (from Rapier impulse joint angle getters)
 *   - Joint velocities (finite differenced from consecutive angle measurements)
 *   - Root height above ground
 *
 * Rapier v0.19 limitation: RevoluteJoint does not expose velocity directly.
 * Joint velocities are computed via finite differencing: θ̇ ≈ (θ_t - θ_{t-1}) / Δt
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { logger as Logger } from '../../utils/logger';

// ── Key bone names for VLM proprioception (subset of 15 major bones) ──
export const VLM_KEY_JOINTS = [
  'pelvis', 'torso', 'neck', 'head',
  'left_shoulder', 'left_elbow',
  'right_shoulder', 'right_elbow',
  'left_hip', 'left_knee', 'left_ankle',
  'right_hip', 'right_knee', 'right_ankle',
] as const;

export type VLMJointName = typeof VLM_KEY_JOINTS[number];

// ── Raw observation vector layout ──
// [rootHeight, gravX, gravY, gravZ, linVelX, linVelY, linVelZ,
//  angVelX, angVelY, angVelZ, jointAngle0, jointAngle1, ..., jointVel0, jointVel1, ...]
export interface ObservationLayout {
  rootHeightIndex: number;      // 0
  gravityIndex: number;         // 1
  localLinVelIndex: number;     // 4
  localAngVelIndex: number;     // 7
  jointAnglesIndex: number;     // 10
  jointVelocitiesIndex: number; // 10 + N_joints
  totalSize: number;            // 10 + 2 * N_joints
}

// ── VLM-friendly proprioception JSON ──
export interface VLMProprioception {
  joints_subset: string[];
  current_pose: number[];       // Euler degrees for key joints + pelvis XYZ
  rolling_history: Array<{ hb: number; pose: number[] }>;
  root_height: number;
  projected_gravity: [number, number, number];
  local_angular_velocity: [number, number, number];
  local_linear_velocity: [number, number, number];
}

// ── Temporaries to avoid per-frame allocation ──
const _tempQuat = new THREE.Quaternion();
const _tempInvQuat = new THREE.Quaternion();
const _tempGrav = new THREE.Vector3(0, -1, 0);
const _tempVec3 = new THREE.Vector3();
const _tempEuler = new THREE.Euler();

export class ObservationBuilder {
  // Joint name → { body, parentBody (for local frame computation) }
  private jointBodies: Map<string, { body: RAPIER.RigidBody; parentBody: RAPIER.RigidBody | null }> = new Map();
  private jointOrder: string[] = [];
  private groundHeight = 0;

  // Finite differencing buffers for joint velocity
  private prevJointAngles: Map<string, number> = new Map();
  private prevTime = 0;
  private jointVelocities: Map<string, number> = new Map();

  // Rolling history for VLM (last N frames)
  private rollingHistory: Array<{ hb: number; pose: number[] }> = [];
  private maxHistoryLength = 3;
  private heartbeat = 0;

  // Layout cache
  private layout: ObservationLayout | null = null;

  /**
   * Register a joint with its rigid body and optional parent body.
   * The parent body is used to compute local-frame relative rotations.
   */
  public registerJoint(
    name: string,
    body: RAPIER.RigidBody,
    parentBody: RAPIER.RigidBody | null
  ): void {
    this.jointBodies.set(name, { body, parentBody });
    this.jointOrder.push(name);
    this.layout = null; // Invalidate layout cache
  }

  /**
   * Clear all registered joints (e.g., on model rebuild).
   */
  public clear(): void {
    this.jointBodies.clear();
    this.jointOrder = [];
    this.prevJointAngles.clear();
    this.jointVelocities.clear();
    this.rollingHistory = [];
    this.layout = null;
  }

  /**
   * Set ground plane height for root height calculation.
   */
  public setGroundHeight(height: number): void {
    this.groundHeight = height;
  }

  /**
   * Get the observation layout (indices into the flat Float32Array).
   */
  public getLayout(): ObservationLayout {
    if (!this.layout) {
      const n = this.jointOrder.length;
      this.layout = {
        rootHeightIndex: 0,
        gravityIndex: 1,
        localLinVelIndex: 4,
        localAngVelIndex: 7,
        jointAnglesIndex: 10,
        jointVelocitiesIndex: 10 + n,
        totalSize: 10 + 2 * n,
      };
    }
    return this.layout;
  }

  /**
   * Build the raw observation vector from current physics state.
   *
   * Layout: [rootHeight, gravX, gravY, gravZ, linVelX, linVelY, linVelZ,
   *          angVelX, angVelY, angVelZ, jointAngle0, ..., jointVel0, ...]
   *
   * All vectors are in the root body's local frame (yaw-invariant).
   */
  public buildObservation(rootBody: RAPIER.RigidBody, dt: number): Float32Array {
    const layout = this.getLayout();
    const obs = new Float32Array(layout.totalSize);

    // ── Root body state ──
    const translation = rootBody.translation();
    const rotation = rootBody.rotation();
    const linvel = rootBody.linvel();
    const angvel = rootBody.angvel();

    const rootQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const invRootQuat = _tempInvQuat.copy(rootQuat).invert();

    // ── Root height above ground ──
    obs[layout.rootHeightIndex] = translation.y - this.groundHeight;

    // ── Projected gravity (world [0,-1,0] rotated into root local frame) ──
    const projGrav = _tempGrav.set(0, -1, 0).applyQuaternion(invRootQuat);
    obs[layout.gravityIndex] = projGrav.x;
    obs[layout.gravityIndex + 1] = projGrav.y;
    obs[layout.gravityIndex + 2] = projGrav.z;

    // ── Local linear velocity (world velocity rotated into root frame) ──
    const localLinVel = _tempVec3.set(linvel.x, linvel.y, linvel.z).applyQuaternion(invRootQuat);
    obs[layout.localLinVelIndex] = localLinVel.x;
    obs[layout.localLinVelIndex + 1] = localLinVel.y;
    obs[layout.localLinVelIndex + 2] = localLinVel.z;

    // ── Local angular velocity (world angular velocity rotated into root frame) ──
    const localAngVel = _tempVec3.set(angvel.x, angvel.y, angvel.z).applyQuaternion(invRootQuat);
    obs[layout.localAngVelIndex] = localAngVel.x;
    obs[layout.localAngVelIndex + 1] = localAngVel.y;
    obs[layout.localAngVelIndex + 2] = localAngVel.z;

    // ── Joint angles and velocities ──
    const currentTime = this.prevTime + dt;
    for (let i = 0; i < this.jointOrder.length; i++) {
      const name = this.jointOrder[i];
      const jointData = this.jointBodies.get(name);
      if (!jointData) continue;

      // Compute local-frame joint angle from relative rotation
      const angle = this.computeJointAngle(jointData.body, jointData.parentBody, rootQuat);
      obs[layout.jointAnglesIndex + i] = angle;

      // Finite differencing for velocity
      const prevAngle = this.prevJointAngles.get(name);
      if (prevAngle !== undefined && dt > 0) {
        let delta = angle - prevAngle;
        // Normalize to [-π, π]
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        const vel = delta / dt;
        this.jointVelocities.set(name, vel);
        obs[layout.jointVelocitiesIndex + i] = vel;
      }

      this.prevJointAngles.set(name, angle);
    }

    this.prevTime = currentTime;
    this.heartbeat++;

    return obs;
  }

  /**
   * Compute a single joint's angle from the relative rotation between
   * its body and parent body, projected into the root local frame.
   * Returns a scalar angle (primary axis of rotation).
   */
  private computeJointAngle(
    body: RAPIER.RigidBody,
    parentBody: RAPIER.RigidBody | null,
    rootQuat: THREE.Quaternion
  ): number {
    const bodyRot = body.rotation();
    const bodyQuat = new THREE.Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);

    if (!parentBody || !parentBody.isValid()) {
      // Root body: return pitch angle in local frame
      const localQuat = _tempQuat.copy(rootQuat).invert().multiply(bodyQuat);
      _tempEuler.setFromQuaternion(localQuat, 'XYZ');
      return _tempEuler.x;
    }

    const parentRot = parentBody.rotation();
    const parentQuat = new THREE.Quaternion(parentRot.x, parentRot.y, parentRot.z, parentRot.w);

    // Relative rotation in parent's local frame
    _tempQuat.copy(parentQuat).invert().multiply(bodyQuat);
    _tempEuler.setFromQuaternion(_tempQuat, 'XYZ');

    // Return primary axis (X for revolute pitch joints, Y for yaw, Z for roll)
    // Most humanoid joints are pitch (X-axis), so we default to X
    return _tempEuler.x;
  }

  /**
   * Build VLM-friendly proprioception JSON with rolling history.
   * Selects only key joints, converts to Euler degrees, includes pelvis position.
   */
  public buildVLMProprioception(rootBody: RAPIER.RigidBody): VLMProprioception {
    const translation = rootBody.translation();
    const rotation = rootBody.rotation();
    const linvel = rootBody.linvel();
    const angvel = rootBody.angvel();

    const rootQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const invRootQuat = _tempInvQuat.copy(rootQuat).invert();

    // Build current pose: [pelvisX, pelvisY, pelvisZ, joint0_deg, joint1_deg, ...]
    const pose: number[] = [
      parseFloat(translation.x.toFixed(3)),
      parseFloat(translation.y.toFixed(3)),
      parseFloat(translation.z.toFixed(3)),
    ];

    for (const jointName of VLM_KEY_JOINTS) {
      if (jointName === 'pelvis') continue; // Already included as position
      const jointData = this.jointBodies.get(jointName);
      if (jointData) {
        const angle = this.computeJointAngle(jointData.body, jointData.parentBody, rootQuat);
        pose.push(parseFloat((angle * (180 / Math.PI)).toFixed(1))); // Convert to degrees
      } else {
        pose.push(0);
      }
    }

    // Projected gravity
    const projGrav = _tempGrav.set(0, -1, 0).applyQuaternion(invRootQuat);

    // Local velocities
    const localLinVel = _tempVec3.set(linvel.x, linvel.y, linvel.z).applyQuaternion(invRootQuat);
    const llv: [number, number, number] = [
      parseFloat(localLinVel.x.toFixed(3)),
      parseFloat(localLinVel.y.toFixed(3)),
      parseFloat(localLinVel.z.toFixed(3)),
    ];

    const localAngVel = _tempVec3.set(angvel.x, angvel.y, angvel.z).applyQuaternion(invRootQuat);
    const lav: [number, number, number] = [
      parseFloat(localAngVel.x.toFixed(3)),
      parseFloat(localAngVel.y.toFixed(3)),
      parseFloat(localAngVel.z.toFixed(3)),
    ];

    // Update rolling history
    this.rollingHistory.push({ hb: this.heartbeat, pose: [...pose] });
    if (this.rollingHistory.length > this.maxHistoryLength) {
      this.rollingHistory.shift();
    }

    return {
      joints_subset: [...VLM_KEY_JOINTS],
      current_pose: pose,
      rolling_history: [...this.rollingHistory],
      root_height: parseFloat((translation.y - this.groundHeight).toFixed(3)),
      projected_gravity: [
        parseFloat(projGrav.x.toFixed(3)),
        parseFloat(projGrav.y.toFixed(3)),
        parseFloat(projGrav.z.toFixed(3)),
      ],
      local_angular_velocity: lav,
      local_linear_velocity: llv,
    };
  }

  /**
   * Get the raw joint angles map (for compatibility with existing systems).
   */
  public getJointAngles(): Map<string, number> {
    return new Map(this.prevJointAngles);
  }

  /**
   * Get the computed joint velocities map.
   */
  public getJointVelocities(): Map<string, number> {
    return new Map(this.jointVelocities);
  }

  /**
   * Get the current heartbeat counter.
   */
  public getHeartbeat(): number {
    return this.heartbeat;
  }
}
