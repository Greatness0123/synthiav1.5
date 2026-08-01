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
  /** True while a gait timeline is active — softens root balance torque. */
  private gaitActive = false;

  // Diagnostics (read externally via PhysicsDiagnostic)
  public lastBalanceTorqueMag: number = 0;
  public lastBalanceTiltRad: number = 0;

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
    this.gaitActive = false;

    Logger.info(`MotorController: Initialized with ${model.nu} actuators.`);
  }

  public resetRamp(): void {
    this.simulationStepCount = 0;
  }

  /** Enabled while a gait timeline is active — softens root balance torque. */
  public setGaitActive(active: boolean): void {
    this.gaitActive = active;
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
        // MJCF actuator order: [yaw(axis 0 0 1), pitch(axis 1 0 0), roll(axis 0 1 0)]
        // LLM sends [x=pitch, y=yaw, z=roll] as Array or {x, y, z}
        let yaw = 0;
        let pitch = 0;
        let roll = 0;

        if (parsedTarget.isScalar && typeof parsedTarget.scalar === 'number') {
          pitch = parsedTarget.scalar;
        } else if (parsedTarget.x !== undefined) {
          yaw = parsedTarget.y || 0;   // Y → Yaw (LLM's y = yaw axis)
          pitch = parsedTarget.x || 0;  // X → Pitch (LLM's x = pitch axis)
          roll = parsedTarget.z || 0;   // Z → Roll (LLM's z = roll axis)
        }

        ctrl[actuatorIds[0]] = Number.isFinite(yaw) ? yaw * rampFactor : 0;
        ctrl[actuatorIds[1]] = Number.isFinite(pitch) ? pitch * rampFactor : 0;
        ctrl[actuatorIds[2]] = Number.isFinite(roll) ? roll * rampFactor : 0;
      }
    });
  }

  public setTargetAngle(boneName: string, angle: number): void {
    if (!this.model || !this.data || this.limpModeActive) return;
    const actuatorIds = this.actuatorMap.get(boneName);
    if (!actuatorIds || actuatorIds.length === 0) return;

    const rampFactor = Math.min(1.0, this.simulationStepCount / 20);
    // Direct assignment to pitch or first actuator
    const val = Number.isFinite(angle) ? angle * rampFactor : 0;
    this.data.ctrl[actuatorIds[0]] = val;
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

    for (const [actuatorId, gains] of this.baseGains) {
      this.model.actuator_gainprm[actuatorId * 3] = gains.kp * this.globalStiffnessScale;
      this.model.actuator_biasprm[actuatorId * 3 + 1] = -gains.kp * this.globalStiffnessScale;
      this.model.actuator_biasprm[actuatorId * 3 + 2] = -gains.kv * this.globalDampingScale;
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
    const axisDir = new THREE.Vector3(-capsuleUp.z, 0, capsuleUp.x);
    if (tiltAngle > 1e-5 && axisDir.lengthSq() > 1e-8) {
      tiltAxis.copy(axisDir).normalize();
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

    // Scale balancing gains dynamically.
    // During gait the controller deliberately relaxes (15% of normal) so the
    // forward lean and pitch a walk requires is not actively cancelled.
    const GAIT_BALANCE_SCALE = 0.15;
    const balanceScale = this.gaitActive ? GAIT_BALANCE_SCALE : 1.0;
    const BALANCE_KP = 100.0 * this.globalStiffnessScale * balanceScale;
    const BALANCE_KD = 40.0 * this.globalDampingScale * balanceScale;

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

    this.lastBalanceTorqueMag = torqueWorld.length();
    this.lastBalanceTiltRad = tiltAngle;

    // Convert balancing torque back to MuJoCo coordinate system
    const torqueMj = PhysicsEngine.worldToMuJoCo(torqueWorld);

    // Apply directly into xfrc_applied for the capsule body with finite safety guards
    const tx = Number.isFinite(torqueMj[0]) ? torqueMj[0] : 0;
    const ty = Number.isFinite(torqueMj[1]) ? torqueMj[1] : 0;
    const tz = Number.isFinite(torqueMj[2]) ? torqueMj[2] : 0;

    const xfrc = this.data.xfrc_applied;
    const idx = capsuleBodyId * 6;
    xfrc[idx + 0] = 0;
    xfrc[idx + 1] = 0;
    xfrc[idx + 2] = 0;
    xfrc[idx + 3] = tx;
    xfrc[idx + 4] = ty;
    xfrc[idx + 5] = tz;
  }
}
