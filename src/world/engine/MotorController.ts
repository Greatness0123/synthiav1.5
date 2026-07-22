import * as THREE from 'three';
import { PhysicsEngine } from './PhysicsEngine';
import { logger as Logger } from '../../utils/logger';

export class MotorController {
  private model: any = null;
  private data: any = null;
  private actuatorMap: Map<string, number[]> = new Map(); // boneName -> [actuatorIds]
  private baseGains: Map<number, { kp: number; kv: number }> = new Map(); // actuatorId -> gains

  private globalStiffnessScale = 1.0;
  private globalDampingScale = 1.0;
  private limpModeActive = false;
  private simulationStepCount = 0;

  constructor() {}

  public init(actuatorMap: Map<string, number[]>, model: any, data: any): void {
    this.model = model;
    this.data = data;
    this.actuatorMap = actuatorMap;

    this.baseGains.clear();
    for (let i = 0; i < model.nu; i++) {
      // position actuators store kp in actuator_gainprm[i*3] and -kv in actuator_biasprm[i*3+2]
      const kp = model.actuator_gainprm[i * 3];
      const kv = -model.actuator_biasprm[i * 3 + 2];
      this.baseGains.set(i, { kp, kv });
    }

    this.globalStiffnessScale = 1.0;
    this.globalDampingScale = 1.0;
    this.limpModeActive = false;
    this.simulationStepCount = 0;

    Logger.info(`MotorController: Initialized with ${model.nu} actuators.`);
  }

  public resetRamp(): void {
    this.simulationStepCount = 0;
  }

  public setTargets(currentTargets: Map<string, any>): void {
    if (!this.model || !this.data) return;

    const ctrl = this.data.ctrl;

    // Reset all controls to 0 by default
    for (let i = 0; i < this.model.nu; i++) {
      ctrl[i] = 0;
    }

    if (this.limpModeActive) return;

    const rampFactor = Math.min(1.0, this.simulationStepCount / 20);
    this.simulationStepCount++;

    currentTargets.forEach((parsedTarget, boneName) => {
      const actuatorIds = this.actuatorMap.get(boneName);
      if (!actuatorIds || actuatorIds.length === 0) return;

      if (actuatorIds.length === 1) {
        // Revolute joint (e.g. knees, elbows) -> Single pitch actuator
        let targetAngle = 0;
        if (parsedTarget.isScalar && typeof parsedTarget.scalar === 'number') {
          targetAngle = parsedTarget.scalar;
        } else if (parsedTarget.x !== undefined && typeof parsedTarget.x === 'number') {
          targetAngle = parsedTarget.x;
        }
        ctrl[actuatorIds[0]] = targetAngle * rampFactor;
      } else if (actuatorIds.length === 3) {
        // Spherical joint decomposed into yaw, pitch, roll
        // Index 0: yaw, Index 1: pitch, Index 2: roll
        let yaw = 0;
        let pitch = 0;
        let roll = 0;

        if (parsedTarget.isScalar && typeof parsedTarget.scalar === 'number') {
          pitch = parsedTarget.scalar;
        } else if (parsedTarget.x !== undefined) {
          yaw = parsedTarget.z || 0;
          pitch = parsedTarget.x || 0;
          roll = parsedTarget.y || 0;
        }

        ctrl[actuatorIds[0]] = yaw * rampFactor;
        ctrl[actuatorIds[1]] = pitch * rampFactor;
        ctrl[actuatorIds[2]] = roll * rampFactor;
      }
    });
  }

  public setTargetAngle(boneName: string, angle: number): void {
    if (!this.model || !this.data || this.limpModeActive) return;
    const actuatorIds = this.actuatorMap.get(boneName);
    if (!actuatorIds || actuatorIds.length === 0) return;

    const rampFactor = Math.min(1.0, this.simulationStepCount / 20);
    // Direct assignment to pitch or first actuator
    this.data.ctrl[actuatorIds[0]] = angle * rampFactor;
  }

  public setGainScale(stiffnessScale: number, dampingScale: number): void {
    this.globalStiffnessScale = Math.max(0.01, stiffnessScale);
    this.globalDampingScale = Math.max(0.01, dampingScale);

    if (this.limpModeActive) return;

    this.applyGainsToModel();
  }

  public setLimpMode(active: boolean): void {
    this.limpModeActive = active;

    if (!this.model || !this.data) return;

    if (active) {
      // Zero out all actuator gains for passive ragdoll
      for (let i = 0; i < this.model.nu; i++) {
        this.model.actuator_gainprm[i * 3] = 0;
        this.model.actuator_biasprm[i * 3 + 1] = 0;
        this.model.actuator_biasprm[i * 3 + 2] = 0;
        this.data.ctrl[i] = 0;
      }
      Logger.info('MotorController: Limp mode activated. All gains zeroed.');
    } else {
      // Restore standard scaled gains
      this.applyGainsToModel();
      Logger.info('MotorController: Limp mode deactivated. Gains restored.');
    }
  }

  private applyGainsToModel(): void {
    if (!this.model) return;

    for (let i = 0; i < this.model.nu; i++) {
      const base = this.baseGains.get(i);
      if (base) {
        const kp = base.kp * this.globalStiffnessScale;
        const kv = base.kv * this.globalDampingScale;

        this.model.actuator_gainprm[i * 3] = kp;
        this.model.actuator_biasprm[i * 3 + 1] = -kp;
        this.model.actuator_biasprm[i * 3 + 2] = -kv;
      }
    }
  }

  public getJointCount(): number {
    return this.actuatorMap.size;
  }

  public applyCapsuleBalance(capsuleBodyId: number): void {
    if (!this.model || !this.data || capsuleBodyId < 0) return;

    const xquat = this.data.xquat;
    const qW = xquat[capsuleBodyId * 4];
    const qX = xquat[capsuleBodyId * 4 + 1];
    const qY = xquat[capsuleBodyId * 4 + 2];
    const qZ = xquat[capsuleBodyId * 4 + 3];

    // Convert MuJoCo scalar-first orientation of capsule to Three.js coordinates
    const threeQuatObj = PhysicsEngine.mujocoQuatToThree([qW, qX, qY, qZ]);
    const q = new THREE.Quaternion(threeQuatObj.x, threeQuatObj.y, threeQuatObj.z, threeQuatObj.w);

    // Compute upright balance error relative to world vertical axis (0, 1, 0)
    const capsuleUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const tiltAngle = Math.acos(Math.min(1, Math.max(-1, capsuleUp.y)));

    const tiltAxis = new THREE.Vector3();
    if (tiltAngle > 1e-5) {
      tiltAxis.set(-capsuleUp.z, 0, capsuleUp.x).normalize();
    }

    // Get angular velocity in Three.js/world frame
    const dofAdr = this.model.body_dofadr[capsuleBodyId];
    const qvel = this.data.qvel;
    const angVelMj: [number, number, number] = [
      qvel[dofAdr + 3],
      qvel[dofAdr + 4],
      qvel[dofAdr + 5]
    ];
    const angVelWorld = PhysicsEngine.mujocoToWorld(angVelMj);

    // Scale balancing gains dynamically
    const BALANCE_KP = 100.0 * this.globalStiffnessScale;
    const BALANCE_KD = 40.0 * this.globalDampingScale;

    // Upright balancing torque in Three.js/world space
    const torqueWorld = new THREE.Vector3(
      BALANCE_KP * tiltAxis.x * tiltAngle - BALANCE_KD * angVelWorld.x,
      BALANCE_KP * tiltAxis.y * tiltAngle - BALANCE_KD * angVelWorld.y,
      BALANCE_KP * tiltAxis.z * tiltAngle - BALANCE_KD * angVelWorld.z
    );

    // Clamp balancing torque at 60.0 (matching Rapier clamp in HumanoidMultiBodyManager.ts)
    const torqueMag = torqueWorld.length();
    const MAX_BALANCE_TORQUE = 60.0;
    if (torqueMag > MAX_BALANCE_TORQUE) {
      torqueWorld.multiplyScalar(MAX_BALANCE_TORQUE / torqueMag);
    }

    // Convert balancing torque back to MuJoCo coordinate system
    const torqueMj = PhysicsEngine.worldToMuJoCo(torqueWorld);

    // Apply directly into xfrc_applied for the capsule body
    const xfrc = this.data.xfrc_applied;
    const idx = capsuleBodyId * 6;
    xfrc[idx + 0] = 0;
    xfrc[idx + 1] = 0;
    xfrc[idx + 2] = 0;
    xfrc[idx + 3] = torqueMj[0];
    xfrc[idx + 4] = torqueMj[1];
    xfrc[idx + 5] = torqueMj[2];
  }
}
