import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEngine } from './PhysicsEngine';
import { RapierJointMotorController, JointMotorConfig } from './RapierJointMotorController';
import { AvatarSynchronizer } from './AvatarSynchronizer';
import { logger as Logger } from '../../utils/logger';
import {
  RAGDOLL_GROUP,
  ENVIRONMENT_GROUP,
  getCollisionMask,
  getBonePhysics,
} from '../../constants/physics';
import SYNTHIA_RIG_CONSTRAINTS from '../../constants/rigConstraints';
import { getAnatomicalLimitForBone } from '../../constants/anatomicalLimits';

const _tempQuat = new THREE.Quaternion();
const _tempQuat2 = new THREE.Quaternion();
const _tempQuat3 = new THREE.Quaternion();
const _tempQuat4 = new THREE.Quaternion();
const _tempQuat5 = new THREE.Quaternion();
const _tempQuat6 = new THREE.Quaternion();
const _tempQuat7 = new THREE.Quaternion();
const _tempVec3 = new THREE.Vector3();
const _tempVec32 = new THREE.Vector3();
const _tempVec33 = new THREE.Vector3();
const _tempVec34 = new THREE.Vector3();

interface PDGains { stiffness: number; damping: number; }

export const BONE_PD_GAINS: Record<string, PDGains> = {

  'mixamorigspine': { stiffness: 600, damping: 120 },
  'mixamorigspine1': { stiffness: 400, damping: 80 }, // FIX 3: was missing
  'mixamorigspine2': { stiffness: 400, damping: 80 }, // FIX 3: was missing
  'mixamorigneck': { stiffness: 320, damping: 64 },
  'mixamorighead': { stiffness: 240, damping: 48 },

  'mixamorigleftshoulder': { stiffness: 200, damping: 40 },
  'mixamorigrightshoulder': { stiffness: 200, damping: 40 },

  'mixamorigleftarm': { stiffness: 400, damping: 80 },
  'mixamorigrightarm': { stiffness: 400, damping: 80 },
  'mixamorigleftforearm': { stiffness: 240, damping: 48 },
  'mixamorigrightforearm': { stiffness: 240, damping: 48 },
  'mixamoriglefthand': { stiffness: 160, damping: 32 },
  'mixamorigrighthand': { stiffness: 160, damping: 32 },

  'mixamorigleftupleg': { stiffness: 800, damping: 160 },
  'mixamorigrightupleg': { stiffness: 800, damping: 160 },
  'mixamorigleftleg': { stiffness: 800, damping: 160 },
  'mixamorigrightleg': { stiffness: 800, damping: 160 },
  'mixamorigleftfoot': { stiffness: 480, damping: 96 },
  'mixamorigrightfoot': { stiffness: 480, damping: 96 },
};

{
  const sides = ['left', 'right'];
  const fingers = ['index', 'middle', 'ring', 'pinky'];
  for (const side of sides) {
    for (const finger of fingers) {
      for (let seg = 1; seg <= 3; seg++) {
        const name = `mixamorig${side}hand${finger}${seg}`;
        BONE_PD_GAINS[name] = { stiffness: 5.0, damping: 1.0 };
      }
    }
    for (let seg = 1; seg <= 3; seg++) {
      const name = `mixamorig${side}handthumb${seg}`;
      BONE_PD_GAINS[name] = { stiffness: 5.0, damping: 1.0 };
    }
  }
}

type JointType = 'revolute' | 'spherical' | 'fixed';
const BONE_JOINT_TYPE: Record<string, JointType> = {
  'mixamorigspine': 'spherical',
  'mixamorigspine1': 'spherical',
  'mixamorigspine2': 'spherical',
  'mixamorigneck': 'spherical',
  'mixamorighead': 'spherical',
  'mixamorigleftshoulder': 'spherical',
  'mixamorigrightshoulder': 'spherical',
  'mixamorigleftarm': 'spherical',
  'mixamorigrightarm': 'spherical',
  'mixamorigleftforearm': 'revolute',
  'mixamorigrightforearm': 'revolute',
  'mixamoriglefthand': 'spherical',
  'mixamorigrighthand': 'spherical',
  'mixamorigleftupleg': 'spherical',
  'mixamorigrightupleg': 'spherical',
  'mixamorigleftleg': 'revolute',
  'mixamorigrightleg': 'revolute',
  'mixamorigleftfoot': 'spherical',
  'mixamorigrightfoot': 'spherical',
};

{
  const sides = ['left', 'right'];
  const fingers = ['index', 'middle', 'ring', 'pinky'];
  for (const side of sides) {
    for (const finger of fingers) {
      for (let seg = 1; seg <= 3; seg++) {
        BONE_JOINT_TYPE[`mixamorig${side}hand${finger}${seg}`] = 'spherical';
      }
    }
    for (let seg = 1; seg <= 3; seg++) {
      BONE_JOINT_TYPE[`mixamorig${side}handthumb${seg}`] = 'spherical';
    }
  }
}

const CAPSULE_ATTACH_BONES = new Set([
  'mixamorigspine', 'mixamorigleftupleg', 'mixamorigrightupleg',
]);

function getPhysicsParentName(bone: THREE.Bone, trackedBones: Set<string>): string | null {
  const canonical = bone.name.toLowerCase().replace(/:/g, '');
  if (CAPSULE_ATTACH_BONES.has(canonical)) return null;
  let parent: THREE.Object3D | null = bone.parent;
  while (parent) {
    if (parent instanceof THREE.Bone) {
      const parentCanonical = parent.name.toLowerCase().replace(/:/g, '');
      if (trackedBones.has(parentCanonical)) return parentCanonical;
    }
    parent = parent.parent;
  }
  return null;
}

function topologicalSortBones(bones: THREE.Bone[], trackedBones: Set<string>): THREE.Bone[] {
  const sorted: THREE.Bone[] = [];
  const visited = new Set<string>();
  function visit(bone: THREE.Bone) {
    const canonical = bone.name.toLowerCase().replace(/:/g, '');
    if (visited.has(canonical)) return;
    visited.add(canonical);
    const parentName = getPhysicsParentName(bone, trackedBones);
    if (parentName) {
      const parentBone = bones.find(
        b => b.name.toLowerCase().replace(/:/g, '') === parentName
      );
      if (parentBone) visit(parentBone);
    }
    sorted.push(bone);
  }
  for (const bone of bones) visit(bone);
  return sorted;
}

const REVOLUTE_AXIS = { x: 1, y: 0, z: 0 };

interface PerBoneData {
  canonicalName: string;
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  joint: RAPIER.ImpulseJoint | null;
}

const FOOT_COLLIDER_HALF_WIDTH = 0.05;
const FOOT_COLLIDER_HALF_HEIGHT = 0.01;
const FOOT_COLLIDER_HALF_LENGTH = 0.11;

export class HumanoidMultiBodyManager {
  private physicsEngine: PhysicsEngine;
  private world: RAPIER.World;
  private scene: THREE.Scene;

  private motorController: RapierJointMotorController;
  private avatarSynchronizer: AvatarSynchronizer;

  private bodies: Map<string, PerBoneData> = new Map();
  private rigidBodiesMap: Map<string, RAPIER.RigidBody> = new Map();
  private capsuleBody: RAPIER.RigidBody | null = null;

  private boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }> | null = null;
  private trackedBones: Set<string> = new Set();
  private bindPoseRelativeQuats: Map<string, THREE.Quaternion> = new Map();

  private capsuleCenterY: number = 0;
  private modelRoot: THREE.Group | null = null;

  public isActive: boolean = false;

  private globalStiffnessScale: number = 1.0;
  private globalDampingScale: number = 1.0;
  private activationFrameCount: number = 0;
  private readonly RAMP_FRAMES: number = 0; // No ramp: full stability from frame 0
  private settlingFramesLeft: number = 0;
  private readonly SETTLE_FRAMES: number = 0; // No settle: full stability immediately

  private prevFilteredTargets: Map<string, THREE.Quaternion> = new Map();
  private readonly EMA_ALPHA: number = 0.10;

  constructor(physicsEngine: PhysicsEngine, scene: THREE.Scene) {
    this.physicsEngine = physicsEngine;
    this.world = physicsEngine.getWorld();
    this.scene = scene;
    this.motorController = new RapierJointMotorController();
    this.avatarSynchronizer = new AvatarSynchronizer(0.04);
  }

  public async activate(
    boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>,
    _skeleton: THREE.Skeleton,
    capsuleBody: RAPIER.RigidBody,
    capsuleCenterY: number,
    modelRoot: THREE.Group
  ): Promise<boolean> {
    void this.scene;
    if (this.isActive) return true;

    this.physicsEngine.setMutating(true);

    try {
      this.capsuleBody = capsuleBody;
      this.capsuleCenterY = capsuleCenterY;
      this.modelRoot = modelRoot;
      this.deactivate();

      const trackedBones = new Set<string>();
      for (const canonical of boneInfoMap.keys()) {
        if (BONE_JOINT_TYPE[canonical]) {
          trackedBones.add(canonical);
        }
      }
      this.boneInfoMap = boneInfoMap;
      this.trackedBones = trackedBones;

      const trackedBoneArray = Array.from(boneInfoMap.entries())
        .filter(([name]) => trackedBones.has(name))
        .map(([, info]) => info.bone);
      const sortedBones = topologicalSortBones(trackedBoneArray, trackedBones);

      if (this.modelRoot) this.modelRoot.updateMatrixWorld(true);

      for (const bone of sortedBones) {
        const boneName = bone.name.toLowerCase().replace(/:/g, '');
        const parentName = getPhysicsParentName(bone, trackedBones);
        const boneInfo = boneInfoMap.get(boneName);
        if (!boneInfo) { Logger.warn(`HMB: Bone ${boneName} not found, skipping`); continue; }

        const boneWorldPos = boneInfo.worldPosition.clone();
        const boneWorldQuat = new THREE.Quaternion();
        bone.getWorldQuaternion(boneWorldQuat);

        const phys = getBonePhysics(boneName);
        const rbDesc = RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(boneWorldPos.x, boneWorldPos.y, boneWorldPos.z)
          .setRotation({ x: boneWorldQuat.x, y: boneWorldQuat.y, z: boneWorldQuat.z, w: boneWorldQuat.w })
          .setAdditionalMassProperties(
            phys.mass,
            { x: 0, y: 0, z: 0 },
            { x: phys.principalInertia.x, y: phys.principalInertia.y, z: phys.principalInertia.z },
            { x: 0, y: 0, z: 0, w: 1 }
          )
          .setGravityScale(1.0)
          .setLinearDamping(3.0)
          .setAngularDamping(3.0)
          .setCcdEnabled(true);
        const body = this.world.createRigidBody(rbDesc);

        const isFoot = boneName.includes('foot');
        let colDesc: RAPIER.ColliderDesc;
        if (isFoot) {
          colDesc = RAPIER.ColliderDesc.cuboid(
            FOOT_COLLIDER_HALF_WIDTH,
            FOOT_COLLIDER_HALF_HEIGHT,
            FOOT_COLLIDER_HALF_LENGTH
          );

          const FOOT_SOLE_OFFSET = 0.01;
          colDesc.setTranslation(0, -FOOT_COLLIDER_HALF_HEIGHT - FOOT_SOLE_OFFSET, 0);
        } else {
          const boneLength = this.estimateBoneLength(boneName, boneInfo, boneInfoMap);
          const colRadius = 0.04;
          const colHalfHeight = Math.max(0.02, boneLength / 2 - colRadius);
          colDesc = RAPIER.ColliderDesc.capsule(colHalfHeight, colRadius);
        }

        colDesc.setDensity(0);
        colDesc.setCollisionGroups(getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP));
        colDesc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
        const collider = this.world.createCollider(colDesc, body);

        this.physicsEngine.registerVelocityClampBody(body);
        this.rigidBodiesMap.set(boneName, body);

        let parentBody: RAPIER.RigidBody | null = null;
        if (parentName) parentBody = this.rigidBodiesMap.get(parentName) ?? null;
        if (!parentBody) parentBody = capsuleBody;
        if (!parentBody || !parentBody.isValid()) {
          Logger.warn(`HMB: Invalid parent for ${boneName}, storing root-level`);
          this.bodies.set(boneName, { canonicalName: boneName, rigidBody: body, collider, joint: null });
          continue;
        }

        const jointType = BONE_JOINT_TYPE[boneName] ?? 'spherical';
        let joint: RAPIER.ImpulseJoint;

        const childPos = body.translation();
        const parentPos = parentBody.translation();
        const parentRotQ = parentBody.rotation();
        const parentQuatInv = _tempQuat.set(parentRotQ.x, parentRotQ.y, parentRotQ.z, parentRotQ.w).invert();
        const worldOffset = _tempVec32.set(childPos.x - parentPos.x, childPos.y - parentPos.y, childPos.z - parentPos.z);
        worldOffset.applyQuaternion(parentQuatInv);
        const anchor1 = { x: worldOffset.x, y: worldOffset.y, z: worldOffset.z };
        const anchor2 = { x: 0, y: 0, z: 0 };

        if (jointType === 'fixed') {
          const parentRotQ2 = parentBody.rotation();
          const childRotQ2 = body.rotation();
          const jointData = RAPIER.JointData.fixed(
            anchor1, { x: parentRotQ2.x, y: parentRotQ2.y, z: parentRotQ2.z, w: parentRotQ2.w },
            anchor2, { x: childRotQ2.x, y: childRotQ2.y, z: childRotQ2.z, w: childRotQ2.w }
          );
          joint = this.world.createImpulseJoint(jointData, parentBody, body, true);
        } else if (jointType === 'revolute') {
          const jointData = RAPIER.JointData.revolute(anchor1, anchor2, REVOLUTE_AXIS);
          const constraint = SYNTHIA_RIG_CONSTRAINTS[boneName];
          if (constraint && constraint.dof === 1) {
            const min = constraint.x[0], max = constraint.x[1];
            if (isFinite(min) && isFinite(max)) { jointData.limitsEnabled = true; jointData.limits = [min, max]; }
          } else {
            const limits = getAnatomicalLimitForBone(boneName);
            if (limits) { jointData.limitsEnabled = true; jointData.limits = [limits.min, limits.max]; }
          }
          joint = this.world.createImpulseJoint(jointData, parentBody, body, true);
        } else {
          const jointData = RAPIER.JointData.spherical(anchor1, anchor2);
          const constraint = SYNTHIA_RIG_CONSTRAINTS[boneName];
          if (constraint && constraint.dof >= 2) {
            const primaryLimit = Math.min(
              Math.abs(constraint.x[1] - constraint.x[0]) / 2,
              Math.abs(constraint.y[1] - constraint.y[0]) / 2,
              Math.abs(constraint.z[1] - constraint.z[0]) / 2
            );
            if (isFinite(primaryLimit) && primaryLimit > 0.01) {
              jointData.limitsEnabled = true;
              jointData.limits = [-primaryLimit, primaryLimit];
            }
          }
          joint = this.world.createImpulseJoint(jointData, parentBody, body, true);
        }

        this.bodies.set(boneName, { canonicalName: boneName, rigidBody: body, collider, joint });
      }

      this.bindPoseRelativeQuats.clear();

      const capRot = capsuleBody.rotation();
      const capQInv = new THREE.Quaternion(capRot.x, capRot.y, capRot.z, capRot.w).invert();

      for (const [boneName, info] of boneInfoMap) {
        if (!BONE_JOINT_TYPE[boneName]) continue;

        if (CAPSULE_ATTACH_BONES.has(boneName)) {
          const boneWorldQ = new THREE.Quaternion();
          info.bone.getWorldQuaternion(boneWorldQ);
          this.bindPoseRelativeQuats.set(boneName, capQInv.clone().multiply(boneWorldQ));
        } else {
          this.bindPoseRelativeQuats.set(boneName, info.bone.quaternion.clone());
        }
      }

      const motorConfigs: JointMotorConfig[] = [];
      for (const [boneName, bodyData] of this.bodies) {
        if (!bodyData.joint) continue;
        const gains = BONE_PD_GAINS[boneName] ?? { stiffness: 100, damping: 10 };
        const jt = BONE_JOINT_TYPE[boneName] ?? 'spherical';
        const constraint = SYNTHIA_RIG_CONSTRAINTS[boneName];
        let limits: [number, number] | undefined;
        if (constraint && constraint.dof === 1) {
          limits = [constraint.x[0], constraint.x[1]];
        } else {
          const anatLim = getAnatomicalLimitForBone(boneName);
          if (anatLim) limits = [anatLim.min, anatLim.max];
        }
        motorConfigs.push({
          name: boneName,
          joint: bodyData.joint,
          jointType: jt === 'revolute' ? RAPIER.JointType.Revolute : RAPIER.JointType.Spherical,
          stiffness: gains.stiffness,
          damping: gains.damping,
          axisIndex: 0,
          dof: jt === 'revolute' ? 1 : 3,
          limits,
          targetAngle: 0,
        });
      }
      this.motorController.registerJoints(motorConfigs);

      this.avatarSynchronizer.clear();
      for (const [boneName] of this.bodies) {
        const info = boneInfoMap.get(boneName);
        if (!info) continue;
        this.avatarSynchronizer.registerBone(boneName, info.bone.name, {
          canonicalName: boneName, syncRotation: true, syncTranslation: false, rootOffsetY: 0,
        });
      }

      this.motorController.getJointNames().forEach((name) => {
        if (BONE_JOINT_TYPE[name] === 'revolute') {
          this.motorController.setTargetAngle(name, 0);
        }
      });

      this.isActive = true;
      this.activationFrameCount = 0;
      Logger.info(`HumanoidMultiBodyManager: Activated ${this.bodies.size} bone bodies, ${motorConfigs.length} motors`);
      return true;
    } catch (error) {
      Logger.error('HumanoidMultiBodyManager: Activation failed', error);
      this.deactivate();
      return false;
    } finally {
      this.physicsEngine.setMutating(false);
      this.physicsEngine.setReady(true);
    }
  }

  public setTargets(currentTargets: Map<string, any>): void {
    if (!this.isActive) return;

    const MIN_GAIN = 0.30;
    if (this.settlingFramesLeft > 0) {
      this.settlingFramesLeft--;
      this.setGainScale(0.1, 0.8);
    } else if (this.activationFrameCount < this.RAMP_FRAMES) {
      this.activationFrameCount++;
      const t = this.activationFrameCount / this.RAMP_FRAMES;
      const scale = MIN_GAIN + (1.0 - MIN_GAIN) * t;
      this.setGainScale(scale, scale);
    }

    const targetedBones = new Set<string>();

    currentTargets.forEach((parsedTarget, canonical) => {
      targetedBones.add(canonical);
      const bodyData = this.bodies.get(canonical);
      if (!bodyData) return;
      const jointType = BONE_JOINT_TYPE[canonical];
      const gains = BONE_PD_GAINS[canonical] ?? { stiffness: 100, damping: 10 };

      if (jointType === 'fixed') return; // locked bone — no PD torque needed
      if (jointType === 'revolute' && bodyData.joint) {
        let targetAngle = 0;
        if (parsedTarget.isScalar && typeof parsedTarget.scalar === 'number') {
          targetAngle = parsedTarget.scalar;
        } else if (parsedTarget.x !== undefined) {
          targetAngle = parsedTarget.x;
        }
        const constraint = SYNTHIA_RIG_CONSTRAINTS[canonical];
        if (constraint && constraint.dof === 1) {
          targetAngle = Math.max(constraint.x[0], Math.min(constraint.x[1], targetAngle));
        }
        this.motorController.setTargetAngle(canonical, targetAngle);
        return;
      }

      if (jointType !== 'spherical' || !bodyData.rigidBody.isValid()) return;

      const bindPoseRelative = this.bindPoseRelativeQuats.get(canonical);
      const deltaQuat = _tempQuat5.identity();
      if (parsedTarget.isScalar && typeof parsedTarget.scalar === 'number') {
        deltaQuat.setFromAxisAngle(_tempVec3.set(1, 0, 0), parsedTarget.scalar);
      } else if (parsedTarget.x !== undefined) {
        const euler = new THREE.Euler(parsedTarget.x || 0, parsedTarget.y || 0, parsedTarget.z || 0, 'XYZ');
        deltaQuat.setFromEuler(euler);
      }

      const rawTarget = bindPoseRelative
        ? _tempQuat2.copy(bindPoseRelative).multiply(deltaQuat)
        : _tempQuat2.copy(deltaQuat);

      rawTarget.normalize();
      if (rawTarget.w < 0) { rawTarget.x = -rawTarget.x; rawTarget.y = -rawTarget.y; rawTarget.z = -rawTarget.z; rawTarget.w = -rawTarget.w; }

      const prevQuat = this.prevFilteredTargets.get(canonical);
      if (prevQuat) {

        const dot = prevQuat.x * rawTarget.x + prevQuat.y * rawTarget.y + prevQuat.z * rawTarget.z + prevQuat.w * rawTarget.w;
        const safeTarget = dot < 0
          ? _tempQuat7.set(-rawTarget.x, -rawTarget.y, -rawTarget.z, -rawTarget.w)
          : rawTarget;
        safeTarget.slerpQuaternions(prevQuat, safeTarget, this.EMA_ALPHA);
        rawTarget.copy(safeTarget);
      }
      this.prevFilteredTargets.set(canonical, rawTarget.clone());

      const boneObj = this.boneInfoMap?.get(canonical)?.bone;
      const parentName = boneObj ? getPhysicsParentName(boneObj, this.trackedBones) : null;
      const parentBody = parentName ? this.rigidBodiesMap.get(parentName) ?? this.capsuleBody : this.capsuleBody;
      if (!parentBody || !parentBody.isValid()) return;

      const childRot = bodyData.rigidBody.rotation();
      const parentRot = parentBody.rotation();
      const childQuat = _tempQuat.set(childRot.x, childRot.y, childRot.z, childRot.w);
      const parentQuat = _tempQuat3.set(parentRot.x, parentRot.y, parentRot.z, parentRot.w);
      const currentRelQuat = _tempQuat6.copy(parentQuat).invert().multiply(childQuat);

      const errorQuat = _tempQuat4.copy(currentRelQuat).invert().multiply(rawTarget);
      errorQuat.normalize();
      if (errorQuat.w < 0) { errorQuat.x = -errorQuat.x; errorQuat.y = -errorQuat.y; errorQuat.z = -errorQuat.z; errorQuat.w = -errorQuat.w; }

      const errorAxis = _tempVec32;
      let errorAngle = 0;
      errorAxis.set(errorQuat.x, errorQuat.y, errorQuat.z);
      const sinHalf = errorAxis.length();
      if (sinHalf > 1e-6) { errorAngle = 2 * Math.atan2(sinHalf, errorQuat.w); errorAxis.divideScalar(sinHalf); }
      else { errorAngle = 0; errorAxis.set(0, 1, 0); }

      const angVel = bodyData.rigidBody.angvel();
      const localAngVel = _tempVec3.set(angVel.x, angVel.y, angVel.z)
        .applyQuaternion(_tempQuat5.copy(childQuat).invert());
      const avX = localAngVel.x, avY = localAngVel.y, avZ = localAngVel.z;

      const stiffness = gains.stiffness * this.globalStiffnessScale;
      const damping = gains.damping * this.globalDampingScale;

      const localTorque = _tempVec3.set(
        stiffness * errorAxis.x * errorAngle - damping * avX,
        stiffness * errorAxis.y * errorAngle - damping * avY,
        stiffness * errorAxis.z * errorAngle - damping * avZ
      );

      const torqueMag = localTorque.length();
      const MAX_TORQUE = 15.0;
      if (torqueMag > MAX_TORQUE) localTorque.multiplyScalar(MAX_TORQUE / torqueMag);

      bodyData.rigidBody.addTorque(localTorque.applyQuaternion(childQuat), true);
    });

    for (const [canonical, bodyData] of this.bodies) {
      if (targetedBones.has(canonical) || !bodyData.rigidBody.isValid()) continue;
      const jointType = BONE_JOINT_TYPE[canonical];
      if (jointType === 'revolute' && bodyData.joint) continue;
      if (jointType === 'fixed') continue; // locked bone — no PD torque needed
      if (jointType !== 'spherical') continue;

      const bindPoseRelative = this.bindPoseRelativeQuats.get(canonical);
      if (!bindPoseRelative) continue;

      const targetQuat = _tempQuat2.copy(bindPoseRelative);
      const boneObj = this.boneInfoMap?.get(canonical)?.bone;
      const parentName = boneObj ? getPhysicsParentName(boneObj, this.trackedBones) : null;
      const parentBody = parentName ? this.rigidBodiesMap.get(parentName) ?? this.capsuleBody : this.capsuleBody;
      if (!parentBody || !parentBody.isValid()) continue;

      const childRot = bodyData.rigidBody.rotation();
      const parentRot = parentBody.rotation();
      const childQuat = _tempQuat.set(childRot.x, childRot.y, childRot.z, childRot.w);
      const parentQuat = _tempQuat3.set(parentRot.x, parentRot.y, parentRot.z, parentRot.w);
      const currentRelQuat = _tempQuat6.copy(parentQuat).invert().multiply(childQuat);

      const errorQuat = _tempQuat4.copy(currentRelQuat).invert().multiply(targetQuat);
      errorQuat.normalize();
      if (errorQuat.w < 0) { errorQuat.x = -errorQuat.x; errorQuat.y = -errorQuat.y; errorQuat.z = -errorQuat.z; errorQuat.w = -errorQuat.w; }

      const errorAxis = _tempVec32;
      let errorAngle = 0;
      errorAxis.set(errorQuat.x, errorQuat.y, errorQuat.z);
      const sinHalf = errorAxis.length();
      if (sinHalf > 1e-6) { errorAngle = 2 * Math.atan2(sinHalf, errorQuat.w); errorAxis.divideScalar(sinHalf); }
      else { errorAngle = 0; errorAxis.set(0, 1, 0); }

      const gains = BONE_PD_GAINS[canonical] ?? { stiffness: 100, damping: 10 };
      const angVel = bodyData.rigidBody.angvel();
      const localAngVel = _tempVec3.set(angVel.x, angVel.y, angVel.z)
        .applyQuaternion(_tempQuat5.copy(childQuat).invert());
      const avX = localAngVel.x, avY = localAngVel.y, avZ = localAngVel.z;

      const stiffness = gains.stiffness * this.globalStiffnessScale;
      const damping = gains.damping * this.globalDampingScale;

      const localTorque = _tempVec34.set(
        stiffness * errorAxis.x * errorAngle - damping * avX,
        stiffness * errorAxis.y * errorAngle - damping * avY,
        stiffness * errorAxis.z * errorAngle - damping * avZ
      );

      const torqueMag = localTorque.length();
      const MAX_TORQUE = 15.0;
      if (torqueMag > MAX_TORQUE) localTorque.multiplyScalar(MAX_TORQUE / torqueMag);

      bodyData.rigidBody.addTorque(localTorque.applyQuaternion(childQuat), true);
    }

    if (this.capsuleBody && this.capsuleBody.isValid()) {
      const capsuleQuat = this.capsuleBody.rotation();
      _tempQuat.set(capsuleQuat.x, capsuleQuat.y, capsuleQuat.z, capsuleQuat.w);

      const capsuleUp = _tempVec3.set(0, 1, 0).applyQuaternion(_tempQuat);
      const tiltAngle = Math.acos(Math.min(1, Math.max(-1, capsuleUp.y)));
      const tiltAxis = _tempVec32.set(-capsuleUp.z, 0, capsuleUp.x).normalize();

      const BALANCE_KP = 200.0 * this.globalStiffnessScale;
      const BALANCE_KD = 80.0 * this.globalDampingScale;

      const angVel = this.capsuleBody.angvel();
      const balanceTorque = _tempVec33.set(
        BALANCE_KP * tiltAxis.x * tiltAngle - BALANCE_KD * angVel.x,
        BALANCE_KP * tiltAxis.y * tiltAngle - BALANCE_KD * angVel.y,
        BALANCE_KP * tiltAxis.z * tiltAngle - BALANCE_KD * angVel.z
      );

      const torqueMag = balanceTorque.length();
      const MAX_BALANCE_TORQUE = 60.0;
      if (torqueMag > MAX_BALANCE_TORQUE) balanceTorque.multiplyScalar(MAX_BALANCE_TORQUE / torqueMag);

      this.capsuleBody.addTorque(balanceTorque, true);
    }
  }

  public syncVisuals(
    boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>,
    _skeleton: THREE.Skeleton,
    disableSync?: Set<string>
  ): void {
    if (!this.isActive) return;

    const bonesSyncMap = new Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>();
    for (const [canonical] of this.bodies) {
      const boneInfo = boneInfoMap.get(canonical);
      if (!boneInfo) continue;
      const worldPos = new THREE.Vector3();
      boneInfo.bone.getWorldPosition(worldPos);
      bonesSyncMap.set(canonical, { bone: boneInfo.bone, worldPosition: worldPos });
    }

    this.avatarSynchronizer.synchronize(bonesSyncMap, this.rigidBodiesMap, disableSync);

    if (this.capsuleBody && this.capsuleBody.isValid() && this.modelRoot) {
      this.avatarSynchronizer.syncRoot(this.modelRoot, this.capsuleBody, this.capsuleCenterY);
    }
  }

  public setGainScale(stiffnessScale: number, dampingScale: number): void {
    this.globalStiffnessScale = Math.max(0.01, stiffnessScale);
    this.globalDampingScale = Math.max(0.01, dampingScale);
    this.motorController.getJointNames().forEach((name) => {
      const base = BONE_PD_GAINS[name];
      if (base) {
        this.motorController.setGains(name, base.stiffness * this.globalStiffnessScale, base.damping * this.globalDampingScale);
      }
    });
  }

  public setLimpMode(limp: boolean): void { this.motorController.setLimpMode(limp); }
  public getMotorController(): RapierJointMotorController { return this.motorController; }
  public getAvatarSynchronizer(): AvatarSynchronizer { return this.avatarSynchronizer; }

  public syncRigidBodiesFromBones(
    boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>
  ): void {
    if (!this.isActive) return;
    if (this.modelRoot) this.modelRoot.updateMatrixWorld(true);

    for (const [canonical, bodyData] of this.bodies) {
      const boneInfo = boneInfoMap.get(canonical);
      if (!boneInfo || !bodyData.rigidBody.isValid()) continue;
      const worldQuat = new THREE.Quaternion();
      boneInfo.bone.getWorldQuaternion(worldQuat);
      bodyData.rigidBody.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
      const worldPos = new THREE.Vector3();
      boneInfo.bone.getWorldPosition(worldPos);
      bodyData.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
      bodyData.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bodyData.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.settlingFramesLeft = this.SETTLE_FRAMES;
    this.prevFilteredTargets.clear();
  }

  public getBoneCount(): number { return this.bodies.size; }
  public getIsActive(): boolean { return this.isActive; }
  public getRigidBodiesMap(): Map<string, RAPIER.RigidBody> { return this.rigidBodiesMap; }
  public getCapsuleBody(): RAPIER.RigidBody | null { return this.capsuleBody; }

  public getBoneColliderHandle(canonicalName: string): number | null {
    const bodyData = this.bodies.get(canonicalName);
    if (!bodyData || !bodyData.collider) return null;
    return bodyData.collider.handle;
  }

  public deactivate(): void {
    if (!this.isActive && this.bodies.size === 0) return;
    this.physicsEngine.setMutating(true);
    try {
      this.bodies.forEach((data) => {
        try { if (data.rigidBody.isValid()) { this.physicsEngine.unregisterVelocityClampBody(data.rigidBody); this.world.removeRigidBody(data.rigidBody); } }
        catch (_e) { /* ignore removal errors during cleanup */ }
      });
      this.bodies.clear();
      this.rigidBodiesMap.clear();
      this.boneInfoMap = null;
      this.trackedBones.clear();
      this.bindPoseRelativeQuats.clear();
      this.prevFilteredTargets.clear();
      this.motorController.cleanup();
      this.avatarSynchronizer.clear();
      this.isActive = false;
      Logger.info('HumanoidMultiBodyManager: Deactivated');
    } finally { this.physicsEngine.setMutating(false); this.physicsEngine.setReady(true); }
  }

  private estimateBoneLength(
    boneName: string,
    boneInfo: { bone: THREE.Bone; worldPosition: THREE.Vector3 },
    allBones: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>
  ): number {
    const firstChild = boneInfo.bone.children.find((child): child is THREE.Bone => {
      if (!(child instanceof THREE.Bone)) return false;
      return allBones.has(child.name.toLowerCase().replace(/:/g, ''));
    });
    if (firstChild) {
      const childInfo = allBones.get(firstChild.name.toLowerCase().replace(/:/g, ''));
      if (childInfo) {
        const dx = childInfo.worldPosition.x - boneInfo.worldPosition.x;
        const dy = childInfo.worldPosition.y - boneInfo.worldPosition.y;
        const dz = childInfo.worldPosition.z - boneInfo.worldPosition.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
    const heuristic: Record<string, number> = {
      'mixamorigspine': 0.25, 'mixamorigneck': 0.10, 'mixamorighead': 0.12,
      'mixamorigleftarm': 0.30, 'mixamorigrightarm': 0.30,
      'mixamorigleftforearm': 0.27, 'mixamorigrightforearm': 0.27,
      'mixamoriglefthand': 0.10, 'mixamorigrighthand': 0.10,
      'mixamorigleftupleg': 0.42, 'mixamorigrightupleg': 0.42,
      'mixamorigleftleg': 0.40, 'mixamorigrightleg': 0.40,
      'mixamorigleftfoot': 0.12, 'mixamorigrightfoot': 0.12,
    };
    return heuristic[boneName] ?? 0.15;
  }
}
