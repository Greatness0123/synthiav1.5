/**
 * Builds a physical ragdoll from a body type configuration.
 * PRESERVED: This handles non-humanoid body types. Do not delete.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BodyTypeConfig, JointConfig } from '../../constants/bodyTypes';
import { PhysicsEngine } from './PhysicsEngine';
import { logger as Logger } from '../../utils/logger';
import { getRagdollJointLimits } from '../../constants/anatomicalLimits';
import { RAGDOLL_GROUP, ENVIRONMENT_GROUP, getCollisionMask } from '../../constants/physics';

export interface RagdollJoint {
  config: JointConfig;
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  impulseJoint?: RAPIER.ImpulseJoint;
  parent?: RagdollJoint;
}

export class RagdollBuilder {
  private physicsEngine: PhysicsEngine;
  private world: RAPIER.World;
  private scene: THREE.Scene;
  private joints: Map<string, RagdollJoint> = new Map();
  private currentBuildId: number = 0;

  constructor(physicsEngine: PhysicsEngine, scene: THREE.Scene) {
    this.physicsEngine = physicsEngine;
    this.world = physicsEngine.getWorld();
    this.scene = scene;
  }

  public async build(
    config: BodyTypeConfig,
    spawnPoint: THREE.Vector3,
    simplified: boolean = false
  ): Promise<Map<string, RagdollJoint>> {
    const buildId = ++this.currentBuildId;

    this.physicsEngine.setMutating(true);
    this.physicsEngine.setReady(false);

    let buildFailed = false;

    try {
      this.cleanup();

      const joints = new Map<string, RagdollJoint>();
      let jointConfigs = config.joints;

      if (simplified && config.id === 'humanoid') {
        const simplifiedJointNames = [
          'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
          'left_shoulder', 'left_elbow', 'left_wrist',
          'right_shoulder', 'right_elbow', 'right_wrist',
          'left_hip', 'left_knee', 'left_ankle',
          'right_hip', 'right_knee', 'right_ankle'
        ];

        jointConfigs = (config.joints || [])
          .filter(j => simplifiedJointNames.includes(j.name))
          .map(j => {
            let parent = j.parent;
            let totalOffset = new THREE.Vector3(...j.offset);
            while (parent && !simplifiedJointNames.includes(parent)) {
              const parentConfig = config.joints.find(c => c.name === parent);
              if (parentConfig) {
                totalOffset.add(new THREE.Vector3(...parentConfig.offset));
                parent = parentConfig.parent;
              } else {
                break;
              }
            }
            return { ...j, parent, offset: [totalOffset.x, totalOffset.y, totalOffset.z] as [number, number, number] };
          });
      }

      let configsToProcess = [...jointConfigs];
      let iterations = 0;
      const maxIterations = configsToProcess.length * 4;

      while (configsToProcess.length > 0 && iterations < maxIterations) {
        iterations++;
        const current = configsToProcess.shift();
        if (!current) continue;

        const meetsDependencies = !current.parent || joints.has(current.parent);

        if (meetsDependencies) {
          if (buildId !== this.currentBuildId) return joints;
          try {
            const joint = this.createJoint(current, joints, spawnPoint);
            joints.set(current.name, joint);
          } catch (error: any) {
            buildFailed = true;
            Logger.error(`RagdollBuilder: Failed to create joint ${current.name}. Reason: ${error.message}`, error);
          }
        } else {
          configsToProcess.push(current);
        }
      }

      if (configsToProcess.length > 0) {
        buildFailed = true;
        Logger.error(`RagdollBuilder: ${configsToProcess.length} structural connections skipped due to dependency failures.`);
      }

      if (buildId === this.currentBuildId) {
        if (!buildFailed && joints.size > 0) {
          try {
            const eq = this.physicsEngine.getEventQueue();
            for (let i = 0; i < 3; i++) {
              this.world.step(eq);
            }
            joints.forEach((j) => {
              if (j.rigidBody && j.rigidBody.isValid()) {
                j.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                j.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
              }
            });
          } catch (e) {
            Logger.warn('RagdollBuilder: post-build settle failed', e);
          }

          this.joints = joints;
          (window as any).__SYNTHIA_JOINTS_COUNT__ = joints.size;
          this.physicsEngine.setReady(true);
        } else {
          this.physicsEngine.setReady(false);
        }
      }
      return joints;
    } finally {
      if (buildId === this.currentBuildId) {
        this.physicsEngine.setMutating(false);
      }
    }
  }

  private createJoint(
    config: JointConfig,
    existingJoints: Map<string, RagdollJoint>,
    spawnPoint: THREE.Vector3
  ): RagdollJoint {
    // Create a simple sphere mesh for this joint
    const geometry = new THREE.SphereGeometry(0.08, 16, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0xff9900 });
    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);

    // Calculate position
    let position = new THREE.Vector3(...config.offset);
    if (config.parent) {
      const parentJoint = existingJoints.get(config.parent);
      if (parentJoint) {
        position.add(parentJoint.rigidBody.translation() as any);
      }
    }
    position.add(spawnPoint);

    // Create rigid body
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5);

    const rigidBody = this.world.createRigidBody(rbDesc);

    // Create collider
    const colDesc = RAPIER.ColliderDesc.ball(0.08)
      .setCollisionGroups(getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP));
    const collider = this.world.createCollider(colDesc, rigidBody);

    const joint: RagdollJoint = {
      config,
      rigidBody,
      collider,
      mesh,
    };

    // Create joint connecting to parent if exists
    if (config.parent) {
      const parentJoint = existingJoints.get(config.parent);
      if (parentJoint) {
        let jointData: RAPIER.JointData;
        if (config.dof === 1) {
          jointData = RAPIER.JointData.revolute(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 }
          );
          const limits = getRagdollJointLimits(config.name, 1) ?? {
            min: config.limits[0]?.[0] ?? -Math.PI,
            max: config.limits[0]?.[1] ?? Math.PI,
          };
          jointData.limitsEnabled = true;
          jointData.limits = [limits.min, limits.max];
        } else {
          jointData = RAPIER.JointData.spherical(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 }
          );
          const limits = getRagdollJointLimits(config.name, config.dof);
          if (limits) {
            jointData.limitsEnabled = true;
            jointData.limits = [limits.min, limits.max];
          }
        }

        joint.impulseJoint = this.world.createImpulseJoint(
          jointData,
          parentJoint.rigidBody,
          rigidBody,
          true
        );

        this.physicsEngine.registerVelocityClampBody(rigidBody);
      }
    } else {
      this.physicsEngine.registerVelocityClampBody(rigidBody);
    }

    mesh.position.copy(position);
    return joint;
  }

  public syncVisuals(): void {
    this.joints.forEach((joint) => {
      if (!joint.rigidBody.isValid()) return;

      const pos = joint.rigidBody.translation();
      const rot = joint.rigidBody.rotation();

      joint.mesh.position.set(pos.x, pos.y, pos.z);
      joint.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    });
  }

  public getJointState(): Record<string, any> {
    const state: Record<string, any> = {};
    this.joints.forEach((joint, name) => {
      if (!joint.rigidBody.isValid()) return;
      const pos = joint.rigidBody.translation();
      const rot = joint.rigidBody.rotation();
      state[name] = {
        position: [pos.x, pos.y, pos.z],
        rotation: [rot.x, rot.y, rot.z, rot.w],
      };
    });
    return state;
  }

  public setMode(_mode: 'rigid' | 'ragdoll'): void {
    // For now, ragdoll builder doesn't have explicit rigid mode
    // Motors are already configured during build
  }

  public push(partName: string, impulse: THREE.Vector3): void {
    const joint = this.joints.get(partName);
    if (joint && joint.rigidBody.isValid()) {
      joint.rigidBody.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    }
  }

  public resetToSpawn(spawnPoint: { x: number; y: number; z: number }): void {
    Logger.info(`RagdollBuilder.resetToSpawn: (${spawnPoint.x}, ${spawnPoint.y}, ${spawnPoint.z})`);
    this.joints.forEach((joint) => {
      if (!joint.rigidBody.isValid()) return;
      joint.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      joint.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    const root = this.joints.get('root') || this.joints.get('pelvis');
    if (root?.rigidBody.isValid()) {
      root.rigidBody.setTranslation({ x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z }, true);
      root.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
    this.syncVisuals();
  }

  public cleanup(): void {
    this.joints.forEach((joint) => {
      try {
        if (joint.rigidBody.isValid()) {
          this.world.removeRigidBody(joint.rigidBody);
        }
      } catch (e) {
        Logger.warn('RagdollBuilder: Error removing rigid body', e);
      }

      this.scene.remove(joint.mesh);
      if (joint.mesh.geometry) {
        joint.mesh.geometry.dispose();
      }
      if (joint.mesh.material) {
        (joint.mesh.material as THREE.Material).dispose();
      }
    });
    this.joints.clear();
  }
}
