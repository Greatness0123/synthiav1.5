/**
 * RapierJointMotorController — PD Motor Control for Multi-Body Humanoid
 *
 * Replaces kinematic bone lerping with physically-grounded Rapier impulse joint
 * motor control. Each bone pair (parent→child) is represented by a configurable
 * impulse joint with PD gains (stiffness Kp, damping Kd).
 *
 * Core equation (from ProtoMotion extraction):
 *   τ = Kp * (q_target - q_current) - Kd * q̇_current
 *
 * Rapier v0.19 impulse joint API:
 * - RevoluteImpulseJoint: configureMotorPosition(targetPos, stiffness, damping)
 * - SphericalImpulseJoint: NO motor control methods in this Rapier version
 *   (must use GenericImpulseJoint or manual torque application)
 *
 * This file should be imported and used wherever multi-body joint control is needed.
 * The HumanoidPhysicsBinder.updateMotorTargets() should delegate to this controller
 * for each bone that has a corresponding Rapier impulse joint.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { logger as Logger } from '../../utils/logger';

export interface JointMotorConfig {
  /** Canonical bone name (e.g. 'mixamorigrightarm') */
  name: string;
  /** Rapier joint handle reference (must be a RevoluteImpulseJoint or equivalent) */
  joint: RAPIER.ImpulseJoint;
  /** Joint type for API dispatch */
  jointType: RAPIER.JointType;
  /** Proportional stiffness gain (torque per radian of error) */
  stiffness: number;
  /** Derivative damping gain (torque per rad/s of velocity) */
  damping: number;
  /** Axis of rotation for 1-DOF joints: 0=X(pitch/local), 1=Y(yaw), 2=Z(roll) */
  axisIndex: number;
  /** Number of degrees of freedom: 1 (hinge), 3 (spherical ball-socket) */
  dof: 1 | 3;
  /** Joint angle limits: [min, max] radians */
  limits?: [number, number];
  /** Current target angle (radians) for position-based PD control */
  targetAngle?: number;
}

export class RapierJointMotorController {
  private jointConfigs: Map<string, JointMotorConfig> = new Map();
  private isInitialized = false;

  constructor() {}

  /**
   * Register a joint with the motor controller.
   */
  public registerJoint(config: JointMotorConfig): void {
    this.jointConfigs.set(config.name, config);
  }

  /**
   * Batch-register joints from a configuration array.
   */
  public registerJoints(configs: JointMotorConfig[]): void {
    for (const config of configs) {
      this.registerJoint(config);
    }
    this.isInitialized = true;
    Logger.info(`RapierJointMotorController: Registered ${configs.length} joints`);
  }

  /**
   * Get a registered joint config by canonical name.
   */
  public getJoint(name: string): JointMotorConfig | undefined {
    return this.jointConfigs.get(name);
  }

  /**
   * Set a target angle (radians) for a 1-DOF revolute joint using PD control.
   * The Rapier constraint solver applies torque internally:
   *   τ = Kp * (target - current) - Kd * velocity
   *
   * For 3-DOF spherical joints (no motor support in this Rapier version),
   * this falls back to setting the target angle on the primary axis.
   */
  public setTargetAngle(name: string, angleRadians: number): void {
    const config = this.jointConfigs.get(name);
    if (!config) return;

    // Clamp to joint limits if defined
    if (config.limits) {
      angleRadians = Math.max(config.limits[0], Math.min(config.limits[1], angleRadians));
    }

    config.targetAngle = angleRadians;

    // Apply to Rapier joint motor
    if (config.jointType === RAPIER.JointType.Revolute) {
      // RevoluteImpulseJoint supports configureMotorPosition for PD control
      const joint = config.joint as unknown as RAPIER.RevoluteImpulseJoint;
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      joint.configureMotorPosition(angleRadians, config.stiffness, config.damping);
    } else {
      // Spherical and other joint types: log a warning
      // In a future iteration, these could be handled by GenericImpulseJoint
      // with per-axis motor control, or by manual torque application in the pre-step.
      Logger.warn(`RapierJointMotorController: Joint "${name}" type ${config.jointType} does not support motor position control.`);
    }
  }

  /**
   * Set a target angle with velocity feedforward for a revolute joint.
   */
  public setTargetWithVelocity(name: string, angleRadians: number, velocityRadPerSec: number): void {
    const config = this.jointConfigs.get(name);
    if (!config || config.jointType !== RAPIER.JointType.Revolute) return;

    if (config.limits) {
      angleRadians = Math.max(config.limits[0], Math.min(config.limits[1], angleRadians));
    }
    config.targetAngle = angleRadians;

    const joint = config.joint as unknown as RAPIER.RevoluteImpulseJoint;
    joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    joint.configureMotor(angleRadians, velocityRadPerSec, config.stiffness, config.damping);
  }

  /**
   * Set PD gains (stiffness/damping) for a joint at runtime.
   */
  public setGains(name: string, stiffness: number, damping: number): void {
    const config = this.jointConfigs.get(name);
    if (!config) return;

    config.stiffness = stiffness;
    config.damping = damping;

    // Re-apply with new gains if target is set
    if (config.targetAngle !== undefined && config.jointType === RAPIER.JointType.Revolute) {
      const joint = config.joint as unknown as RAPIER.RevoluteImpulseJoint;
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      joint.configureMotorPosition(config.targetAngle, stiffness, damping);
    }
  }

  /**
   * Set joint angle limits at runtime.
   */
  public setLimits(name: string, min: number, max: number): void {
    const config = this.jointConfigs.get(name);
    if (!config) return;
    config.limits = [min, max];

    if (config.jointType === RAPIER.JointType.Revolute) {
      const joint = config.joint as unknown as RAPIER.RevoluteImpulseJoint;
      joint.setLimits(min, max);
    }
  }

  /**
   * Batch set all joints to zero target with minimal stiffness (limp/ragdoll mode).
   */
  private originalGains: Map<string, { stiffness: number; damping: number }> = new Map();

  public setLimpMode(active: boolean): void {
    this.jointConfigs.forEach((config) => {
      if (active) {
        // Save original gains before overwriting
        this.originalGains.set(config.name, { stiffness: config.stiffness, damping: config.damping });
        this.setGains(config.name, 0.1, 0.5);
        if (config.jointType === RAPIER.JointType.Revolute) {
          this.setTargetAngle(config.name, config.targetAngle ?? 0);
        }
      } else {
        // Restore original gains from backup
        const original = this.originalGains.get(config.name);
        if (original) {
          this.setGains(config.name, original.stiffness, original.damping);
          this.originalGains.delete(config.name);
        }
      }
    });
  }

  /**
   * Rigid↔ragdoll blending: interpolate stiffness from high (rigid) to low (ragdoll).
   * @param blendFactor 0 = fully rigid, 1 = fully limp ragdoll
   */
  public setBlendFactor(blendFactor: number): void {
    const alpha = Math.max(0, Math.min(1, blendFactor));
    this.jointConfigs.forEach((config) => {
      // Use original gains as the base, not the current (potentially already blended) gains
      const original = this.originalGains.get(config.name) ?? { stiffness: config.stiffness, damping: config.damping };
      const targetStiffness = 0.1;
      const targetDamping = 0.5;
      const blendedStiffness = original.stiffness * (1 - alpha) + targetStiffness * alpha;
      const blendedDamping = original.damping * (1 - alpha) + targetDamping * alpha;
      this.setGains(config.name, blendedStiffness, blendedDamping);
    });
  }

  /**
   * Get the current number of registered joints.
   */
  public getJointCount(): number {
    return this.jointConfigs.size;
  }

  /**
   * Check if the controller has been initialized with joints.
   */
  public getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get all registered joint names.
   */
  public getJointNames(): string[] {
    return Array.from(this.jointConfigs.keys());
  }

  /**
   * Clean up and remove all joint references.
   */
  public cleanup(): void {
    this.jointConfigs.clear();
    this.originalGains.clear();
    this.isInitialized = false;
  }
}
