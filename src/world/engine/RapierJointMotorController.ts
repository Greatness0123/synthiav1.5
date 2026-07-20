import RAPIER from '@dimforge/rapier3d-compat';
import { logger as Logger } from '../../utils/logger';

export interface JointMotorConfig {

  name: string;

  joint: RAPIER.ImpulseJoint;

  jointType: RAPIER.JointType;

  stiffness: number;

  damping: number;

  axisIndex: number;

  dof: 1 | 3;

  limits?: [number, number];

  targetAngle?: number;
}

export class RapierJointMotorController {
  private jointConfigs: Map<string, JointMotorConfig> = new Map();
  private isInitialized = false;

  constructor() {}

  public registerJoint(config: JointMotorConfig): void {
    this.jointConfigs.set(config.name, config);
  }

  public registerJoints(configs: JointMotorConfig[]): void {
    for (const config of configs) {
      this.registerJoint(config);
    }
    this.isInitialized = true;
    Logger.info(`RapierJointMotorController: Registered ${configs.length} joints`);
  }

  public getJoint(name: string): JointMotorConfig | undefined {
    return this.jointConfigs.get(name);
  }

  public setTargetAngle(name: string, angleRadians: number): void {
    const config = this.jointConfigs.get(name);
    if (!config) return;

    if (config.limits) {
      angleRadians = Math.max(config.limits[0], Math.min(config.limits[1], angleRadians));
    }

    config.targetAngle = angleRadians;

    if (config.jointType === RAPIER.JointType.Revolute) {

      const joint = config.joint as unknown as RAPIER.RevoluteImpulseJoint;
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      joint.configureMotorPosition(angleRadians, config.stiffness, config.damping);
    } else {

      Logger.warn(`RapierJointMotorController: Joint "${name}" type ${config.jointType} does not support motor position control.`);
    }
  }

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

  public setGains(name: string, stiffness: number, damping: number): void {
    const config = this.jointConfigs.get(name);
    if (!config) return;

    config.stiffness = stiffness;
    config.damping = damping;

    if (config.targetAngle !== undefined && config.jointType === RAPIER.JointType.Revolute) {
      const joint = config.joint as unknown as RAPIER.RevoluteImpulseJoint;
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      joint.configureMotorPosition(config.targetAngle, stiffness, damping);
    }
  }

  public setLimits(name: string, min: number, max: number): void {
    const config = this.jointConfigs.get(name);
    if (!config) return;
    config.limits = [min, max];

    if (config.jointType === RAPIER.JointType.Revolute) {
      const joint = config.joint as unknown as RAPIER.RevoluteImpulseJoint;
      joint.setLimits(min, max);
    }
  }

  private originalGains: Map<string, { stiffness: number; damping: number }> = new Map();

  public setLimpMode(active: boolean): void {
    this.jointConfigs.forEach((config) => {
      if (active) {

        this.originalGains.set(config.name, { stiffness: config.stiffness, damping: config.damping });
        this.setGains(config.name, 0.1, 0.5);
        if (config.jointType === RAPIER.JointType.Revolute) {
          this.setTargetAngle(config.name, config.targetAngle ?? 0);
        }
      } else {

        const original = this.originalGains.get(config.name);
        if (original) {
          this.setGains(config.name, original.stiffness, original.damping);
          this.originalGains.delete(config.name);
        }
      }
    });
  }

  public setBlendFactor(blendFactor: number): void {
    const alpha = Math.max(0, Math.min(1, blendFactor));
    this.jointConfigs.forEach((config) => {

      const original = this.originalGains.get(config.name) ?? { stiffness: config.stiffness, damping: config.damping };
      const targetStiffness = 0.1;
      const targetDamping = 0.5;
      const blendedStiffness = original.stiffness * (1 - alpha) + targetStiffness * alpha;
      const blendedDamping = original.damping * (1 - alpha) + targetDamping * alpha;
      this.setGains(config.name, blendedStiffness, blendedDamping);
    });
  }

  public getJointCount(): number {
    return this.jointConfigs.size;
  }

  public getIsInitialized(): boolean {
    return this.isInitialized;
  }

  public getJointNames(): string[] {
    return Array.from(this.jointConfigs.keys());
  }

  public cleanup(): void {
    this.jointConfigs.clear();
    this.originalGains.clear();
    this.isInitialized = false;
  }
}
