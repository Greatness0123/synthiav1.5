import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RapierJointMotorController, JointMotorConfig } from './RapierJointMotorController';
import { ProceduralBuildResult } from './ProceduralHumanoidBuilder';
import { logger as Logger } from '../../utils/logger';
import SYNTHIA_RIG_CONSTRAINTS from '../../constants/rigConstraints';

const _tempQuat = new THREE.Quaternion();
const _tempQuat2 = new THREE.Quaternion();
const _tempQuat3 = new THREE.Quaternion();
const _tempVec3 = new THREE.Vector3();
const _tempVec32 = new THREE.Vector3();

interface PDGains {
  stiffness: number;
  damping: number;
}

const PROCEDURAL_PD_GAINS: Record<string, PDGains> = {
  'pelvis':   { stiffness: 200, damping: 20 },
  'torso':    { stiffness: 180, damping: 18 },
  'chest':    { stiffness: 150, damping: 15 },
  'neck':     { stiffness: 100, damping: 10 },
  'head':     { stiffness: 80,  damping: 8 },

  'left_shoulder':  { stiffness: 100, damping: 10 },
  'left_elbow':    { stiffness: 80,  damping: 8 },
  'left_wrist':    { stiffness: 50,  damping: 5 },
  'right_shoulder': { stiffness: 100, damping: 10 },
  'right_elbow':   { stiffness: 80,  damping: 8 },
  'right_wrist':   { stiffness: 50,  damping: 5 },

  'left_hip':   { stiffness: 250, damping: 25 },
  'left_knee':  { stiffness: 250, damping: 25 },
  'left_ankle': { stiffness: 150, damping: 15 },
  'right_hip':  { stiffness: 250, damping: 25 },
  'right_knee': { stiffness: 250, damping: 25 },
  'right_ankle':{ stiffness: 150, damping: 15 },
};

type JointType = 'revolute' | 'spherical';
const PROCEDURAL_JOINT_TYPES: Record<string, JointType> = {
  'pelvis':      'spherical',
  'torso':       'revolute',
  'chest':       'revolute',
  'neck':        'spherical',
  'head':        'spherical',
  'left_shoulder':  'spherical',
  'left_elbow':     'revolute',
  'left_wrist':     'spherical',
  'right_shoulder': 'spherical',
  'right_elbow':    'revolute',
  'right_wrist':    'spherical',
  'left_hip':       'spherical',
  'left_knee':      'revolute',
  'left_ankle':     'spherical',
  'right_hip':      'spherical',
  'right_knee':     'revolute',
  'right_ankle':    'spherical',
};

const PROCEDURAL_HIERARCHY: Array<{ name: string; parent: string | null }> = [
  { name: 'pelvis', parent: null },
  { name: 'torso', parent: 'pelvis' },
  { name: 'chest', parent: 'torso' },
  { name: 'neck', parent: 'chest' },
  { name: 'head', parent: 'neck' },
  { name: 'left_shoulder', parent: 'chest' },
  { name: 'left_elbow', parent: 'left_shoulder' },
  { name: 'left_wrist', parent: 'left_elbow' },
  { name: 'right_shoulder', parent: 'chest' },
  { name: 'right_elbow', parent: 'right_shoulder' },
  { name: 'right_wrist', parent: 'right_elbow' },
  { name: 'left_hip', parent: 'pelvis' },
  { name: 'left_knee', parent: 'left_hip' },
  { name: 'left_ankle', parent: 'left_knee' },
  { name: 'right_hip', parent: 'pelvis' },
  { name: 'right_knee', parent: 'right_hip' },
  { name: 'right_ankle', parent: 'right_knee' },
];

export class ProceduralMotorController {
  private motorController: RapierJointMotorController;
  private rigidBodiesMap: Map<string, RAPIER.RigidBody>;
  private jointsMap: Map<string, RAPIER.ImpulseJoint>;
  private globalStiffnessScale = 1.0;
  private globalDampingScale = 1.0;

  constructor() {
    this.motorController = new RapierJointMotorController();
    this.rigidBodiesMap = new Map();
    this.jointsMap = new Map();
  }

  public init(buildResult: ProceduralBuildResult): void {
    this.rigidBodiesMap = buildResult.rigidBodiesMap;
    this.jointsMap = buildResult.jointsMap;

    const motorConfigs: JointMotorConfig[] = [];

    for (const [name, joint] of this.jointsMap) {
      const gains = PROCEDURAL_PD_GAINS[name] ?? { stiffness: 100, damping: 10 };
      const jointType = PROCEDURAL_JOINT_TYPES[name] ?? 'spherical';

      const constraint = SYNTHIA_RIG_CONSTRAINTS[name];
      let limits: [number, number] | undefined;
      if (constraint && constraint.dof === 1) {
        limits = [constraint.x[0], constraint.x[1]];
      }

      motorConfigs.push({
        name,
        joint,
        jointType: jointType === 'revolute' ? RAPIER.JointType.Revolute : RAPIER.JointType.Spherical,
        stiffness: gains.stiffness,
        damping: gains.damping,
        axisIndex: 0,
        dof: jointType === 'revolute' ? 1 : 3,
        limits,
        targetAngle: 0,
      });
    }

    this.motorController.registerJoints(motorConfigs);

    this.motorController.getJointNames().forEach((name) => {
      this.motorController.setTargetAngle(name, 0);
    });

    Logger.info(`ProceduralMotorController: Initialized with ${motorConfigs.length} motor joints`);
  }

  public setTargets(currentTargets: Map<string, any>): void {
    currentTargets.forEach((parsedTarget, canonical) => {
      const rigidBody = this.rigidBodiesMap.get(canonical);
      const joint = this.jointsMap.get(canonical);
      if (!rigidBody || !rigidBody.isValid()) return;

      const jointType = PROCEDURAL_JOINT_TYPES[canonical];
      const gains = PROCEDURAL_PD_GAINS[canonical] ?? { stiffness: 100, damping: 10 };

      if (jointType === 'revolute' && joint) {

        let targetAngle = 0;
        if (parsedTarget.isScalar && typeof parsedTarget.scalar === 'number') {
          targetAngle = parsedTarget.scalar;
        } else if (parsedTarget.x !== undefined && typeof parsedTarget.x === 'number') {
          targetAngle = parsedTarget.x;
        }

        const constraint = SYNTHIA_RIG_CONSTRAINTS[canonical];
        if (constraint && constraint.dof === 1) {
          targetAngle = Math.max(constraint.x[0], Math.min(constraint.x[1], targetAngle));
        }
        this.motorController.setTargetAngle(canonical, targetAngle);

      } else if (jointType === 'spherical') {

        const targetEulerX = (parsedTarget.isScalar && typeof parsedTarget.scalar === 'number')
          ? parsedTarget.scalar : (parsedTarget.x || 0);
        const targetEulerY = (parsedTarget.x !== undefined) ? (parsedTarget.y || 0) : 0;
        const targetEulerZ = (parsedTarget.x !== undefined) ? (parsedTarget.z || 0) : 0;

        const hierarchyEntry = PROCEDURAL_HIERARCHY.find(h => h.name === canonical);
        const parentName = hierarchyEntry?.parent;
        const parentBody = parentName ? this.rigidBodiesMap.get(parentName) : null;
        if (!parentBody || !parentBody.isValid()) return;

        const childRot = rigidBody.rotation();
        const parentRot = parentBody.rotation();
        const childQuat = _tempQuat.set(childRot.x, childRot.y, childRot.z, childRot.w);
        const parentQuat = _tempQuat2.set(parentRot.x, parentRot.y, parentRot.z, parentRot.w);

        const currentRelQuat = _tempQuat3.copy(parentQuat).invert().multiply(childQuat);

        const targetRelQuat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(targetEulerX, targetEulerY, targetEulerZ, 'XYZ')
        );

        const errorQuat = _tempQuat.copy(targetRelQuat).multiply(currentRelQuat.clone().invert());
        errorQuat.normalize();

        if (errorQuat.w < 0) {
          errorQuat.x = -errorQuat.x;
          errorQuat.y = -errorQuat.y;
          errorQuat.z = -errorQuat.z;
          errorQuat.w = -errorQuat.w;
        }

        const errorAxis = _tempVec32.set(errorQuat.x, errorQuat.y, errorQuat.z);
        const sinHalf = errorAxis.length();
        if (sinHalf > 1e-6) {
          const errorAngle = 2 * Math.atan2(sinHalf, errorQuat.w);
          errorAxis.divideScalar(sinHalf);

          const angVel = rigidBody.angvel();
          const localAngVel = _tempVec3.set(angVel.x, angVel.y, angVel.z)
            .applyQuaternion(parentQuat.clone().invert());

          const stiffness = gains.stiffness * this.globalStiffnessScale;
          const damping = gains.damping * this.globalDampingScale;

          const torque = _tempVec3.set(
            stiffness * errorAxis.x * errorAngle - damping * localAngVel.x,
            stiffness * errorAxis.y * errorAngle - damping * localAngVel.y,
            stiffness * errorAxis.z * errorAngle - damping * localAngVel.z
          );

          const MAX_TORQUE = 50.0;
          if (torque.length() > MAX_TORQUE) torque.setLength(MAX_TORQUE);

          rigidBody.addTorque(torque.applyQuaternion(parentQuat), true);
        }
      }
    });
  }

  public setTargetAngle(name: string, angle: number): void {
    this.motorController.setTargetAngle(name, angle);
  }

  public setGainScale(stiffnessScale: number, dampingScale: number): void {
    this.globalStiffnessScale = Math.max(0.01, stiffnessScale);
    this.globalDampingScale = Math.max(0.01, dampingScale);

    this.motorController.getJointNames().forEach((name) => {
      const base = PROCEDURAL_PD_GAINS[name];
      if (base) {
        this.motorController.setGains(
          name,
          base.stiffness * this.globalStiffnessScale,
          base.damping * this.globalDampingScale
        );
      }
    });
  }

  public setLimpMode(limp: boolean): void {
    this.motorController.setLimpMode(limp);
  }

  public resetTargets(): void {
    this.motorController.getJointNames().forEach((name) => {
      this.motorController.setTargetAngle(name, 0);
    });
  }

  public getMotorController(): RapierJointMotorController {
    return this.motorController;
  }
}
