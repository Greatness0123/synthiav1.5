import * as THREE from 'three';
import { PhysicsEngine } from './PhysicsEngine';
import { generateHumanoidMJCF, MJCFAgentSpec } from './MJCFHumanoidTemplate';
import { logger as Logger } from '../../utils/logger';

export class BodyManager {
  private physicsEngine: PhysicsEngine;
  private modelRoot: THREE.Group | null = null;
  private capsuleCenterY: number = 0;
  private _boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }> | null = null;

  private bodyMap: Map<string, number> = new Map(); // prefixedName -> bodyId (e.g. "agent_0_mixamorighips" -> 14)
  private geomMap: Map<string, number> = new Map(); // prefixedName -> geomId
  private actuatorMap: Map<string, number[]> = new Map(); // prefixedName -> actuatorIds
  private capsuleBodyIds: Map<string, number> = new Map(); // agentId -> bodyId

  private pristineBaseMjcfXml: string = '';
  private currentBaseMjcfXml: string = '';

  public isActive: boolean = false;

  public getPristineBaseMjcfXml(): string {
    return this.pristineBaseMjcfXml;
  }

  public getCurrentBaseMjcfXml(): string {
    return this.currentBaseMjcfXml;
  }

  public setCurrentBaseMjcfXml(xml: string): void {
    this.currentBaseMjcfXml = xml;
  }

  constructor(physicsEngine: PhysicsEngine) {
    this.physicsEngine = physicsEngine;
  }

  public async activate(
    boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>,
    _skeleton: THREE.Skeleton,
    _capsuleBody: any, // kept for signature parity
    capsuleCenterY: number,
    modelRoot: THREE.Group,
    agentsList?: MJCFAgentSpec[]
  ): Promise<boolean> {
    if (this.isActive) return true;

    this.physicsEngine.setMutating(true);

    try {
      this.modelRoot = modelRoot;
      this.capsuleCenterY = capsuleCenterY;
      this._boneInfoMap = boneInfoMap;

      this.deactivate();

      // 1. Generate full multi-agent humanoid MJCF string
      const mjcfXml = generateHumanoidMJCF(boneInfoMap, _skeleton, capsuleCenterY, modelRoot, null, null, agentsList);
      this.pristineBaseMjcfXml = mjcfXml;
      this.currentBaseMjcfXml = mjcfXml;

      // 2. Load into MuJoCo physics engine
      this.physicsEngine.loadMJCFModel(mjcfXml);

      // 3. Set the engine ready
      this.physicsEngine.setReady(true);

      const world = this.physicsEngine.getWorld();
      const model = world.model;
      const module = PhysicsEngine.getModule();
      if (!module) {
        throw new Error('MuJoCoBodyManager: MuJoCo module not initialized');
      }

      this.bodyMap.clear();
      this.geomMap.clear();
      this.actuatorMap.clear();
      this.capsuleBodyIds.clear();

      const activeAgents = agentsList && agentsList.length > 0 ? agentsList : [{ id: '', spawnOffset: { x: 0, y: 0, z: 0 } }];

      // 4. Map prefixed bone names to body IDs, geom IDs, and actuator IDs
      for (const agent of activeAgents) {
        const prefix = agent.id ? `agent_${agent.id}_` : '';

        // Map root_capsule
        const rootBodyId = module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, prefix + 'root_capsule');
        if (rootBodyId >= 0) {
          this.capsuleBodyIds.set(agent.id, rootBodyId);
          this.bodyMap.set(prefix + 'root_capsule', rootBodyId);
        }

        const rootGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, prefix + 'root_capsule_geom');
        if (rootGeomId >= 0) {
          this.geomMap.set(prefix + 'root_capsule_geom', rootGeomId);
        }

        // Map all tracked bones for this agent
        for (const boneName of boneInfoMap.keys()) {
          const prefBone = prefix + boneName;
          const bodyId = module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, prefBone);
          if (bodyId >= 0) {
            this.bodyMap.set(prefBone, bodyId);
          }

          const geomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, prefBone + '_geom');
          if (geomId >= 0) {
            this.geomMap.set(prefBone, geomId);
          }

          // Map actuators
          const ids: number[] = [];
          const suffixes = ['_yaw', '_pitch', '_roll'];
          for (const suffix of suffixes) {
            const actName = `act_${prefix}${boneName}${suffix}`;
            const actId = module.mj_name2id(model, module.mjtObj.mjOBJ_ACTUATOR.value, actName);
            if (actId >= 0) {
              ids.push(actId);
            }
          }
          if (ids.length > 0) {
            this.actuatorMap.set(prefBone, ids);
          }
        }
      }

      this.isActive = true;
      Logger.info(`MuJoCoBodyManager: Multi-agent Activated. Tracked ${this.bodyMap.size} body IDs, ${this.geomMap.size} geom IDs, and ${this.actuatorMap.size} actuator bones.`);
      return true;
    } catch (error) {
      Logger.error('MuJoCoBodyManager: Activation failed', error);
      this.deactivate();
      return false;
    } finally {
      this.physicsEngine.setMutating(false);
    }
  }

  public getActuatorMap(): Map<string, number[]> {
    return this.actuatorMap;
  }

  public deactivate(): void {
    if (!this.isActive) return;
    this.physicsEngine.setMutating(true);
    try {
      this.bodyMap.clear();
      this.geomMap.clear();
      this.actuatorMap.clear();
      this.capsuleBodyIds.clear();
      this.modelRoot = null;
      this._boneInfoMap = null;
      this.isActive = false;
      Logger.info('MuJoCoBodyManager: Deactivated');
    } finally {
      this.physicsEngine.setMutating(false);
    }
  }

  public getRigidBodiesMap(): Map<string, number> {
    return this.bodyMap;
  }

  public getCapsuleBody(agentId: string = ''): number | null {
    return this.capsuleBodyIds.get(agentId) ?? null;
  }

  public getBoneColliderHandle(prefixedBoneName: string): number | null {
    return this.geomMap.get(prefixedBoneName) ?? null;
  }

  public syncRigidBodiesFromBones(
    boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>,
    agentId: string,
    modelRoot: THREE.Group
  ): void {
    if (!this.isActive) return;

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const module = PhysicsEngine.getModule();
    if (!module) return;

    const qpos = this.physicsEngine.qpos;
    const qvel = this.physicsEngine.qvel;

    const prefix = agentId ? `agent_${agentId}_` : '';

    // 1. Position and orient the root capsule based on model root
    modelRoot.updateMatrixWorld(true);
    const offsetLocal = new THREE.Vector3(0, this.capsuleCenterY, 0);
    const offsetWorld = offsetLocal.clone().applyQuaternion(modelRoot.quaternion);
    const capsulePosThree = new THREE.Vector3().copy(modelRoot.position).add(offsetWorld);

    const capsulePosMj = PhysicsEngine.worldToMuJoCo(capsulePosThree);
    const capsuleQuatMj = PhysicsEngine.threeQuatToMuJoCo(modelRoot.quaternion);

    const rootJntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, prefix + 'root_freejoint');
    if (rootJntId >= 0) {
      const qposadr = model.jnt_qposadr[rootJntId];
      const qveladr = model.jnt_dofadr[rootJntId];

      qpos[qposadr] = capsulePosMj[0];
      qpos[qposadr + 1] = capsulePosMj[1];
      qpos[qposadr + 2] = capsulePosMj[2];

      qpos[qposadr + 3] = capsuleQuatMj[0];
      qpos[qposadr + 4] = capsuleQuatMj[1];
      qpos[qposadr + 5] = capsuleQuatMj[2];
      qpos[qposadr + 6] = capsuleQuatMj[3];

      for (let i = 0; i < 6; i++) {
        qvel[qveladr + i] = 0;
      }
    }

    // 2. Position and orient all nested joints based on bone quaternions
    const CAPSULE_ATTACH_BONES = new Set(['mixamorigspine', 'mixamorigleftupleg', 'mixamorigrightupleg']);

    for (const [boneName, info] of boneInfoMap) {
      const bone = info.bone;

      const hasYaw = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, prefix + boneName + '_yaw') >= 0;
      const hasPitch = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, prefix + boneName + '_pitch') >= 0;
      const hasRoll = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, prefix + boneName + '_roll') >= 0;

      if (!hasYaw && !hasPitch && !hasRoll) continue;

      let qRel: THREE.Quaternion;
      if (CAPSULE_ATTACH_BONES.has(boneName)) {
        const boneWorldQuat = new THREE.Quaternion();
        bone.getWorldQuaternion(boneWorldQuat);
        const mjQuatArr = PhysicsEngine.threeQuatToMuJoCo(boneWorldQuat);
        qRel = new THREE.Quaternion(mjQuatArr[1], mjQuatArr[2], mjQuatArr[3], mjQuatArr[0]);
      } else {
        const parent = bone.parent as THREE.Bone;
        if (parent) {
          const parentWorldQuat = new THREE.Quaternion();
          const childWorldQuat = new THREE.Quaternion();
          parent.getWorldQuaternion(parentWorldQuat);
          bone.getWorldQuaternion(childWorldQuat);

          const pQuatMjArr = PhysicsEngine.threeQuatToMuJoCo(parentWorldQuat);
          const cQuatMjArr = PhysicsEngine.threeQuatToMuJoCo(childWorldQuat);

          const qP = new THREE.Quaternion(pQuatMjArr[1], pQuatMjArr[2], pQuatMjArr[3], pQuatMjArr[0]);
          const qC = new THREE.Quaternion(cQuatMjArr[1], cQuatMjArr[2], cQuatMjArr[3], cQuatMjArr[0]);

          qRel = qP.clone().invert().multiply(qC);
        } else {
          qRel = bone.quaternion.clone();
        }
      }

      const euler = new THREE.Euler().setFromQuaternion(qRel, 'ZXY');

      if (hasYaw) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, prefix + boneName + '_yaw');
        if (jntId >= 0) {
          qpos[model.jnt_qposadr[jntId]] = euler.z;
          qvel[model.jnt_dofadr[jntId]] = 0;
        }
      }
      if (hasPitch) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, prefix + boneName + '_pitch');
        if (jntId >= 0) {
          qpos[model.jnt_qposadr[jntId]] = euler.x;
          qvel[model.jnt_dofadr[jntId]] = 0;
        }
      }
      if (hasRoll) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, prefix + boneName + '_roll');
        if (jntId >= 0) {
          qpos[model.jnt_qposadr[jntId]] = euler.y;
          qvel[model.jnt_dofadr[jntId]] = 0;
        }
      }
    }
  }
}
