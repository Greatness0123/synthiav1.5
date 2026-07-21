import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MuJoCoPhysicsEngine } from './MuJoCoPhysicsEngine';
import { MuJoCoBodyManager } from './MuJoCoBodyManager';
import { MuJoCoMotorController } from './MuJoCoMotorController';
import type { TimelineSequence, ValidateResult } from '../../types/joint';
import { clampAngle, isScalarPayload, normalizeBoneKey } from '../../types/joint';
import SYNTHIA_RIG_CONSTRAINTS from '../../constants/rigConstraints';
import { logger as Logger } from '../../utils/logger';
import { ObservationBuilder } from './ObservationBuilder';
import { AvatarSynchronizer } from './AvatarSynchronizer';
import {
  getAnatomicalLimitForBone,
  WORLD_BOUNDARY_RADIUS,
} from '../../constants/anatomicalLimits';
import type { ActionApplyResult, RejectedAction } from '../../types/agent';

// Proxy mimicking RAPIER.RigidBody so that ObservationBuilder and AvatarSynchronizer can work seamlessly with zero duplication!
export class MuJoCoBodyProxy {
  private bodyId: number;
  private model: any;
  private data: any;

  constructor(bodyId: number, model: any, data: any, _module: any) {
    this.bodyId = bodyId;
    this.model = model;
    this.data = data;
  }

  public isValid(): boolean {
    return this.bodyId >= 0 && this.model !== null;
  }

  public translation() {
    const idx = this.bodyId * 3;
    const posMj: [number, number, number] = [
      this.data.xpos[idx],
      this.data.xpos[idx + 1],
      this.data.xpos[idx + 2]
    ];
    return MuJoCoPhysicsEngine.mujocoToWorld(posMj);
  }

  public rotation() {
    const idx = this.bodyId * 4;
    const qMj: [number, number, number, number] = [
      this.data.xquat[idx],
      this.data.xquat[idx + 1],
      this.data.xquat[idx + 2],
      this.data.xquat[idx + 3]
    ];
    const threeQuatObj = MuJoCoPhysicsEngine.mujocoQuatToThree(qMj);
    return {
      x: threeQuatObj.x,
      y: threeQuatObj.y,
      z: threeQuatObj.z,
      w: threeQuatObj.w
    };
  }

  public linvel() {
    const idx = this.bodyId * 6;
    const lMj: [number, number, number] = [
      this.data.cvel[idx + 3],
      this.data.cvel[idx + 4],
      this.data.cvel[idx + 5]
    ];
    return MuJoCoPhysicsEngine.mujocoToWorld(lMj);
  }

  public angvel() {
    const idx = this.bodyId * 6;
    const aMj: [number, number, number] = [
      this.data.cvel[idx],
      this.data.cvel[idx + 1],
      this.data.cvel[idx + 2]
    ];
    return MuJoCoPhysicsEngine.mujocoToWorld(aMj);
  }
}

interface BoneInfo {
  bone: THREE.Bone;
  worldPosition: THREE.Vector3;
  name: string;
}

export class HumanoidPhysicsBinderMuJoCo {
  private physicsEngine: MuJoCoPhysicsEngine;
  private scene: THREE.Scene;
  private modelRoot: THREE.Group | null = null;
  private skeleton: THREE.Skeleton | null = null;
  private skinnedMesh: THREE.SkinnedMesh | null = null;
  private boneInfoMap: Map<string, BoneInfo> = new Map();
  private bindPoseQuaternions: Map<string, THREE.Quaternion> = new Map();
  private debugSpheres: Map<string, THREE.Mesh> = new Map();
  private cameraHelpers: THREE.Group[] = [];
  private isLoaded: boolean = false;

  private bodyManager: MuJoCoBodyManager;
  private motorController: MuJoCoMotorController;
  private avatarSynchronizer: AvatarSynchronizer;

  private buildStep: 'A' | 'B' | 'C' | 'D' | null = null;

  public restArmAngleDeg: number = 75;
  private currentStiffness: number = 0;
  private currentDamping: number = 0;
  public friction: number = 0.5;

  private currentTargets: Map<string, any> = new Map();
  private jointLimits: Map<string, { min: number; max: number }> = new Map();
  private _lerpSpeed: number = 0.12;

  private lastAiCommandTime: number = Date.now();
  private airborneTimer: number = 0;
  private groundingMagnetStrength: number = 0.0;
  private targetSpawnGrounded: boolean = false;
  private groundSurfaceY: number = 0.0;

  private hipToFootDistance: number = 0.95;
  private modelHeight: number = 1.8;
  private capsuleRadius: number = 0.2;

  private _isGrounded: boolean = true;
  private readonly GROUND_SNAP_THRESHOLD: number = 0.12;

  private upVector: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private forwardVector: THREE.Vector3 = new THREE.Vector3(0, 0, 1);

  private previousFootPositions: Map<string, THREE.Vector3> = new Map();
  private readonly KGRF_MULTIPLIER: number = 150.0;

  private capsuleCenterY: number = 0;

  private timelineQueue: TimelineSequence = [];
  private timelineSequenceStart: number | null = null;

  public mbActive: boolean = false;
  private observationBuilder: ObservationBuilder = new ObservationBuilder();

  constructor(physicsEngine: MuJoCoPhysicsEngine, scene: THREE.Scene) {
    this.physicsEngine = physicsEngine;
    this.scene = scene;
    this.bodyManager = new MuJoCoBodyManager(physicsEngine);
    this.motorController = new MuJoCoMotorController();
    this.avatarSynchronizer = new AvatarSynchronizer(0.04);

    // Silence unused fields under tsc -b strict mode
    void this.lastAiCommandTime;
    void this.airborneTimer;
    void this.groundingMagnetStrength;
  }

  public validateAndApplyTimeline(targetSkeleton: THREE.Skeleton, sequence: TimelineSequence, options?: { activeGaitPhase?: boolean }): ValidateResult {
    this.lastAiCommandTime = Date.now();
    this.airborneTimer = 0;
    this.groundingMagnetStrength = 0.0;

    const rejections: string[] = [];
    const clampingNotes: string[] = [];
    const injections: string[] = [];

    const frames = (sequence || []).slice().sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
    const appliedTimeline: TimelineSequence = [];

    for (const frame of frames) {
      const sanitizedOverrides: Record<string, number | [number, number, number]> = {};

      for (const [rawKey, rawVal] of Object.entries(frame.overrides || {})) {
        const key = normalizeBoneKey(rawKey);

        let bone = targetSkeleton.getBoneByName ? targetSkeleton.getBoneByName(key) : null;
        if (!bone) {
          bone = targetSkeleton.bones?.find((b) => normalizeBoneKey(b.name) === key) || null;
        }
        if (!bone) {
          rejections.push(`unknown_bone:${rawKey}`);
          continue;
        }

        const constraint = SYNTHIA_RIG_CONSTRAINTS[key];
        if (!constraint) {
          rejections.push(`unknown_constraint:${key}`);
          continue;
        }

        const cap = options?.activeGaitPhase && constraint.allowance?.locomotionCap ? constraint.allowance.locomotionCap : undefined;

        let xVal = 0, yVal = 0, zVal = 0;
        if (isScalarPayload(rawVal)) {
          xVal = typeof rawVal === 'number' ? rawVal : rawVal[0];
        } else if (Array.isArray(rawVal) && rawVal.length === 3) {
          xVal = rawVal[0]; yVal = rawVal[1]; zVal = rawVal[2];
        } else {
          rejections.push(`invalid_payload:${key}`);
          continue;
        }

        const clampX = (v: number) => {
          let min = constraint.x[0];
          let max = constraint.x[1];
          if (typeof cap === 'number') {
            min = min * cap;
            max = max * cap;
          }

          if (constraint.dof === 1 && constraint.x[1] === 0.0 && v > 0) {
            clampingNotes.push(`${key}:positive_x_clamped_to_0`);
            return 0.0;
          }
          const res = clampAngle(v, min, max);
          if (res !== v) clampingNotes.push(`${key}:x_clamped:${v}->${res}`);
          return res;
        };

        const clampY = (v: number) => {
          let min = constraint.y[0];
          let max = constraint.y[1];
          if (typeof cap === 'number') { min = min * cap; max = max * cap; }
          const res = clampAngle(v, min, max);
          if (res !== v) clampingNotes.push(`${key}:y_clamped:${v}->${res}`);
          return res;
        };

        const clampZ = (v: number) => {
          let min = constraint.z[0];
          let max = constraint.z[1];
          if (typeof cap === 'number') { min = min * cap; max = max * cap; }
          const res = clampAngle(v, min, max);
          if (res !== v) clampingNotes.push(`${key}:z_clamped:${v}->${res}`);
          return res;
        };

        if (constraint.dof === 1) {
          const xClamped = clampX(xVal);
          sanitizedOverrides[key] = xClamped;

          if (constraint.allowance?.tendonSynergyLink) {
            const baseKey = key.replace(/(\d)$/, '1');
            const baseOverrideInFrame = frame.overrides?.[baseKey] !== undefined || sanitizedOverrides[baseKey] !== undefined;
            if (!baseOverrideInFrame) {
              const baseTarget = this.currentTargets.get(baseKey) as any;
              const baseAngle = typeof baseTarget === 'number' ? baseTarget : (baseTarget && baseTarget.x) || 0;
              if (Math.abs(baseAngle) <= 0.01) {
                rejections.push(`tendon_synergy_violation:${key}`);
                continue;
              }
            }
          }
        } else {
          const xC = clampX(xVal);
          const yC = clampY(yVal);
          const zC = clampZ(zVal);
          sanitizedOverrides[key] = [xC, yC, zC];
        }

        if (constraint.allowance?.scapulohumeralRatio) {
          const armX = xVal;
          if (Math.abs(armX) > 0.523) {
            const shoulderKey = key.includes('left') ? 'mixamorigleftshoulder' : 'mixamorigrightshoulder';
            const delta = Math.max(-0.2618, Math.min(0.2618, (armX - Math.sign(armX) * 0.523) / 2.0));

            const existing = sanitizedOverrides[shoulderKey];
            if (existing === undefined) {
              sanitizedOverrides[shoulderKey] = [delta, 0, 0];
            } else if (Array.isArray(existing)) {
              existing[0] = clampX((existing[0] || 0) + delta);
              sanitizedOverrides[shoulderKey] = existing;
            }
            injections.push(`scapulohumeral_inject:${shoulderKey}:${delta.toFixed(4)}`);
          }
        }

        if (key === 'mixamorigneck' && constraint.allowance?.requiresCervicalCoupling) {
          const neckY = yVal;
          const zInject = -0.15 * neckY;
          const existing = sanitizedOverrides['mixamorigneck'];
          if (!existing) {
            sanitizedOverrides['mixamorigneck'] = [xVal, clampY(neckY), clampZ(zInject)];
          } else if (Array.isArray(existing)) {
            existing[2] = clampZ((existing[2] || 0) + zInject);
            sanitizedOverrides['mixamorigneck'] = existing;
          }
          injections.push(`cervical_counter_tilt:mixamorigneck:${zInject.toFixed(4)}`);
        }
      }

      appliedTimeline.push({ timeOffsetMs: frame.timeOffsetMs, overrides: sanitizedOverrides });
    }

    this.timelineQueue = appliedTimeline;
    return { appliedTimeline, rejections, clampingNotes, injections };
  }

  public async loadAndVisualizeBindPose(spawnPoint: THREE.Vector3): Promise<boolean> {
    this.physicsEngine.setMutating(true);
    this.physicsEngine.setReady(false);

    try {
      this.cleanup();

      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.load(
          '/models/x-bot.glb',
          resolve,
          undefined,
          (err) => {
            Logger.error('HumanoidPhysicsBinderMuJoCo: Failed to load x-bot.glb', err);
            reject(err);
          }
        );
      });

      const modelRoot: THREE.Group = gltf.scene;
      this.modelRoot = modelRoot;
      modelRoot.userData.isSynthiaPrimitive = true;
      this.scene.add(modelRoot);
      modelRoot.position.copy(spawnPoint);

      modelRoot.traverse((child) => {
        if ((child as any).isSkinnedMesh) {
          this.skinnedMesh = child as THREE.SkinnedMesh;
        }
      });

      if (!this.skinnedMesh) {
        throw new Error('HumanoidPhysicsBinderMuJoCo: No SkinnedMesh found in model');
      }

      this.skeleton = this.skinnedMesh.skeleton;
      if (!this.skeleton || this.skeleton.bones.length === 0) {
        throw new Error('HumanoidPhysicsBinderMuJoCo: Skeleton has no bones');
      }

      modelRoot.updateMatrixWorld(true);
      this.extractBonePositions();
      this.calculateCameraVectors();
      this.calculateModelDimensions();
      this.renderDebugSpheres();

      this.buildStep = 'A';
      this.isLoaded = true;
      this.physicsEngine.setReady(true);

      Logger.info(`HumanoidPhysicsBinderMuJoCo STEP A Complete: Loaded model with ${this.boneInfoMap.size} bones.`);
      return true;
    } catch (error) {
      Logger.error('HumanoidPhysicsBinderMuJoCo STEP A: Failed', error);
      return false;
    } finally {
      this.physicsEngine.setMutating(false);
    }
  }

  private calculateModelDimensions(): void {
    let highestY: number | null = null;
    let lowestY: number | null = null;

    this.boneInfoMap.forEach((info) => {
      if (highestY === null || info.worldPosition.y > highestY) {
        highestY = info.worldPosition.y;
      }
      if (lowestY === null || info.worldPosition.y < lowestY) {
        lowestY = info.worldPosition.y;
      }
    });

    if (highestY !== null && lowestY !== null) {
      this.modelHeight = Math.abs(highestY - lowestY) + 0.15;
    }

    let leftShoulderX: number | null = null;
    let rightShoulderX: number | null = null;

    this.boneInfoMap.forEach((info, name) => {
      if (name.includes('leftshoulder') || name.includes('leftarm')) {
        if (leftShoulderX === null) leftShoulderX = info.worldPosition.x;
      }
      if (name.includes('rightshoulder') || name.includes('rightarm')) {
        if (rightShoulderX === null) rightShoulderX = info.worldPosition.x;
      }
    });

    if (leftShoulderX !== null && rightShoulderX !== null) {
      const shoulderWidth = Math.abs(leftShoulderX - rightShoulderX);
      this.capsuleRadius = Math.max(0.15, Math.min(0.3, shoulderWidth / 3));
    }
  }

  private calculateCameraVectors(): void {
    if (!this.skeleton) return;

    let headPos: THREE.Vector3 | null = null;
    let headBone: THREE.Bone | null = null;
    let neckPos: THREE.Vector3 | null = null;
    let leftArmPos: THREE.Vector3 | null = null;
    let rightArmPos: THREE.Vector3 | null = null;

    for (const bone of this.skeleton.bones) {
      const name = bone.name.toLowerCase();
      const worldPos = new THREE.Vector3();
      bone.getWorldPosition(worldPos);

      if (name.includes('head') && !name.includes('headtop')) {
        headPos = worldPos.clone();
        headBone = bone;
      }
      if (name.includes('neck')) neckPos = worldPos.clone();
      if (name.includes('leftarm') && !name.includes('forearm')) leftArmPos = worldPos.clone();
      if (name.includes('rightarm') && !name.includes('forearm')) rightArmPos = worldPos.clone();
    }

    if (headPos && neckPos) {
      this.upVector.subVectors(headPos, neckPos).normalize();
    } else {
      this.upVector.set(0, 1, 0);
    }

    if (leftArmPos && rightArmPos && headPos && neckPos) {
      const armVec = new THREE.Vector3().subVectors(rightArmPos, leftArmPos).normalize();
      this.forwardVector.crossVectors(this.upVector, armVec).normalize();
    } else {
      this.forwardVector.set(0, 0, 1);
    }

    if (headBone) {
      const headWorldQuat = new THREE.Quaternion();
      headBone.getWorldQuaternion(headWorldQuat);
      const headWorldQuatInv = headWorldQuat.clone().invert();
      this.upVector.applyQuaternion(headWorldQuatInv);
      this.forwardVector.applyQuaternion(headWorldQuatInv);
    }
  }

  private extractBonePositions(): void {
    if (!this.skeleton) return;

    this.boneInfoMap.clear();
    this.bindPoseQuaternions.clear();

    for (const bone of this.skeleton.bones) {
      if (this.isTerminal(bone)) continue;

      const worldPos = new THREE.Vector3();
      bone.getWorldPosition(worldPos);
      const canonicalName = bone.name.toLowerCase().replace(/:/g, '');

      this.boneInfoMap.set(canonicalName, {
        bone,
        worldPosition: worldPos.clone(),
        name: canonicalName,
      });

      this.bindPoseQuaternions.set(canonicalName, bone.quaternion.clone());

      const limits = getAnatomicalLimitForBone(canonicalName);
      if (limits) {
        this.jointLimits.set(canonicalName, limits);
      }
    }

    this.calculateHipToFootDistance();
  }

  private calculateHipToFootDistance(): void {
    let hipY: number | null = null;
    let lowestFootY: number | null = null;

    this.boneInfoMap.forEach((info, name) => {
      if (name.includes('hips') || name.includes('pelvis') || name.includes('hip')) {
        if (hipY === null || info.worldPosition.y < hipY) {
          hipY = info.worldPosition.y;
        }
      }
      if (name.includes('foot') || name.includes('toe')) {
        if (lowestFootY === null || info.worldPosition.y < lowestFootY) {
          lowestFootY = info.worldPosition.y;
        }
      }
    });

    if (hipY !== null && lowestFootY !== null) {
      this.hipToFootDistance = Math.abs(hipY - lowestFootY);
    }
  }

  public getSpawnHipY(groundY: number = 0): number {
    return groundY + this.hipToFootDistance;
  }

  public repositionModel(x: number, y: number, z: number): void {
    if (!this.modelRoot || !this.skeleton) return;
    this.modelRoot.position.set(x, y, z);
    this.modelRoot.updateMatrixWorld(true);

    this.boneInfoMap.forEach((info) => {
      const worldPos = new THREE.Vector3();
      info.bone.getWorldPosition(worldPos);
      info.worldPosition.copy(worldPos);
    });

    this.calculateModelDimensions();
  }

  public renderDebugSpheres(show: boolean = false): void {
    this.debugSpheres.forEach(sphere => {
      this.scene.remove(sphere);
      (sphere.geometry as THREE.BufferGeometry).dispose();
      (sphere.material as THREE.Material).dispose();
    });
    this.debugSpheres.clear();

    if (!show) return;

    this.boneInfoMap.forEach((boneInfo, boneName) => {
      const geometry = new THREE.SphereGeometry(0.02, 8, 8);
      const material = new THREE.MeshStandardMaterial({
        color: 0x55ff55,
        transparent: true,
        opacity: 0.5,
      });

      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(boneInfo.worldPosition);
      this.scene.add(sphere);
      this.debugSpheres.set(boneName, sphere);
    });
  }

  public renderAICameraHelper(show: boolean = false, cameraData?: Array<{ label: string; position: THREE.Vector3; quaternion: THREE.Quaternion; color: number }>): void {
    if (!show) {
      this.cameraHelpers.forEach(h => h.visible = false);
      return;
    }

    if (!cameraData || cameraData.length === 0) return;

    while (this.cameraHelpers.length < cameraData.length) {
      const idx = this.cameraHelpers.length;
      const cam = cameraData[idx];

      const group = new THREE.Group();
      group.renderOrder = 1000;

      const bodyGeo = new THREE.BoxGeometry(0.12, 0.08, 0.15);
      const bodyMat = new THREE.MeshBasicMaterial({ color: cam.color, wireframe: true, depthTest: false });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.renderOrder = 1000;
      group.add(body);

      const lineGeo = new THREE.CylinderGeometry(0.006, 0.006, 3.0);
      const lineMat = new THREE.MeshBasicMaterial({ color: cam.color, depthTest: false });
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.rotation.x = Math.PI / 2;
      line.position.z = 1.5;
      line.renderOrder = 1000;
      group.add(line);

      this.scene.add(group);
      this.cameraHelpers.push(group);
    }

    cameraData.forEach((cam, i) => {
      const helper = this.cameraHelpers[i];
      if (!helper) return;
      helper.visible = true;
      helper.position.copy(cam.position);
      helper.quaternion.copy(cam.quaternion);
    });
  }

  private isTerminal(bone: THREE.Bone): boolean {
    const name = bone.name.toLowerCase();
    const fingerPattern = /(thumb|index|middle|ring|pinky)\d+$/;
    if (fingerPattern.test(name)) return false;

    const fingerToeTerminals = ['thumb4', 'index4', 'middle4', 'ring4', 'pinky4', 'index_tip', 'middle_tip', 'thumb_tip', 'pinky_tip'];
    if (fingerToeTerminals.some(t => name.includes(t))) return true;

    if (name.endsWith('_end') || name.endsWith('end')) return true;
    if (bone.children.length === 0) return true;
    return false;
  }

  public async createRigidBodiesAndColliders(): Promise<boolean> {
    if (!this.isLoaded || !this.modelRoot || !this.skeleton) {
      Logger.error('HumanoidPhysicsBinderMuJoCo STEP B: Model not loaded.');
      return false;
    }

    this.physicsEngine.setMutating(true);
    this.physicsEngine.setReady(false);

    try {
      this.capsuleCenterY = this.modelHeight / 2;

      // Delegate activation directly to MuJoCoBodyManager!
      const success = await this.bodyManager.activate(
        this.boneInfoMap,
        this.skeleton,
        null,
        this.capsuleCenterY,
        this.modelRoot
      );

      if (success) {
        const world = this.physicsEngine.getWorld();
        this.motorController.init(
          this.bodyManager.getActuatorMap(),
          world.model,
          world.data
        );
      }

      this.buildStep = 'B';
      this.physicsEngine.setReady(true);
      return success;
    } catch (error) {
      Logger.error('HumanoidPhysicsBinderMuJoCo STEP B: Failed', error);
      return false;
    } finally {
      this.physicsEngine.setMutating(false);
    }
  }

  public async createJointsWithZeroMotors(): Promise<boolean> {
    this.buildStep = 'C';
    return true;
  }

  public async activateMotorsWithStiffnessAndDamping(stiffness: number, damping: number): Promise<boolean> {
    this.currentStiffness = stiffness;
    this.currentDamping = damping;
    this.buildStep = 'D';
    return true;
  }

  public async activateMultiBody(): Promise<boolean> {
    if (this.buildStep !== 'D' || !this.modelRoot || !this.skeleton) return false;
    if (this.mbActive) return true;

    try {
      const world = this.physicsEngine.getWorld();
      const module = MuJoCoPhysicsEngine.getModule();
      if (!module) return false;

      const rigidBodiesMap = new Map<string, MuJoCoBodyProxy>();
      const bodyIds = this.bodyManager.getRigidBodiesMap();
      const capsuleBodyId = this.bodyManager.getCapsuleBody();

      for (const [boneName, bodyId] of bodyIds) {
        if (boneName === 'root_capsule') continue;
        const proxy = new MuJoCoBodyProxy(bodyId, world.model, world.data, module);
        rigidBodiesMap.set(boneName, proxy);
      }

      this.observationBuilder.clear();
      if (capsuleBodyId !== null && capsuleBodyId >= 0) {
        const capsuleProxy = new MuJoCoBodyProxy(capsuleBodyId, world.model, world.data, module);
        this.observationBuilder.registerJoint('capsule', capsuleProxy as any, null);

        for (const [boneName, proxy] of rigidBodiesMap) {
          this.observationBuilder.registerJoint(
            boneName,
            proxy as any,
            capsuleProxy as any
          );
        }
      }

      this.avatarSynchronizer.clear();
      for (const [boneName] of rigidBodiesMap) {
        const info = this.boneInfoMap.get(boneName);
        if (!info) continue;
        this.avatarSynchronizer.registerBone(boneName, info.bone.name, {
          canonicalName: boneName, syncRotation: true, syncTranslation: false, rootOffsetY: 0,
        });
      }

      this.observationBuilder.setGroundHeight(0);
      this.mbActive = true;
      Logger.info('HumanoidPhysicsBinderMuJoCo: Multi-body active');
      return true;
    } catch (error) {
      Logger.error('HumanoidPhysicsBinderMuJoCo: Multi-body activation failed', error);
      return false;
    }
  }

  public deactivateMultiBody(): void {
    this.observationBuilder.clear();
    this.avatarSynchronizer.clear();
    this.mbActive = false;
    Logger.info('HumanoidPhysicsBinderMuJoCo: Multi-body deactivated');
  }

  public getMultiBodyManager() {
    return this.bodyManager;
  }

  public getObservationBuilder(): ObservationBuilder {
    return this.observationBuilder;
  }

  public syncVisuals(): void {
    if (!this.isLoaded || !this.modelRoot) return;

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;
    const module = MuJoCoPhysicsEngine.getModule();
    if (!module) return;

    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId === null || capsuleBodyId < 0) return;

    // 1. Position and orient the Three.js model root using MuJoCo capsule body
    const capsuleProxy = new MuJoCoBodyProxy(capsuleBodyId, model, data, module);
    const t = capsuleProxy.translation();
    const r = capsuleProxy.rotation();

    this.modelRoot.position.set(t.x, t.y - this.capsuleCenterY, t.z);
    this.modelRoot.quaternion.set(r.x, r.y, r.z, r.w);

    // 2. Perform downward ground raycasting using mj_ray (as verified in Step 1)
    const capsulePosMj = [
      data.xpos[capsuleBodyId * 3],
      data.xpos[capsuleBodyId * 3 + 1],
      data.xpos[capsuleBodyId * 3 + 2]
    ];
    const downDirMj = [0, 0, -1];
    const geomgroup = [1, 1, 1, 1, 1, 1];
    const geomIdBuffer = new module.IntBuffer(1);

    // Call mj_ray (exclude capsule geom)
    const capsuleGeomId = this.bodyManager.getBoneColliderHandle('root_capsule') ?? -1;
    const dist = module.mj_ray(model, data, capsulePosMj, downDirMj, geomgroup, true, capsuleGeomId, geomIdBuffer, null);

    if (dist >= 0) {
      // In Three.js world, Y is vertical:
      this.groundSurfaceY = t.y - dist;
    } else {
      this.groundSurfaceY = 0.0;
    }
    geomIdBuffer.delete();

    // Spawn alignment
    if (!this.targetSpawnGrounded && dist >= 0) {
      let lowestFootY = Infinity;
      for (const [name, info] of this.boneInfoMap) {
        if (name.includes('foot') || name.includes('toe')) {
          const worldPos = new THREE.Vector3();
          info.bone.getWorldPosition(worldPos);
          if (worldPos.y < lowestFootY) lowestFootY = worldPos.y;
        }
      }

      if (lowestFootY < Infinity) {
        const delta = this.groundSurfaceY - lowestFootY;
        if (Math.abs(delta) > 0.001) {
          this.setCapsulePosition(t.x, t.y + delta - this.capsuleCenterY, t.z);
        }
      }
      this.targetSpawnGrounded = true;
    }

    const capsuleBottomY = t.y - this.capsuleCenterY;
    this._isGrounded = capsuleBottomY <= (this.groundSurfaceY + this.GROUND_SNAP_THRESHOLD);

    // Kinematic ground reaction forces
    this.applyKinematicGroundReactionForces();

    // 3. Synchronize visual bones with proxies!
    if (this.mbActive) {
      const bonesSyncMap = new Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>();
      for (const [canonical] of this.bodyManager.getRigidBodiesMap()) {
        if (canonical === 'root_capsule') continue;
        const boneInfo = this.boneInfoMap.get(canonical);
        if (!boneInfo) continue;
        const worldPos = new THREE.Vector3();
        boneInfo.bone.getWorldPosition(worldPos);
        bonesSyncMap.set(canonical, { bone: boneInfo.bone, worldPosition: worldPos });
      }

      const proxiesMap = new Map<string, MuJoCoBodyProxy>();
      for (const [canonical, bodyId] of this.bodyManager.getRigidBodiesMap()) {
        if (canonical === 'root_capsule') continue;
        proxiesMap.set(canonical, new MuJoCoBodyProxy(bodyId, model, data, module));
      }

      this.avatarSynchronizer.synchronize(bonesSyncMap, proxiesMap as any);
    }

    this.modelRoot.updateMatrixWorld(true);

    if (this.debugSpheres.size > 0 && this.skeleton) {
      this.boneInfoMap.forEach((boneInfo, boneName) => {
        const debugSphere = this.debugSpheres.get(boneName);
        if (debugSphere) {
          const worldPos = new THREE.Vector3();
          boneInfo.bone.getWorldPosition(worldPos);
          debugSphere.position.copy(worldPos);
        }
      });
    }

    // Timeline stepper interpolation logic (identical to HumanoidPhysicsBinder.ts)
    if (this.timelineQueue.length > 0) {
      if (this.timelineSequenceStart === null) {
        this.timelineSequenceStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      }

      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const elapsed = now - (this.timelineSequenceStart as number);
      const sorted = this.timelineQueue.slice().sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);

      let activeIdx = -1;
      for (let i = 0; i < sorted.length; i++) {
        if ((sorted[i].timeOffsetMs || 0) <= elapsed) {
          activeIdx = i;
        } else {
          break;
        }
      }

      if (activeIdx >= 0) {
        const activeFrame = sorted[activeIdx];
        const nextFrame = activeIdx + 1 < sorted.length ? sorted[activeIdx + 1] : null;

        if (nextFrame) {
          const duration = nextFrame.timeOffsetMs - activeFrame.timeOffsetMs;
          const t_interp = duration > 0 ? Math.max(0, Math.min(1, (elapsed - activeFrame.timeOffsetMs) / duration)) : 1;

          const interpolatedOverrides: Record<string, number | [number, number, number]> = {};
          const allKeys = new Set([
            ...Object.keys(activeFrame.overrides || {}),
            ...Object.keys(nextFrame.overrides || {}),
          ]);

          for (const key of allKeys) {
            const startVal = activeFrame.overrides?.[key];
            const endVal = nextFrame.overrides?.[key];

            if (startVal !== undefined && endVal !== undefined) {
              if (typeof startVal === 'number' && typeof endVal === 'number') {
                interpolatedOverrides[key] = startVal + (endVal - startVal) * t_interp;
              } else if (Array.isArray(startVal) && Array.isArray(endVal) && startVal.length === 3 && endVal.length === 3) {
                interpolatedOverrides[key] = [
                  startVal[0] + (endVal[0] - startVal[0]) * t_interp,
                  startVal[1] + (endVal[1] - startVal[1]) * t_interp,
                  startVal[2] + (endVal[2] - startVal[2]) * t_interp,
                ];
              } else {
                interpolatedOverrides[key] = endVal;
              }
            } else if (endVal !== undefined) {
              interpolatedOverrides[key] = endVal;
            } else if (startVal !== undefined) {
              interpolatedOverrides[key] = startVal;
            }
          }

          this.setMotorTargets(interpolatedOverrides as any);
        } else {
          this.setMotorTargets(activeFrame.overrides as any);
        }
      }

      const GRACE_MS = 50;
      this.timelineQueue = sorted.filter(f => (f.timeOffsetMs || 0) > elapsed - GRACE_MS);
      if (this.timelineQueue.length === 0) this.timelineSequenceStart = null;
    }
  }

  private applyKinematicGroundReactionForces(): void {
    if (!this.modelRoot) return;

    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId === null || capsuleBodyId < 0) return;

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;

    const dofAdr = model.body_dofadr[capsuleBodyId];
    const qvel = data.qvel;

    if (this.mbActive) {
      const registry = this.physicsEngine.getContactForceRegistry();
      const footBones = ['mixamorigleftfoot', 'mixamorigrightfoot'];
      let totalImpulse = new THREE.Vector3(0, 0, 0);
      let totalTorque = new THREE.Vector3(0, 0, 0);

      const capsuleProxy = new MuJoCoBodyProxy(capsuleBodyId, model, data, null);
      const capsulePos = capsuleProxy.translation();
      const modelQuat = this.modelRoot.quaternion.clone();
      const modelForward = new THREE.Vector3(0, 0, -1).applyQuaternion(modelQuat);

      for (const boneName of footBones) {
        const colliderHandle = this.bodyManager.getBoneColliderHandle(boneName);
        if (colliderHandle === null) continue;

        const state = registry.get(colliderHandle);
        if (!state || !state.inContact || state.impulse_magnitude < 0.5) continue;

        const ny = state.contact_normal[1];
        if (ny < 0.3) continue;

        const boneInfo = this.boneInfoMap.get(boneName);
        if (!boneInfo) continue;
        const footPos = new THREE.Vector3();
        boneInfo.bone.getWorldPosition(footPos);

        const forceScale = 1.0 / 60.0;
        const impulseMag = Math.min(state.impulse_magnitude * forceScale, 8.0);

        const contactNormal = new THREE.Vector3(
          state.contact_normal[0],
          state.contact_normal[1],
          state.contact_normal[2]
        );
        const lateralForce = contactNormal.clone();
        lateralForce.y = 0;
        const forwardComponent = lateralForce.dot(modelForward);

        if (Math.abs(forwardComponent) > 0.01) {
          const grf = modelForward.clone().multiplyScalar(forwardComponent * impulseMag);
          totalImpulse.add(grf);
        }

        const offsetFromCenter = footPos.x - capsulePos.x;
        const torqueY = -forwardComponent * impulseMag * offsetFromCenter * 3.0;
        totalTorque.y += Math.max(-5.0, Math.min(5.0, torqueY));
      }

      if (totalImpulse.lengthSq() > 0) {
        // qvel velocity impulse for free joint: deltaV = impulse / mass (mass = 70 kg)
        const mass = 70;
        const deltaV = totalImpulse.clone().multiplyScalar(1 / mass);
        const deltaVMj = MuJoCoPhysicsEngine.worldToMuJoCo(deltaV);
        qvel[dofAdr] += deltaVMj[0];
        qvel[dofAdr + 1] += deltaVMj[1];
        qvel[dofAdr + 2] += deltaVMj[2];
      }
      if (Math.abs(totalTorque.y) > 0) {
        // angular velocity impulse: deltaW = torque / inertia (inertia = 10.0)
        const inertia = 10.0;
        const deltaW = totalTorque.clone().multiplyScalar(1 / inertia);
        const deltaWMj = MuJoCoPhysicsEngine.worldToMuJoCo(deltaW);
        qvel[dofAdr + 3] += deltaWMj[0];
        qvel[dofAdr + 4] += deltaWMj[1];
        qvel[dofAdr + 5] += deltaWMj[2];
      }
      return;
    }

    // Kinematic model foot positions reaction forces
    const feetNames = ['mixamoriglefttoebase', 'mixamorigrighttoebase'];
    let totalImpulse = new THREE.Vector3(0, 0, 0);
    let totalTorque = new THREE.Vector3(0, 0, 0);
    const modelQuat = this.modelRoot.quaternion.clone();

    feetNames.forEach((boneName) => {
      const boneInfo = this.boneInfoMap.get(boneName);
      if (!boneInfo) return;

      const currentPos = new THREE.Vector3();
      boneInfo.bone.getWorldPosition(currentPos);

      const previousPos = this.previousFootPositions.get(boneName);
      if (previousPos) {
        if (currentPos.y <= this.groundSurfaceY + 0.15) {
          const delta = new THREE.Vector3().subVectors(currentPos, previousPos);
          const deltaMag = delta.length();

          const MAX_POSE_FOOT_DELTA = 0.18;
          if (deltaMag > MAX_POSE_FOOT_DELTA) {
            this.previousFootPositions.set(boneName, currentPos.clone());
            return;
          }

          const planarDelta = delta.clone();
          planarDelta.y = 0;
          const planarDeltaMag = planarDelta.length();

          if (planarDeltaMag > 0.001) {
            const modelForward = new THREE.Vector3(0, 0, -1).applyQuaternion(modelQuat);
            const forwardMotion = planarDelta.clone().projectOnVector(modelForward);

            const forwardMag = forwardMotion.length();

            if (forwardMag > 0.002) {
              const grf = forwardMotion.clone().negate().multiplyScalar(this.KGRF_MULTIPLIER);
              const MAX_GRF_IMPULSE = 16.0;
              if (grf.length() > MAX_GRF_IMPULSE) {
                grf.setLength(MAX_GRF_IMPULSE);
              }

              const capsuleProxy = new MuJoCoBodyProxy(capsuleBodyId, model, data, null);
              const capsulePos = capsuleProxy.translation();
              const offsetFromCenter = currentPos.x - capsulePos.x;
              const torqueY = -grf.z * offsetFromCenter * 5.0;
              const MAX_TORQUE_Y = 5.0;

              grf.y = 0;
              totalImpulse.add(grf);
              totalTorque.y += Math.max(-MAX_TORQUE_Y, Math.min(MAX_TORQUE_Y, torqueY));
            }
          }
        }
      }

      this.previousFootPositions.set(boneName, currentPos.clone());
    });

    if (totalImpulse.lengthSq() > 0) {
      const mass = 70;
      const deltaV = totalImpulse.clone().multiplyScalar(1 / mass);
      const deltaVMj = MuJoCoPhysicsEngine.worldToMuJoCo(deltaV);
      qvel[dofAdr] += deltaVMj[0];
      qvel[dofAdr + 1] += deltaVMj[1];
      qvel[dofAdr + 2] += deltaVMj[2];
    }
    if (Math.abs(totalTorque.y) > 0) {
      const inertia = 10.0;
      const deltaW = totalTorque.clone().multiplyScalar(1 / inertia);
      const deltaWMj = MuJoCoPhysicsEngine.worldToMuJoCo(deltaW);
      qvel[dofAdr + 3] += deltaWMj[0];
      qvel[dofAdr + 4] += deltaWMj[1];
      qvel[dofAdr + 5] += deltaWMj[2];
    }
  }

  public getIsGrounded(): boolean {
    return this._isGrounded;
  }

  public executeJump(force: number = 6.0): void {
    this.lastAiCommandTime = Date.now();
    this.airborneTimer = 0;
    this.groundingMagnetStrength = 0.0;

    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId === null || capsuleBodyId < 0) return;

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;

    const dofAdr = model.body_dofadr[capsuleBodyId];
    const qvel = data.qvel;

    if (!this._isGrounded) {
      Logger.info('HumanoidPhysicsBinderMuJoCo.executeJump: Ignored — not grounded.');
      return;
    }

    // Set linear and angular velocities to 0, then add vertical jump impulse to qvel (Z is up in MuJoCo!)
    for (let i = 0; i < 6; i++) {
      qvel[dofAdr + i] = 0;
    }
    const mass = 70;
    const deltaV = force / mass;
    qvel[dofAdr + 2] += deltaV;
    this._isGrounded = false;
    Logger.info(`HumanoidPhysicsBinderMuJoCo.executeJump: Jump impulse Z=${deltaV} applied.`);
  }

  public setBoneRotation(boneName: string, quaternion: THREE.Quaternion): void {
    const boneInfo = this.boneInfoMap.get(boneName.toLowerCase().replace(/:/g, ''));
    if (!boneInfo) return;
    boneInfo.bone.quaternion.copy(quaternion);
  }

  public setCapsulePosition(x: number, y: number, z: number): void {
    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId === null || capsuleBodyId < 0) return;

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;

    const qpos = data.qpos;
    const qvel = data.qvel;

    const module = MuJoCoPhysicsEngine.getModule();
    if (!module) return;

    const rootJntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, 'root_freejoint');
    if (rootJntId >= 0) {
      const qposadr = model.jnt_qposadr[rootJntId];
      const qveladr = model.jnt_dofadr[rootJntId];

      const capsulePosThree = { x, y: y + this.capsuleCenterY, z };
      const capsulePosMj = MuJoCoPhysicsEngine.worldToMuJoCo(capsulePosThree);

      qpos[qposadr] = capsulePosMj[0];
      qpos[qposadr + 1] = capsulePosMj[1];
      qpos[qposadr + 2] = capsulePosMj[2];

      for (let i = 0; i < 6; i++) {
        qvel[qveladr + i] = 0;
      }
    }
  }

  public getJointState(): Record<string, { position: [number, number, number], rotation: [number, number, number, number] }> {
    const state: Record<string, any> = {};

    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId !== null && capsuleBodyId >= 0) {
      const world = this.physicsEngine.getWorld();
      const capsuleProxy = new MuJoCoBodyProxy(capsuleBodyId, world.model, world.data, null);
      const pos = capsuleProxy.translation();
      const rot = capsuleProxy.rotation();

      state['capsule'] = {
        position: [pos.x, pos.y, pos.z] as [number, number, number],
        rotation: [rot.x, rot.y, rot.z, rot.w] as [number, number, number, number],
      };
    }

    if (this.skeleton && this.modelRoot) {
      this.boneInfoMap.forEach((boneInfo, boneName) => {
        const worldPos = new THREE.Vector3();
        boneInfo.bone.getWorldPosition(worldPos);
        const worldQuat = new THREE.Quaternion();
        boneInfo.bone.getWorldQuaternion(worldQuat);

        state[boneName] = {
          position: [worldPos.x, worldPos.y, worldPos.z] as [number, number, number],
          rotation: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w] as [number, number, number, number],
        };
      });
    }

    return state;
  }

  public getHeadTransform(): { position: THREE.Vector3, quaternion: THREE.Quaternion } | null {
    if (!this.skeleton || !this.modelRoot) return null;

    let headBone: THREE.Bone | null = null;
    for (const [name, info] of this.boneInfoMap) {
      if (name.includes('head')) {
        headBone = info.bone;
        break;
      }
    }

    if (!headBone) return null;

    this.modelRoot.updateMatrixWorld(true);

    const headPos = new THREE.Vector3();
    headBone.getWorldPosition(headPos);
    const headQuat = new THREE.Quaternion();
    headBone.getWorldQuaternion(headQuat);

    const forward = this.forwardVector.clone().applyQuaternion(headQuat).normalize();
    const up = this.upVector.clone().applyQuaternion(headQuat).normalize();

    const EYE_FORWARD_OFFSET = 0.50;
    const eyePos = headPos.clone().add(forward.clone().multiplyScalar(EYE_FORWARD_OFFSET));
    const lookTarget = eyePos.clone().add(forward.clone().multiplyScalar(50));

    const camMatrix = new THREE.Matrix4().lookAt(eyePos, lookTarget, up);
    const camQuat = new THREE.Quaternion().setFromRotationMatrix(camMatrix);

    return {
      position: eyePos,
      quaternion: camQuat,
    };
  }

  public getContactForces(): Record<string, { contact: boolean; impulse_magnitude: number; contact_normal: [number, number, number]; touching: string }> {
    const result: Record<string, { contact: boolean; impulse_magnitude: number; contact_normal: [number, number, number]; touching: string }> = {};

    const capsuleGeomId = this.bodyManager.getBoneColliderHandle('root_capsule');
    if (capsuleGeomId === null) return result;

    const registry = this.physicsEngine.getContactForceRegistry();
    const state = registry.get(capsuleGeomId);

    if (state && state.inContact && state.impulse_magnitude > 0.01) {
      let touching = 'unknown';
      const ny = state.contact_normal[1];
      if (ny > 0.7) {
        touching = 'floor';
      } else if (ny < -0.7) {
        touching = 'ceiling';
      } else {
        touching = 'object';
      }

      result['capsule_body'] = {
        contact: true,
        impulse_magnitude: Math.round(state.impulse_magnitude * 1000) / 1000,
        contact_normal: state.contact_normal,
        touching,
      };
    }

    return result;
  }

  public push(_partName: string, impulse: THREE.Vector3): void {
    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId === null || capsuleBodyId < 0) return;

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;

    const dofAdr = model.body_dofadr[capsuleBodyId];
    const qvel = data.qvel;

    // Apply linear velocity change (deltaV = impulse / mass)
    const mass = 70;
    const deltaV = impulse.clone().multiplyScalar(1 / mass);
    const deltaVMj = MuJoCoPhysicsEngine.worldToMuJoCo(deltaV);
    qvel[dofAdr] += deltaVMj[0];
    qvel[dofAdr + 1] += deltaVMj[1];
    qvel[dofAdr + 2] += deltaVMj[2];

    Logger.info(`HumanoidPhysicsBinderMuJoCo: Applied push velocity change: [${deltaV.x.toFixed(2)}, ${deltaV.y.toFixed(2)}, ${deltaV.z.toFixed(2)}]`);
  }

  public setMode(mode: 'rigid' | 'ragdoll'): void {
    if (mode === 'ragdoll') {
      this.motorController.setLimpMode(true);
      Logger.info('HumanoidPhysicsBinderMuJoCo: Switched to RAGDOLL mode — limp active');
    } else {
      this.motorController.setLimpMode(false);
      this.resetToBindPose();
      Logger.info('HumanoidPhysicsBinderMuJoCo: Switched to RIGID mode — position control restored');
    }
  }

  public getBuildStep(): string {
    return this.buildStep || 'UNINITIALIZED';
  }

  public getMotorSettings(): { stiffness: number, damping: number, gravity: number, friction: number } {
    return {
      stiffness: this.currentStiffness,
      damping: this.currentDamping,
      gravity: -9.81,
      friction: this.friction,
    };
  }

  public async nextStep(): Promise<boolean> {
    if (!this.isLoaded) return false;

    const currentStep = this.buildStep;
    if (currentStep === null || currentStep === 'A') {
      return this.createRigidBodiesAndColliders();
    } else if (currentStep === 'B') {
      return this.createJointsWithZeroMotors();
    } else if (currentStep === 'C') {
      return this.activateMotorsWithStiffnessAndDamping(80, 10);
    } else if (currentStep === 'D') {
      if (!this.mbActive) {
        return this.activateMultiBody();
      }
      return true;
    }
    return false;
  }

  public getUprightPreset(): Record<string, any> {
    const preset: Record<string, any> = {
      arms_down_angle_deg: this.restArmAngleDeg,
    };
    this.currentTargets.forEach((val, key) => {
      preset[key] = (val as any).scalar ?? (val as any).x ?? (typeof val === 'number' ? val : 0);
    });
    return preset;
  }

  private resolveJointAlias(name: string): string {
    const JOINT_ALIASES: Record<string, string> = {
      'head_yaw': 'mixamorighead',
      'head_pitch': 'mixamorighead',
      'head_roll': 'mixamorighead',
      'neck_yaw': 'mixamorighead',
      'neck_pitch': 'mixamorighead',
      'neck_roll': 'mixamorighead',
      'torso_yaw': 'mixamorigspine2',
      'torso_pitch': 'mixamorigspine2',
      'torso_roll': 'mixamorigspine2',
      'spine_yaw': 'mixamorigspine',
      'spine_pitch': 'mixamorigspine',
      'spine1_yaw': 'mixamorigspine1',
      'spine1_pitch': 'mixamorigspine1',
      'spine2_yaw': 'mixamorigspine2',
      'spine2_pitch': 'mixamorigspine2',
      'hips_yaw': 'mixamorigspine',
      'lower_back_yaw': 'mixamorigspine',
      'upper_back_yaw': 'mixamorigspine2',
      'right_shoulder_pitch': 'mixamorigrightarm',
      'right_shoulder_roll': 'mixamorigrightarm',
      'right_shoulder_yaw': 'mixamorigrightarm',
      'right_elbow_flex': 'mixamorigrightforearm',
      'right_elbow': 'mixamorigrightforearm',
      'right_wrist_yaw': 'mixamorigrighthand',
      'right_wrist': 'mixamorigrighthand',
      'left_shoulder_pitch': 'mixamorigleftarm',
      'left_shoulder_roll': 'mixamorigleftarm',
      'left_shoulder_yaw': 'mixamorigleftarm',
      'left_elbow_flex': 'mixamorigleftforearm',
      'left_elbow': 'mixamorigleftforearm',
      'left_wrist_yaw': 'mixamoriglefthand',
      'left_wrist': 'mixamoriglefthand',
      'right_hip_pitch': 'mixamorigrightupleg',
      'right_hip_roll': 'mixamorigrightupleg',
      'right_hip_yaw': 'mixamorigrightupleg',
      'right_knee_flex': 'mixamorigrightleg',
      'right_knee': 'mixamorigrightleg',
      'right_ankle_pitch': 'mixamorigrightfoot',
      'right_ankle_roll': 'mixamorigrightfoot',
      'right_ankle': 'mixamorigrightfoot',
      'left_hip_pitch': 'mixamorigleftupleg',
      'left_hip_roll': 'mixamorigleftupleg',
      'left_hip_yaw': 'mixamorigleftupleg',
      'left_knee_flex': 'mixamorigleftleg',
      'left_knee': 'mixamorigleftleg',
      'left_ankle_pitch': 'mixamorigleftfoot',
      'left_ankle_roll': 'mixamorigleftfoot',
      'left_ankle': 'mixamorigleftfoot',
    };
    return JOINT_ALIASES[name] ?? name;
  }

  public setMotorTargets(targets: Record<string, number | number[]>): ActionApplyResult {
    const applied: string[] = [];
    const rejected: RejectedAction[] = [];

    if (this.buildStep !== 'D') {
      return { applied, rejected };
    }

    for (const [boneName, target] of Object.entries(targets)) {
      const aliasedName = this.resolveJointAlias(boneName.toLowerCase().replace(/:/g, ''));
      const canonical = aliasedName;

      if (!this.boneInfoMap.has(canonical)) {
        rejected.push({
          joint: boneName,
          reason: 'unknown_joint',
          requested: target,
        });
        continue;
      }

      let parsedTarget: any = null;
      try {
        if (Array.isArray(target)) {
          if (target.length === 4) {
            parsedTarget = { x: target[0], y: target[1], z: target[2], w: target[3], isQuaternion: true };
          } else if (target.length === 3) {
            parsedTarget = { x: target[0], y: target[1], z: target[2], isQuaternion: false };
          } else if (target.length === 2) {
            parsedTarget = { x: target[0], y: target[1], z: 0, isQuaternion: false };
          } else {
            parsedTarget = { scalar: target[0], isScalar: true };
          }
        } else if (typeof target === 'number') {
          parsedTarget = { scalar: target, isScalar: true };
        } else if (typeof target === 'object' && target !== null) {
          if ('angle' in target) {
            parsedTarget = { scalar: (target as any).angle * (Math.PI / 180), isScalar: true };
          } else if ('x' in target || 'y' in target || 'z' in target) {
            parsedTarget = { x: (target as any).x ?? 0, y: (target as any).y ?? 0, z: (target as any).z ?? 0, isQuaternion: false };
          } else {
            parsedTarget = { scalar: Number(target), isScalar: true };
          }
        } else if (typeof target === 'string') {
          const parsedNumber = parseFloat(target);
          parsedTarget = { scalar: isNaN(parsedNumber) ? 0 : parsedNumber, isScalar: true };
        }
      } catch (err) {
        parsedTarget = { scalar: 0, isScalar: true };
      }

      if (!parsedTarget) {
        parsedTarget = { scalar: 0, isScalar: true };
      }

      const limits = this.jointLimits.get(canonical) ?? getAnatomicalLimitForBone(canonical);
      if (parsedTarget.isScalar && typeof parsedTarget.scalar === 'number') {
        const targetValue = parsedTarget.scalar;
        let finalValue = targetValue;
        if (limits && (targetValue < limits.min || targetValue > limits.max)) {
          finalValue = Math.max(limits.min, Math.min(limits.max, targetValue));
          rejected.push({
            joint: boneName,
            reason: 'exceeds_anatomical_limit',
            requested: targetValue,
            limit_min: limits.min,
            limit_max: limits.max,
          });
        }
        parsedTarget.scalar = finalValue;
      } else if (!parsedTarget.isQuaternion && typeof parsedTarget.x === 'number' && limits) {
        parsedTarget.x = Math.max(limits.min, Math.min(limits.max, parsedTarget.x));
      }

      this.currentTargets.set(canonical, parsedTarget);
      applied.push(boneName);
    }

    return { applied, rejected };
  }

  public updateMotorTargets(): void {
    if (this.buildStep !== 'D') return;

    // Apply native position control
    this.motorController.setTargets(this.currentTargets);

    // Apply root balance control (getBalance torque directly into xfrc_applied)
    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId !== null && capsuleBodyId >= 0) {
      this.motorController.applyCapsuleBalance(capsuleBodyId);
    }
  }

  public setLerpSpeed(speed: number): void {
    this._lerpSpeed = Math.max(0.01, Math.min(1.0, speed));
    void this._lerpSpeed;
  }

  public executeProgramSequence(programs: string[]): void {
    this.lastAiCommandTime = Date.now();
    this.airborneTimer = 0;
    this.groundingMagnetStrength = 0.0;

    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId === null || capsuleBodyId < 0) return;

    for (const program of programs) {
      const name = program.toLowerCase().replace(/[_\s]/g, '');

      if (name.includes('stand') || name.includes('upright') || name.includes('recover') || name.includes('reorient')) {
        this.setCapsulePosition(0, 0.05, 0);
        this.resetToBindPose();
      } else if (name.includes('jump')) {
        this.executeJump(6.0);
      }
    }
  }

  public resetPose(spawnPoint: { x: number; y: number; z: number }): void {
    this.setCapsulePosition(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    this.resetToBindPose();
    this.previousFootPositions.clear();
  }

  public isOutOfWorldBounds(): boolean {
    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId === null || capsuleBodyId < 0) return false;

    const world = this.physicsEngine.getWorld();
    const posMj = [
      world.data.xpos[capsuleBodyId * 3],
      world.data.xpos[capsuleBodyId * 3 + 1],
      world.data.xpos[capsuleBodyId * 3 + 2]
    ];
    const pos = MuJoCoPhysicsEngine.mujocoToWorld(posMj as any);
    const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    return dist > WORLD_BOUNDARY_RADIUS || Math.abs(pos.y) > WORLD_BOUNDARY_RADIUS;
  }

  public resetToBindPose(): void {
    this.currentTargets.clear();

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;
    const qpos = data.qpos;
    const qvel = data.qvel;
    const module = MuJoCoPhysicsEngine.getModule();
    if (!module) return;

    // Reset all hinge qpos values to 0 (which maps perfectly to bind pose in our template!)
    const joints = this.bodyManager.getRigidBodiesMap();
    for (const [boneName] of joints) {
      const hasYaw = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_yaw') >= 0;
      const hasPitch = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_pitch') >= 0;
      const hasRoll = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_roll') >= 0;

      if (hasYaw) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_yaw');
        qpos[model.jnt_qposadr[jntId]] = 0;
        qvel[model.jnt_dofadr[jntId]] = 0;
      }
      if (hasPitch) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_pitch');
        qpos[model.jnt_qposadr[jntId]] = 0;
        qvel[model.jnt_dofadr[jntId]] = 0;
      }
      if (hasRoll) {
        const jntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, boneName + '_roll');
        qpos[model.jnt_qposadr[jntId]] = 0;
        qvel[model.jnt_dofadr[jntId]] = 0;
      }
    }

    const armsDownAngle = this.restArmAngleDeg * (Math.PI / 180);
    this.currentTargets.set('mixamorigrightarm', { x: armsDownAngle, y: 0, z: 0, isQuaternion: false });
    this.currentTargets.set('mixamorigleftarm', { x: armsDownAngle, y: 0, z: 0, isQuaternion: false });
  }

  public async adjustMotors(stiffness: number, damping: number): Promise<boolean> {
    this.currentStiffness = stiffness;
    this.currentDamping = damping;
    return true;
  }

  public getModelRoot(): THREE.Group | null {
    return this.modelRoot;
  }

  public getCapsuleBody(): any {
    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    if (capsuleBodyId === null || capsuleBodyId < 0) return null;
    const world = this.physicsEngine.getWorld();
    return new MuJoCoBodyProxy(capsuleBodyId, world.model, world.data, MuJoCoPhysicsEngine.getModule());
  }

  public getDiagnostics(): Record<string, any> {
    const capsuleBodyId = this.bodyManager.getCapsuleBody();
    let capsulePos = null;
    if (capsuleBodyId !== null && capsuleBodyId >= 0) {
      const world = this.physicsEngine.getWorld();
      const proxy = new MuJoCoBodyProxy(capsuleBodyId, world.model, world.data, null);
      const t = proxy.translation();
      capsulePos = [t.x.toFixed(3), t.y.toFixed(3), t.z.toFixed(3)];
    }

    return {
      buildStep: this.buildStep,
      isLoaded: this.isLoaded,
      boneCount: this.boneInfoMap.size,
      hasCapsuleBody: capsuleBodyId !== null,
      capsulePosition: capsulePos,
      modelHeight: this.modelHeight,
      capsuleRadius: this.capsuleRadius,
      capsuleCenterY: this.capsuleCenterY,
      hipToFootDistance: this.hipToFootDistance,
      currentStiffness: this.currentStiffness,
      currentDamping: this.currentDamping,
      gravity: -9.81,
      friction: this.friction,
      mbActive: this.mbActive,
      multiBodyBoneCount: this.bodyManager.getRigidBodiesMap().size,
      multiBodyMotorJoints: this.motorController.getJointCount(),
    };
  }

  public cleanup(): void {
    this.bodyManager.deactivate();
    this.observationBuilder.clear();
    this.avatarSynchronizer.clear();

    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot.traverse((child) => {
        if ((child as any).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(m => m.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        }
      });
      this.modelRoot = null;
    }

    this.debugSpheres.forEach((sphere) => {
      this.scene.remove(sphere);
      if (sphere.geometry) sphere.geometry.dispose();
      if (sphere.material) (sphere.material as THREE.Material).dispose();
    });
    this.debugSpheres.clear();

    this.boneInfoMap.clear();
    this.bindPoseQuaternions.clear();
    this.skeleton = null;
    this.skinnedMesh = null;
    this.isLoaded = false;
    this.buildStep = null;
    this.mbActive = false;
  }
}
