import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { logger as Logger } from '../../utils/logger';

export const VLM_KEY_JOINTS = [
  'pelvis', 'torso', 'neck', 'head',
  'left_shoulder', 'left_elbow',
  'right_shoulder', 'right_elbow',
  'left_hip', 'left_knee', 'left_ankle',
  'right_hip', 'right_knee', 'right_ankle',
] as const;

export type VLMJointName = typeof VLM_KEY_JOINTS[number];

export interface ObservationLayout {
  rootHeightIndex: number;      
  gravityIndex: number;         
  localLinVelIndex: number;     
  localAngVelIndex: number;     
  jointAnglesIndex: number;     
  jointVelocitiesIndex: number; 
  totalSize: number;            
}

export interface VLMProprioception {
  joints_subset: string[];
  current_pose: number[];       
  rolling_history: Array<{ hb: number; pose: number[] }>;
  root_height: number;
  projected_gravity: [number, number, number];
  local_angular_velocity: [number, number, number];
  local_linear_velocity: [number, number, number];
}

const _tempQuat = new THREE.Quaternion();
const _tempInvQuat = new THREE.Quaternion();
const _tempGrav = new THREE.Vector3(0, -1, 0);
const _tempVec3 = new THREE.Vector3();
const _tempEuler = new THREE.Euler();

export class ObservationBuilder {

  private jointBodies: Map<string, { body: RAPIER.RigidBody; parentBody: RAPIER.RigidBody | null }> = new Map();
  private jointOrder: string[] = [];
  private groundHeight = 0;

  private prevJointAngles: Map<string, number> = new Map();
  private prevTime = 0;
  private jointVelocities: Map<string, number> = new Map();

  private rollingHistory: Array<{ hb: number; pose: number[] }> = [];
  private maxHistoryLength = 3;
  private heartbeat = 0;

  private layout: ObservationLayout | null = null;

  public registerJoint(
    name: string,
    body: RAPIER.RigidBody,
    parentBody: RAPIER.RigidBody | null
  ): void {
    this.jointBodies.set(name, { body, parentBody });
    this.jointOrder.push(name);
    this.layout = null; 
  }

  public clear(): void {
    this.jointBodies.clear();
    this.jointOrder = [];
    this.prevJointAngles.clear();
    this.jointVelocities.clear();
    this.rollingHistory = [];
    this.layout = null;
  }

  public setGroundHeight(height: number): void {
    this.groundHeight = height;
  }

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

  public buildObservation(rootBody: RAPIER.RigidBody, dt: number): Float32Array {
    const layout = this.getLayout();
    const obs = new Float32Array(layout.totalSize);

    const translation = rootBody.translation();
    const rotation = rootBody.rotation();
    const linvel = rootBody.linvel();
    const angvel = rootBody.angvel();

    const rootQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const invRootQuat = _tempInvQuat.copy(rootQuat).invert();

    obs[layout.rootHeightIndex] = translation.y - this.groundHeight;

    const projGrav = _tempGrav.set(0, -1, 0).applyQuaternion(invRootQuat);
    obs[layout.gravityIndex] = projGrav.x;
    obs[layout.gravityIndex + 1] = projGrav.y;
    obs[layout.gravityIndex + 2] = projGrav.z;

    const localLinVel = _tempVec3.set(linvel.x, linvel.y, linvel.z).applyQuaternion(invRootQuat);
    obs[layout.localLinVelIndex] = localLinVel.x;
    obs[layout.localLinVelIndex + 1] = localLinVel.y;
    obs[layout.localLinVelIndex + 2] = localLinVel.z;

    const localAngVel = _tempVec3.set(angvel.x, angvel.y, angvel.z).applyQuaternion(invRootQuat);
    obs[layout.localAngVelIndex] = localAngVel.x;
    obs[layout.localAngVelIndex + 1] = localAngVel.y;
    obs[layout.localAngVelIndex + 2] = localAngVel.z;

    const currentTime = this.prevTime + dt;
    for (let i = 0; i < this.jointOrder.length; i++) {
      const name = this.jointOrder[i];
      const jointData = this.jointBodies.get(name);
      if (!jointData) continue;

      const angle = this.computeJointAngle(jointData.body, jointData.parentBody, rootQuat);
      obs[layout.jointAnglesIndex + i] = angle;

      const prevAngle = this.prevJointAngles.get(name);
      if (prevAngle !== undefined && dt > 0) {
        let delta = angle - prevAngle;

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

  private computeJointAngle(
    body: RAPIER.RigidBody,
    parentBody: RAPIER.RigidBody | null,
    rootQuat: THREE.Quaternion
  ): number {
    const bodyRot = body.rotation();
    const bodyQuat = new THREE.Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);

    if (!parentBody || !parentBody.isValid()) {

      const localQuat = _tempQuat.copy(rootQuat).invert().multiply(bodyQuat);
      _tempEuler.setFromQuaternion(localQuat, 'XYZ');
      return _tempEuler.x;
    }

    const parentRot = parentBody.rotation();
    const parentQuat = new THREE.Quaternion(parentRot.x, parentRot.y, parentRot.z, parentRot.w);

    _tempQuat.copy(parentQuat).invert().multiply(bodyQuat);
    _tempEuler.setFromQuaternion(_tempQuat, 'XYZ');

    return _tempEuler.x;
  }

  public buildVLMProprioception(rootBody: RAPIER.RigidBody): VLMProprioception {
    const translation = rootBody.translation();
    const rotation = rootBody.rotation();
    const linvel = rootBody.linvel();
    const angvel = rootBody.angvel();

    const rootQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const invRootQuat = _tempInvQuat.copy(rootQuat).invert();

    const pose: number[] = [
      parseFloat(translation.x.toFixed(3)),
      parseFloat(translation.y.toFixed(3)),
      parseFloat(translation.z.toFixed(3)),
    ];

    for (const jointName of VLM_KEY_JOINTS) {
      if (jointName === 'pelvis') continue; 
      const jointData = this.jointBodies.get(jointName);
      if (jointData) {
        const angle = this.computeJointAngle(jointData.body, jointData.parentBody, rootQuat);
        pose.push(parseFloat((angle * (180 / Math.PI)).toFixed(1))); 
      } else {
        pose.push(0);
      }
    }

    const projGrav = _tempGrav.set(0, -1, 0).applyQuaternion(invRootQuat);

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

  public getJointAngles(): Map<string, number> {
    return new Map(this.prevJointAngles);
  }

  public getJointVelocities(): Map<string, number> {
    return new Map(this.jointVelocities);
  }

  public getHeartbeat(): number {
    return this.heartbeat;
  }
}
