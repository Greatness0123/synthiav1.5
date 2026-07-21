import * as THREE from 'three';
import { PhysicsEngine } from './PhysicsEngine';
import { generateHumanoidMJCF } from './MJCFHumanoidTemplate';
import { logger as Logger } from '../../utils/logger';

export class BodyManager {
  private physicsEngine: PhysicsEngine;
  private modelRoot: THREE.Group | null = null;
  private capsuleCenterY: number = 0;
  private _boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }> | null = null;

  private bodyMap: Map<string, number> = new Map(); // boneName -> bodyId
  private geomMap: Map<string, number> = new Map(); // boneName -> geomId
  private actuatorMap: Map<string, number[]> = new Map(); // boneName -> actuatorIds
  private capsuleBodyId: number | null = null;

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
    modelRoot: THREE.Group
  ): Promise<boolean> {
    if (this.isActive) return true;

    this.physicsEngine.setMutating(true);

    try {
      this.modelRoot = modelRoot;
      this.capsuleCenterY = capsuleCenterY;
      this._boneInfoMap = boneInfoMap;

      this.deactivate();

      // 1. Generate full humanoid MJCF string
      const mjcfXml = generateHumanoidMJCF(boneInfoMap, _skeleton, capsuleCenterY, modelRoot);
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

      // 4. Map bone names to body IDs and geom IDs
      this.bodyMap.clear();
      this.geomMap.clear();

      // Map root_capsule
      const rootBodyId = module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, 'root_capsule');
      if (rootBodyId >= 0) {
        this.capsuleBodyId = rootBodyId;
        this.bodyMap.set('root_capsule', rootBodyId);
      }

      const rootGeomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, 'root_capsule_geom');
      if (rootGeomId >= 0) {
        this.geomMap.set('root_capsule', rootGeomId);
      }

      // Map all tracked bones
      for (const boneName of boneInfoMap.keys()) {
        const bodyId = module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, boneName);
        if (bodyId >= 0) {
          this.bodyMap.set(boneName, bodyId);
        }

        const geomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, boneName + '_geom');
        if (geomId >= 0) {
          this.geomMap.set(boneName, geomId);
        }

        const suffixes = ['_yaw', '_pitch', '_roll'];
        for (const suffix of suffixes) {
          const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + suffix);
          if (jntId >= 0) {
            if (typeof window !== 'undefined' && ((window as any).__SYNTHIA_DEBUG__ || (window as any).location?.hostname === 'localhost')) {
              console.log(`[JOINT MAP] ${boneName}${suffix} -> qposadr=${model.jnt_qposadr[jntId]}`);
            }
          }
        }
      }

      // Build actuator ID map
      this.actuatorMap.clear();
      for (const boneName of boneInfoMap.keys()) {
        const ids: number[] = [];
        const suffixes = ['_yaw', '_pitch', '_roll'];
        for (const suffix of suffixes) {
          const actName = `act_${boneName}${suffix}`;
          const actId = module.mj_name2id(model, module.mjtObj.mjOBJ_ACTUATOR.value, actName);
          if (actId >= 0) {
            ids.push(actId);
          }
        }
        if (ids.length > 0) {
          this.actuatorMap.set(boneName, ids);
        }
      }

      this.isActive = true;
      Logger.info(`MuJoCoBodyManager: Activated. Tracked ${this.bodyMap.size} body IDs, ${this.geomMap.size} geom IDs, and ${this.actuatorMap.size} actuator bones.`);
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
      this.capsuleBodyId = null;
      this.modelRoot = null;
      this._boneInfoMap = null;
      void this._boneInfoMap; // Silence tsc -b strict mode unused field warning
      this.isActive = false;
      Logger.info('MuJoCoBodyManager: Deactivated');
    } finally {
      this.physicsEngine.setMutating(false);
    }
  }

  public getRigidBodiesMap(): Map<string, number> {
    return this.bodyMap;
  }

  public getCapsuleBody(): number | null {
    return this.capsuleBodyId;
  }

  public getBoneColliderHandle(boneName: string): number | null {
    return this.geomMap.get(boneName) ?? null;
  }

  public syncRigidBodiesFromBones(
    boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>
  ): void {
    if (!this.isActive || !this.modelRoot) return;

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const module = PhysicsEngine.getModule();
    if (!module) return;

    const qpos = this.physicsEngine.qpos;
    const qvel = this.physicsEngine.qvel;

    // 1. Position and orient the root capsule based on model root
    this.modelRoot.updateMatrixWorld(true);
    const capsulePosThree = {
      x: this.modelRoot.position.x,
      y: this.modelRoot.position.y + this.capsuleCenterY,
      z: this.modelRoot.position.z
    };
    const capsulePosMj = PhysicsEngine.worldToMuJoCo(capsulePosThree);
    const capsuleQuatMj = PhysicsEngine.threeQuatToMuJoCo(this.modelRoot.quaternion);

    const rootJntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, 'root_freejoint');
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

      // Tracked bones have hinge joints defined
      const hasYaw = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_yaw') >= 0;
      const hasPitch = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_pitch') >= 0;
      const hasRoll = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_roll') >= 0;

      if (!hasYaw && !hasPitch && !hasRoll) continue;

      // Extract local relative quaternion from bone or compute relative to parent in MuJoCo space
      let qRel: THREE.Quaternion;
      if (CAPSULE_ATTACH_BONES.has(boneName)) {
        // Connected to capsule root (identity orientation)
        const boneWorldQuat = new THREE.Quaternion();
        bone.getWorldQuaternion(boneWorldQuat);
        const mjQuatArr = PhysicsEngine.threeQuatToMuJoCo(boneWorldQuat);
        qRel = new THREE.Quaternion(mjQuatArr[1], mjQuatArr[2], mjQuatArr[3], mjQuatArr[0]);
      } else {
        // Connected to regular parent
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

      // Convert local relative quaternion of joint into Yaw, Pitch, Roll angles (ZXY order)
      const euler = new THREE.Euler().setFromQuaternion(qRel, 'ZXY');

      if (hasYaw) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_yaw');
        if (jntId >= 0) {
          qpos[model.jnt_qposadr[jntId]] = euler.z;
          qvel[model.jnt_dofadr[jntId]] = 0;
        }
      }
      if (hasPitch) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_pitch');
        if (jntId >= 0) {
          qpos[model.jnt_qposadr[jntId]] = euler.x;
          qvel[model.jnt_dofadr[jntId]] = 0;
        }
      }
      if (hasRoll) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_roll');
        if (jntId >= 0) {
          qpos[model.jnt_qposadr[jntId]] = euler.y;
          qvel[model.jnt_dofadr[jntId]] = 0;
        }
      }
    }
  }
}
