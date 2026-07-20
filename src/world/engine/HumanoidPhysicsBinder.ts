import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEngine } from './PhysicsEngine';
import type { TimelineSequence, ValidateResult } from '../../types/joint';
import { clampAngle, isScalarPayload, normalizeBoneKey } from '../../types/joint';
import SYNTHIA_RIG_CONSTRAINTS from '../../constants/rigConstraints';
import { logger as Logger } from '../../utils/logger';
import { synthiaToast } from '../../components/ui/Toast';
import { RAGDOLL_GROUP, ENVIRONMENT_GROUP, getCollisionMask } from '../../constants/physics';
import { HumanoidMultiBodyManager, BONE_PD_GAINS } from './HumanoidMultiBodyManager';
import { installDiagnostic, PhysicsDiagnostic } from './PhysicsDiagnostic';
import { ObservationBuilder } from './ObservationBuilder';
import {
  getAnatomicalLimitForBone,
  WORLD_BOUNDARY_RADIUS,
} from '../../constants/anatomicalLimits';
import type { ActionApplyResult, RejectedAction } from '../../types/agent';

interface BoneInfo {
  bone: THREE.Bone;
  worldPosition: THREE.Vector3;
  name: string;
}

export class HumanoidPhysicsBinder {

  private static readonly TPOSE_REFERENCE: Record<string, { x: number, y: number, z: number, w: number }> = {
    'mixamorigrightarm': { x: -0.0246, y: 0.0026, z: -0.1035, w: 0.9943 },
    'mixamorigleftarm': { x: -0.0246, y: -0.0026, z: 0.1035, w: 0.9943 },
    'mixamorigrightshoulder': { x: 0.4844, y: -0.571, z: 0.5262, w: 0.4031 },
    'mixamorigleftshoulder': { x: 0.4844, y: 0.571, z: -0.5262, w: 0.4031 },
  };

  private physicsEngine: PhysicsEngine;
  private scene: THREE.Scene;
  private modelRoot: THREE.Group | null = null;
  private skeleton: THREE.Skeleton | null = null;
  private skinnedMesh: THREE.SkinnedMesh | null = null;
  private boneInfoMap: Map<string, BoneInfo> = new Map();
  private bindPoseQuaternions: Map<string, THREE.Quaternion> = new Map();
  private debugSpheres: Map<string, THREE.Mesh> = new Map();
  private aiCameraHelper: THREE.Mesh | null = null;
  private cameraHelpers: THREE.Group[] = [];
  private isLoaded: boolean = false;

  private capsuleBody: RAPIER.RigidBody | null = null;
  private capsuleCollider: RAPIER.Collider | null = null;

  private buildStep: 'A' | 'B' | 'C' | 'D' | null = null;

  public restArmAngleDeg: number = 75;
  private currentStiffness: number = 0;
  private currentDamping: number = 0;
  private gravity: number = -9.81;
  public friction: number = 0.5;

  private currentTargets: Map<string, any> = new Map();
  private jointLimits: Map<string, { min: number; max: number }> = new Map();
  private lerpSpeed: number = 0.12;

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

  private multiBodyManager: HumanoidMultiBodyManager | null = null;
  public mbActive: boolean = false;

  private observationBuilder: ObservationBuilder = new ObservationBuilder();

  constructor(physicsEngine: PhysicsEngine, scene: THREE.Scene) {
    this.physicsEngine = physicsEngine;
    this.scene = scene;
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
            Logger.error('HumanoidPhysicsBinder: Failed to load x-bot.glb', err);
            synthiaToast.error("Model file not found — place x-bot.glb in public/models/");
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
        throw new Error('HumanoidPhysicsBinder: No SkinnedMesh found in model');
      }

      this.skeleton = this.skinnedMesh.skeleton;
      if (!this.skeleton || this.skeleton.bones.length === 0) {
        throw new Error('HumanoidPhysicsBinder: Skeleton has no bones');
      }

      modelRoot.updateMatrixWorld(true);

      this.extractBonePositions();

      this.calculateCameraVectors();

      this.calculateModelDimensions();

      this.renderDebugSpheres();

      this.buildStep = 'A';
      this.isLoaded = true;
      this.physicsEngine.setReady(true);

      Logger.info(`HumanoidPhysicsBinder STEP A Complete: Loaded model with ${this.boneInfoMap.size} bones.`);
      return true;
    } catch (error) {
      Logger.error('HumanoidPhysicsBinder STEP A: Failed', error);
      synthiaToast.error('STEP A failed: Model loading or bone extraction error');
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
      this.modelHeight = Math.abs(highestY - lowestY);

      this.modelHeight += 0.15;
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

    Logger.info(`HumanoidPhysicsBinder: Model dimensions — height=${this.modelHeight.toFixed(3)}, capsuleRadius=${this.capsuleRadius.toFixed(3)}, hipToFoot=${this.hipToFootDistance.toFixed(3)}`);
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

    Logger.info(`HumanoidPhysicsBinder: Camera vectors (local to head) — Up: [${this.upVector.x.toFixed(2)}, ${this.upVector.y.toFixed(2)}, ${this.upVector.z.toFixed(2)}], Forward: [${this.forwardVector.x.toFixed(2)}, ${this.forwardVector.y.toFixed(2)}, ${this.forwardVector.z.toFixed(2)}]`);
  }

  private extractBonePositions(): void {
    if (!this.skeleton) return;

    this.boneInfoMap.clear();
    this.bindPoseQuaternions.clear();

    for (const bone of this.skeleton.bones) {

      if (this.isTerminal(bone)) {
        continue;
      }

      const worldPos = new THREE.Vector3();
      bone.getWorldPosition(worldPos);

      const canonicalName = bone.name.toLowerCase().replace(/:/g, '');

      this.boneInfoMap.set(canonicalName, {
        bone,
        worldPosition: worldPos.clone(),
        name: canonicalName,
      });

      this.bindPoseQuaternions.set(canonicalName, bone.quaternion.clone());

      const tposeRef = HumanoidPhysicsBinder.TPOSE_REFERENCE[canonicalName];
      if (tposeRef) {
        const stored = this.bindPoseQuaternions.get(canonicalName)!;
        const ref = new THREE.Quaternion(tposeRef.x, tposeRef.y, tposeRef.z, tposeRef.w);
        const angleDiff = stored.angleTo(ref);
        if (angleDiff > 0.02) {
          Logger.warn(
            `HumanoidPhysicsBinder: Bind pose for "${canonicalName}" deviates from T-pose reference by ${(angleDiff * 180 / Math.PI).toFixed(3)}°. ` +
            `Stored: {x:${stored.x.toFixed(6)}, y:${stored.y.toFixed(6)}, z:${stored.z.toFixed(6)}, w:${stored.w.toFixed(6)}} ` +
            `Expected: {x:${tposeRef.x.toFixed(6)}, y:${tposeRef.y.toFixed(6)}, z:${tposeRef.z.toFixed(6)}, w:${tposeRef.w.toFixed(6)}}`
          );
        }
      }

      const limits = getAnatomicalLimitForBone(canonicalName);
      if (limits) {
        this.jointLimits.set(canonicalName, limits);
      }
    }

    this.calculateHipToFootDistance();

    Logger.info(`HumanoidPhysicsBinder: Extracted ${this.boneInfoMap.size} non-terminal bones. Canonical names: ${Array.from(this.boneInfoMap.keys()).join(', ')}`);
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
      Logger.info(`HumanoidPhysicsBinder: Hip Y=${(hipY as number).toFixed(3)}, Lowest foot Y=${(lowestFootY as number).toFixed(3)}, hipToFootDistance=${this.hipToFootDistance.toFixed(3)}`);
    } else {
      Logger.warn('HumanoidPhysicsBinder: Could not find hip or foot bones for height calculation, using default 0.95');
    }
  }

  public getSpawnHipY(groundY: number = 0): number {
    return groundY + this.hipToFootDistance;
  }

  public repositionModel(x: number, y: number, z: number): void {
    if (!this.modelRoot || !this.skeleton) {
      Logger.warn('HumanoidPhysicsBinder.repositionModel: Model not loaded yet');
      return;
    }
    this.modelRoot.position.set(x, y, z);
    this.modelRoot.updateMatrixWorld(true);

    this.boneInfoMap.forEach((info) => {
      const worldPos = new THREE.Vector3();
      info.bone.getWorldPosition(worldPos);
      info.worldPosition.copy(worldPos);
    });

    this.calculateModelDimensions();

    Logger.info(`HumanoidPhysicsBinder: Repositioned model to (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) and re-extracted bone positions.`);
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
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.5,
      });

      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(boneInfo.worldPosition);
      this.scene.add(sphere);

      this.debugSpheres.set(boneName, sphere);
    });

    Logger.info(`HumanoidPhysicsBinder: Rendered ${this.debugSpheres.size} debug spheres`);
  }

  public renderAICameraHelper(show: boolean = false, cameraData?: Array<{ label: string; position: THREE.Vector3; quaternion: THREE.Quaternion; color: number }>): void {

    if (!show) {
      if (this.aiCameraHelper) this.aiCameraHelper.visible = false;
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

      const labelSprite = this.createTextSprite(cam.label, cam.color);
      labelSprite.position.set(0, 0.25, 0);
      labelSprite.renderOrder = 1001;
      group.add(labelSprite);

      this.scene.add(group);
      this.cameraHelpers.push(group);
    }

    cameraData.forEach((cam, i) => {
      const helper = this.cameraHelpers[i];
      if (!helper) return;
      helper.visible = true;
      helper.position.copy(cam.position);
      helper.quaternion.copy(cam.quaternion);

      const body = helper.children[0] as THREE.Mesh;
      if (body && body.material) {
        (body.material as THREE.MeshBasicMaterial).color.setHex(cam.color);
      }
      const lineMesh = helper.children[1] as THREE.Mesh;
      if (lineMesh && lineMesh.material) {
        (lineMesh.material as THREE.MeshBasicMaterial).color.setHex(cam.color);
      }
    });
  }

  private createTextSprite(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hex = '#' + new THREE.Color(color).getHexString();
    ctx.fillStyle = hex;
    ctx.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.25, 1);
    sprite.renderOrder = 1001;
    return sprite;
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
    if (!this.isLoaded || !this.modelRoot) {
      Logger.error('HumanoidPhysicsBinder STEP B: Model not loaded. Run loadAndVisualizeBindPose first.');
      return false;
    }

    this.physicsEngine.setMutating(true);
    this.physicsEngine.setReady(false);

    try {

      const capsuleHalfHeight = Math.max(0.1, (this.modelHeight / 2) - this.capsuleRadius);

      this.capsuleCenterY = this.modelHeight / 2;

      const modelX = this.modelRoot.position.x;
      const modelZ = this.modelRoot.position.z;

      const rbDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(modelX, this.capsuleCenterY, modelZ)
        .setLinearDamping(0.5)
        .setAngularDamping(10.0)
        .setAdditionalMassProperties(
          70,                               // mass = 70 kg
          { x: 0, y: 0, z: 0 },            // center of mass
          { x: 10.0, y: 10.0, z: 10.0 },   // angular inertia (scaled for 70 kg capsule)
          { x: 0, y: 0, z: 0, w: 1 }
        );

      const world = this.physicsEngine.getWorld();
      this.capsuleBody = world.createRigidBody(rbDesc);

      const colDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, this.capsuleRadius);
      colDesc.setDensity(0);
      colDesc.setFriction(this.friction);
      colDesc.setRestitution(0.0);

      colDesc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);

      const collisionMask = getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP);
      colDesc.setCollisionGroups(collisionMask);

      this.capsuleCollider = world.createCollider(colDesc, this.capsuleBody);

      this.physicsEngine.registerVelocityClampBody(this.capsuleBody);

      this.buildStep = 'B';
      this.physicsEngine.setReady(true);

      Logger.info(`HumanoidPhysicsBinder STEP B Complete: Created single capsule body. halfHeight=${capsuleHalfHeight.toFixed(3)}, radius=${this.capsuleRadius.toFixed(3)}, centerY=${this.capsuleCenterY.toFixed(3)}`);
      return true;
    } catch (error) {
      Logger.error('HumanoidPhysicsBinder STEP B: Failed', error);
      synthiaToast.error('STEP B failed: Rigid body/collider creation error');
      return false;
    } finally {
      this.physicsEngine.setMutating(false);
    }
  }

  public async createJointsWithZeroMotors(): Promise<boolean> {
    if (!this.isLoaded || this.buildStep !== 'B') {
      Logger.error('HumanoidPhysicsBinder STEP C: Must complete STEP B first');
      return false;
    }

    this.buildStep = 'C';
    Logger.info('HumanoidPhysicsBinder STEP C Complete: No joints needed (single capsule mode).');
    return true;
  }

  public async activateMotorsWithStiffnessAndDamping(
    stiffness: number,
    damping: number
  ): Promise<boolean> {
    if (!this.isLoaded || this.buildStep !== 'C') {
      Logger.error('HumanoidPhysicsBinder STEP D: Must complete STEP C first');
      return false;
    }

    this.currentStiffness = stiffness;
    this.currentDamping = damping;
    this.buildStep = 'D';

    Logger.info('HumanoidPhysicsBinder STEP D Complete: Single capsule active, model standing.');
    return true;
  }

  public async activateMultiBody(): Promise<boolean> {
    if (this.buildStep !== 'D' || !this.capsuleBody || !this.modelRoot || !this.skeleton) {
      Logger.error('HumanoidPhysicsBinder.activateMultiBody: Must reach STEP D first');
      return false;
    }

    if (this.mbActive && this.multiBodyManager) {
      Logger.info('HumanoidPhysicsBinder.activateMultiBody: Already active');
      return true;
    }

    try {
      this.multiBodyManager = new HumanoidMultiBodyManager(
        this.physicsEngine,
        this.scene
      );

      const success = await this.multiBodyManager.activate(
        this.boneInfoMap,
        this.skeleton,
        this.capsuleBody,
        this.capsuleCenterY,
        this.modelRoot
      );

      if (success) {
        this.mbActive = true;

        this.observationBuilder.clear();
        const rigidBodiesMap = this.multiBodyManager!.getRigidBodiesMap();
        const capsuleBody = this.multiBodyManager!.getCapsuleBody();

        if (capsuleBody && capsuleBody.isValid()) {
          this.observationBuilder.registerJoint('capsule', capsuleBody, null);
        }

        for (const [boneName, body] of rigidBodiesMap) {
          this.observationBuilder.registerJoint(
            boneName,
            body,
            capsuleBody && capsuleBody.isValid() ? capsuleBody : null
          );
        }
        this.observationBuilder.setGroundHeight(0);

        Logger.info('HumanoidPhysicsBinder: Multi-body PD control ACTIVATED');
        synthiaToast.success('Multi-body physics active — PD motor control engaged');

        // Install runtime jitter diagnostic on window.__SYNTHIA_DIAG__
        // @ts-ignore
        if (import.meta.env.DEV) {
          PhysicsDiagnostic.setBonePDGains(BONE_PD_GAINS);
          installDiagnostic(this.multiBodyManager!);
        }
      } else {
        Logger.error('HumanoidPhysicsBinder.activateMultiBody: Activation failed');
        this.multiBodyManager = null;
      }

      return success;
    } catch (error) {
      Logger.error('HumanoidPhysicsBinder.activateMultiBody: Exception', error);
      this.multiBodyManager = null;
      return false;
    }
  }

  public deactivateMultiBody(): void {
    if (this.multiBodyManager) {
      this.multiBodyManager.deactivate();
      this.multiBodyManager = null;
    }
    this.observationBuilder.clear();
    this.mbActive = false;
    Logger.info('HumanoidPhysicsBinder: Multi-body deactivated, reverted to kinematic mode');
  }

  public getMultiBodyManager(): HumanoidMultiBodyManager | null {
    return this.multiBodyManager;
  }

  public getObservationBuilder(): ObservationBuilder {
    return this.observationBuilder;
  }

  public syncVisuals(): void {
    if (!this.isLoaded || !this.capsuleBody || !this.modelRoot) return;
    if (!this.capsuleBody.isValid()) return;

    const t = this.capsuleBody.translation();

    const rayOrigin = { x: t.x, y: t.y, z: t.z };
    const rayDir = { x: 0, y: -1, z: 0 };
    const maxRayDist = 10.0;
    const rapierRay = new RAPIER.Ray(rayOrigin, rayDir);

    const rayFilter = getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP);
    const hit = this.physicsEngine.getWorld().castRayAndGetNormal(
      rapierRay, maxRayDist, false,
      rayFilter,        /* filterGroups — only test ENVIRONMENT_GROUP */
      undefined,        /* filterExcludeCollider — not needed when using group filter */
      undefined
    );

    if (hit) {

      this.groundSurfaceY = rayOrigin.y + rayDir.y * hit.timeOfImpact;
    } else {

      this.groundSurfaceY = 0.0;
    }

    if (!this.targetSpawnGrounded && hit) {
      let lowestFootY = Infinity;
      for (const [name, info] of this.boneInfoMap) {
        if (name.includes('foot') || name.includes('toe') || name.includes('toebase')) {
          const worldPos = new THREE.Vector3();
          info.bone.getWorldPosition(worldPos);
          if (worldPos.y < lowestFootY) lowestFootY = worldPos.y;
        }
      }

      if (lowestFootY < Infinity) {

        const delta = this.groundSurfaceY - lowestFootY;
        if (Math.abs(delta) > 0.001) {

          const newY = t.y + delta;
          this.capsuleBody.setTranslation({ x: t.x, y: newY, z: t.z }, true);
          Logger.info(`HumanoidPhysicsBinder: Spawn ground alignment — shifted capsule by ${delta.toFixed(4)}m (lowestFootY=${lowestFootY.toFixed(4)}, groundSurfaceY=${this.groundSurfaceY.toFixed(4)})`);
        }
      }
      this.targetSpawnGrounded = true;
    }

    const capsuleBottomY = t.y - this.capsuleCenterY;
    this._isGrounded = capsuleBottomY <= (this.groundSurfaceY + this.GROUND_SNAP_THRESHOLD);

    if (this.mbActive && this.multiBodyManager) {

      this.applyKinematicGroundReactionForces();

      this.multiBodyManager.syncVisuals(this.boneInfoMap, this.skeleton!);

      this.modelRoot.updateMatrixWorld(true);
      return;
    }

    const feetY = t.y - this.capsuleCenterY;
    const targetPos = new THREE.Vector3(t.x, feetY, t.z);

    if (!(this as any).lastVisualPos) {
      (this as any).lastVisualPos = targetPos.clone();
    }

    if (!this.mbActive) {
      let lowestYPoint = Infinity;

      this.modelRoot.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          const worldPosition = new THREE.Vector3();
          child.getWorldPosition(worldPosition);

          if (worldPosition.y < lowestYPoint) {
            lowestYPoint = worldPosition.y;
          }
        }
      });

      if (lowestYPoint < this.groundSurfaceY) {
        const penetrationDepth = Math.abs(lowestYPoint - this.groundSurfaceY);
        const MAX_PENETRATION_CORRECTION = 0.04;
        const correction = Math.min(penetrationDepth, MAX_PENETRATION_CORRECTION);

        if (correction > 0.001) {
          this.modelRoot.position.y += correction;
          this.capsuleBody.setTranslation(
            { x: t.x, y: t.y + correction, z: t.z },
            true
          );
        } else if (penetrationDepth > 0.08) {
          Logger.warn(
            `HumanoidPhysicsBinder: large bone penetration (${penetrationDepth.toFixed(3)}m) — skipping instant correction`
          );
        }
      }
    }

    if (this.debugSpheres.size > 0 && this.skeleton) {
      this.modelRoot.updateMatrixWorld(true);
      this.boneInfoMap.forEach((boneInfo, boneName) => {
        const debugSphere = this.debugSpheres.get(boneName);
        if (debugSphere) {
          const worldPos = new THREE.Vector3();
          boneInfo.bone.getWorldPosition(worldPos);
          debugSphere.position.copy(worldPos);
        }
      });
    }

    const deltaTime = 1 / 60;

    const aiRecentlyActive = (Date.now() - this.lastAiCommandTime) < 500;

    let bothFeetAirborne = true;
    let raisedFootCount = 0;
    let raisedFootDelta = 0;

    for (const name of ['mixamoriglefttoebase', 'mixamorigrighttoebase', 'mixamorigleftfoot', 'mixamorigrightfoot']) {
      const info = this.boneInfoMap.get(name);
      if (!info) continue;
      const worldPos = new THREE.Vector3();
      info.bone.getWorldPosition(worldPos);
      const distAboveGround = worldPos.y - this.groundSurfaceY;

      if (distAboveGround <= this.GROUND_SNAP_THRESHOLD) {
        bothFeetAirborne = false;
      }
      if (distAboveGround > this.GROUND_SNAP_THRESHOLD) {
        raisedFootCount++;
        raisedFootDelta = Math.max(raisedFootDelta, distAboveGround);
      }
    }

    if (bothFeetAirborne && !aiRecentlyActive && !this.mbActive) {

      this.airborneTimer += deltaTime;

      this.groundingMagnetStrength = 1.0 - Math.exp(-0.5 * this.airborneTimer);

      const distanceToSurface = capsuleBottomY - this.groundSurfaceY;
      if (distanceToSurface > 0.05 && this.groundingMagnetStrength > 0.01) {

        const magnetVelocity = -2.0 * this.groundingMagnetStrength;

        const currentVel = this.capsuleBody.linvel();
        if (currentVel.y > magnetVelocity) {
          this.capsuleBody.setLinvel(
            { x: currentVel.x, y: magnetVelocity, z: currentVel.z },
            true
          );
        }
      }
    } else {

      this.airborneTimer = 0;
      this.groundingMagnetStrength = 0.0;
    }

    if (raisedFootCount === 1 && raisedFootDelta > 0 && raisedFootDelta < 0.25) {
      // This is a subtle limb lift — quick proportional spring to settle the foot.
      // We adjust via motor target relaxation for the raised leg's hip/knee.
      // The binder's updateMotorTargets() handles the per-frame lerp, so we
      // can inject a soft target that pulls the joint back toward bind pose.
      // This is handled naturally by the PD lerp as long as we don't fight it.
      // For now, rely on gravity and passive damping — only note the condition.
    }

    this.applyKinematicGroundReactionForces();

    this.modelRoot.updateMatrixWorld(true);

    try {
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
            const t = duration > 0
              ? Math.max(0, Math.min(1, (elapsed - activeFrame.timeOffsetMs) / duration))
              : 1;

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
                  interpolatedOverrides[key] = startVal + (endVal - startVal) * t;
                } else if (Array.isArray(startVal) && Array.isArray(endVal) && startVal.length === 3 && endVal.length === 3) {
                  interpolatedOverrides[key] = [
                    startVal[0] + (endVal[0] - startVal[0]) * t,
                    startVal[1] + (endVal[1] - startVal[1]) * t,
                    startVal[2] + (endVal[2] - startVal[2]) * t,
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
    } catch (err) {

      Logger.warn('HumanoidPhysicsBinder.timelineStepper: unexpected error', err);
      this.timelineSequenceStart = null;
      this.timelineQueue = [];
    }

    {
      const isCapsuleOnGround = capsuleBottomY <= this.groundSurfaceY + 0.05;

      if (isCapsuleOnGround) {
        let lowestFootWorldY = Infinity;
        const footBoneNames = [
          'mixamoriglefttoebase',
          'mixamorigrighttoebase',
          'mixamorigleftfoot',
          'mixamorigrightfoot',
        ];

        for (const name of footBoneNames) {
          const info = this.boneInfoMap.get(name);
          if (info) {
            const worldPos = new THREE.Vector3();
            info.bone.getWorldPosition(worldPos);
            if (worldPos.y < lowestFootWorldY) {
              lowestFootWorldY = worldPos.y;
            }
          }
        }

        if (lowestFootWorldY < Infinity && lowestFootWorldY > this.groundSurfaceY) {
          const floatDelta = lowestFootWorldY - this.groundSurfaceY;

          const clampedDelta = Math.min(floatDelta, 0.02);
          this.modelRoot.position.y -= clampedDelta;
        }
      }
    }
    // ───────────────────────────────────────────────────────────────────────
  }

  private applyKinematicGroundReactionForces(): void {
    if (!this.capsuleBody || !this.capsuleBody.isValid() || !this.modelRoot) return;

    if (this.mbActive && this.multiBodyManager) {
      const registry = this.physicsEngine.getContactForceRegistry();
      const footBones = ['mixamorigleftfoot', 'mixamorigrightfoot'];
      let totalImpulse = new THREE.Vector3(0, 0, 0);
      let totalTorque = new THREE.Vector3(0, 0, 0);
      const capsulePos = this.capsuleBody.translation();
      const modelQuat = this.modelRoot.quaternion.clone();
      const modelForward = new THREE.Vector3(0, 0, -1).applyQuaternion(modelQuat);

      for (const boneName of footBones) {
        const colliderHandle = this.multiBodyManager.getBoneColliderHandle(boneName);
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
        this.capsuleBody.applyImpulse(totalImpulse, true);
      }
      if (Math.abs(totalTorque.y) > 0) {
        this.capsuleBody.applyTorqueImpulse(totalTorque, true);
      }
      return;
    }

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
            const lateralMotion = planarDelta.clone().sub(forwardMotion);

            const forwardMag = forwardMotion.length();
            const lateralMag = lateralMotion.length();

            if (forwardMag > 0.002) {
              const grf = forwardMotion.clone().negate().multiplyScalar(this.KGRF_MULTIPLIER);
              const MAX_GRF_IMPULSE = 16.0;
              if (grf.length() > MAX_GRF_IMPULSE) {
                grf.setLength(MAX_GRF_IMPULSE);
              }

              const capsulePos = this.capsuleBody!.translation();
              const offsetFromCenter = currentPos.x - capsulePos.x;
              const torqueY = -grf.z * offsetFromCenter * 5.0;
              const MAX_TORQUE_Y = 5.0;

              grf.y = 0;
              totalImpulse.add(grf);
              totalTorque.y += Math.max(-MAX_TORQUE_Y, Math.min(MAX_TORQUE_Y, torqueY));
            }

            if (lateralMag > 0.01) {
              const lateralTorque = lateralMotion.clone().normalize().multiplyScalar(0.5);
              totalTorque.y += lateralTorque.x * 0.5;
            }
          }
        }
      }

      this.previousFootPositions.set(boneName, currentPos.clone());
    });

    if (totalImpulse.lengthSq() > 0) {
      this.capsuleBody.applyImpulse(totalImpulse, true);
    }
    if (Math.abs(totalTorque.y) > 0) {
      this.capsuleBody.applyTorqueImpulse(totalTorque, true);
    }
  }

  public getIsGrounded(): boolean {
    return this._isGrounded;
  }

  public executeJump(force: number = 6.0): void {

    this.lastAiCommandTime = Date.now();
    this.airborneTimer = 0;
    this.groundingMagnetStrength = 0.0;

    if (!this.capsuleBody || !this.capsuleBody.isValid()) return;

    const angVel = this.capsuleBody.angvel();
    if (Math.abs(angVel.y) > 2.0) {
      this.capsuleBody.setAngvel(
        { x: angVel.x, y: Math.sign(angVel.y) * 2.0, z: angVel.z },
        true
      );
    }

    if (!this._isGrounded) {
      Logger.info('HumanoidPhysicsBinder.executeJump: Ignored — not grounded.');
      return;
    }

    this.capsuleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.capsuleBody.applyImpulse({ x: 0, y: force, z: 0 }, true);
    this._isGrounded = false;
    Logger.info(`HumanoidPhysicsBinder.executeJump: Jump impulse y=${force} applied.`);
  }

  public setBoneRotation(boneName: string, quaternion: THREE.Quaternion): void {
    const boneInfo = this.boneInfoMap.get(boneName.toLowerCase().replace(/:/g, ''));
    if (!boneInfo) return;

    boneInfo.bone.quaternion.copy(quaternion);
  }

  public setCapsulePosition(x: number, y: number, z: number): void {
    if (!this.capsuleBody || !this.capsuleBody.isValid()) return;

    const oldPos = this.capsuleBody.translation();
    const capsuleY = y + this.capsuleCenterY;
    const dx = x - oldPos.x;
    const dy = capsuleY - oldPos.y;
    const dz = z - oldPos.z;

    this.capsuleBody.setTranslation({ x, y: capsuleY, z }, true);
    this.capsuleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.capsuleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

    if (this.mbActive && this.multiBodyManager) {
      const bodiesMap = this.multiBodyManager.getRigidBodiesMap();
      for (const [, body] of bodiesMap) {
        if (!body.isValid()) continue;
        const t = body.translation();
        body.setTranslation({ x: t.x + dx, y: t.y + dy, z: t.z + dz }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  public getJointState(): Record<string, { position: [number, number, number], rotation: [number, number, number, number] }> {
    const state: Record<string, any> = {};

    if (this.capsuleBody && this.capsuleBody.isValid()) {
      const pos = this.capsuleBody.translation();
      const rot = this.capsuleBody.rotation();

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

    if (!this.capsuleCollider || !this.capsuleBody || !this.capsuleBody.isValid()) return result;

    const registry = this.physicsEngine.getContactForceRegistry();
    const colliderHandle = this.capsuleCollider.handle;
    const state = registry.get(colliderHandle);

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
    if (this.capsuleBody && this.capsuleBody.isValid()) {
      this.capsuleBody.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      Logger.info(`HumanoidPhysicsBinder: Applied impulse: [${impulse.x.toFixed(2)}, ${impulse.y.toFixed(2)}, ${impulse.z.toFixed(2)}]`);
    }
  }

  public setMode(mode: 'rigid' | 'ragdoll'): void {
    if (!this.capsuleBody || !this.capsuleBody.isValid()) return;

    if (this.mbActive && this.multiBodyManager) {
      if (mode === 'ragdoll') {
        this.multiBodyManager.setLimpMode(true);

        this.capsuleBody.lockRotations(false, true);
        this.capsuleBody.setLinearDamping(0.0);
        this.capsuleBody.setAngularDamping(0.5);
        this.capsuleBody.applyImpulse({ x: 0, y: -1.0, z: 0 }, true);
        this.capsuleBody.applyTorqueImpulse({ x: 1.0, y: 0.5, z: 0.8 }, true);
        Logger.info('HumanoidPhysicsBinder: RAGDOLL mode — multi-body PD gains zeroed, capsule limp');
      } else {
        this.multiBodyManager.setLimpMode(false);
        this.resetToBindPose();
        this.capsuleBody.setLinearDamping(2.0);
        this.capsuleBody.setAngularDamping(10.0);
        this.capsuleBody.lockRotations(false, true);
        Logger.info('HumanoidPhysicsBinder: RIGID mode — multi-body PD gains restored');
      }
      return;
    }

    if (mode === 'rigid') {
      this.capsuleBody.setLinearDamping(2.0);
      this.capsuleBody.setAngularDamping(8.0);
      this.capsuleBody.lockRotations(false, true);
      this.resetToBindPose();
      Logger.info('HumanoidPhysicsBinder: Switched to RIGID mode — motors active, can topple under imbalance');
    } else {

      this.capsuleBody.lockRotations(false, true);
      this.capsuleBody.setLinearDamping(0.0);
      this.capsuleBody.setAngularDamping(0.5);

      this.capsuleBody.applyImpulse({ x: 0, y: -1.0, z: 0 }, true);
      this.capsuleBody.applyTorqueImpulse({ x: 1.0, y: 0.5, z: 0.8 }, true);
      Logger.info('HumanoidPhysicsBinder: Switched to RAGDOLL mode — capsule limp, rotations unlocked');
    }
  }

  public getBuildStep(): string {
    return this.buildStep || 'UNINITIALIZED';
  }

  public getMotorSettings(): { stiffness: number, damping: number, gravity: number, friction: number } {
    return {
      stiffness: this.currentStiffness,
      damping: this.currentDamping,
      gravity: this.gravity,
      friction: this.friction,
    };
  }

  public async nextStep(): Promise<boolean> {
    if (!this.isLoaded) {
      Logger.error('HumanoidPhysicsBinder: Model not loaded yet');
      return false;
    }

    const currentStep = this.buildStep;

    if (currentStep === null || currentStep === 'A') {
      Logger.info('HumanoidPhysicsBinder: Progressing A → B: Creating capsule body...');
      return this.createRigidBodiesAndColliders();
    } else if (currentStep === 'B') {
      Logger.info('HumanoidPhysicsBinder: Progressing B → C: (no-op for single capsule)...');
      return this.createJointsWithZeroMotors();
    } else if (currentStep === 'C') {
      Logger.info('HumanoidPhysicsBinder: Progressing C → D: Finalizing...');
      return this.activateMotorsWithStiffnessAndDamping(20, 5);
    } else if (currentStep === 'D') {
      if (!this.mbActive) {
        Logger.info('HumanoidPhysicsBinder: STEP D — Activating multi-body PD control...');
        return this.activateMultiBody();
      }
      Logger.warn('HumanoidPhysicsBinder: Already at final step D with multi-body active.');
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

  public setMotorTargets(
    targets: Record<string, number | number[]>
  ): ActionApplyResult {
    const applied: string[] = [];
    const rejected: RejectedAction[] = [];

    if (this.buildStep !== 'D') {
      Logger.warn(`setMotorTargets: ignored — buildStep is '${this.buildStep}', expected 'D'. Model may not be fully initialized.`);
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

            parsedTarget = {
              x: target[0],
              y: target[1],
              z: target[2],
              w: target[3],
              isQuaternion: true,
            };
          } else if (target.length === 3) {

            parsedTarget = {
              x: target[0],
              y: target[1],
              z: target[2],
              isQuaternion: false,
            };
          } else if (target.length === 2) {

            parsedTarget = {
              x: target[0],
              y: target[1],
              z: 0,
              isQuaternion: false,
            };
          } else {

            parsedTarget = {
              scalar: target[0],
              isScalar: true,
            };
          }
        } else if (typeof target === 'number') {
          parsedTarget = {
            scalar: target,
            isScalar: true,
          };
        } else if (typeof target === 'object' && target !== null) {
          if ('angle' in target) {
            parsedTarget = {
              scalar: (target as any).angle * (Math.PI / 180),
              isScalar: true,
            };
          } else if ('x' in target || 'y' in target || 'z' in target) {
            parsedTarget = {
              x: (target as any).x ?? 0,
              y: (target as any).y ?? 0,
              z: (target as any).z ?? 0,
              isQuaternion: false,
            };
          } else {
            parsedTarget = {
              scalar: Number(target),
              isScalar: true,
            };
          }
        } else if (typeof target === 'string') {
          const parsedNumber = parseFloat(target);
          parsedTarget = {
            scalar: isNaN(parsedNumber) ? 0 : parsedNumber,
            isScalar: true,
          };
        }
      } catch (err) {
        Logger.warn(`Failed to parse joint payload for ${boneName}`, err);
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

    if (rejected.length > 0) {
      Logger.warn(
        `setMotorTargets: rejected ${rejected.length} joint(s): ` +
        rejected.map(r => `${r.joint}(${r.reason})`).join(', ')
      );
    }

    return { applied, rejected };
  }

  public updateMotorTargets(): void {
    if (this.buildStep !== 'D') {
      Logger.warn(`updateMotorTargets: ignored — buildStep is '${this.buildStep}', expected 'D'`);
      return;
    }

    if (this.mbActive && this.multiBodyManager) {
      this.multiBodyManager.setTargets(this.currentTargets);

      this.currentTargets.forEach((parsedTarget, canonical) => {
        if (this.isFingerBone(canonical)) {
          this.applyKinematicLerpForBone(canonical, parsedTarget);
        }
      });
      return;
    }

    this.currentTargets.forEach((parsedTarget, canonical) => {
      this.applyKinematicLerpForBone(canonical, parsedTarget);
    });
  }

  private isFingerBone(canonical: string): boolean {
    return /(thumb|index|middle|ring|pinky)\d+$/.test(canonical);
  }

  private settledBones: Set<string> = new Set();
  private settledBoneTargets: Map<string, THREE.Quaternion> = new Map();
  private readonly LERP_SNAP_EPSILON: number = 1e-4;

  private applyKinematicLerpForBone(canonical: string, parsedTarget: any): void {
    const boneInfo = this.boneInfoMap.get(canonical);
    const bindPoseQuat = this.bindPoseQuaternions.get(canonical);
    if (!boneInfo || !bindPoseQuat) return;

    if (this.settledBones.has(canonical)) {

      const cachedTarget = this.settledBoneTargets.get(canonical);
      if (cachedTarget) {

        const checkTarget = this.computeDesiredTargetQuat(canonical, parsedTarget, bindPoseQuat);
        const angleDiff = cachedTarget.angleTo(checkTarget);
        if (angleDiff < this.LERP_SNAP_EPSILON) {
          return;
        }
      }

      this.settledBones.delete(canonical);
    }

    const limits = this.jointLimits.get(canonical) || getAnatomicalLimitForBone(canonical);

    let targetDeltaQuat = new THREE.Quaternion();

    if (parsedTarget.isQuaternion && parsedTarget.w !== undefined) {

      const absoluteQuat = new THREE.Quaternion(parsedTarget.x, parsedTarget.y, parsedTarget.z, parsedTarget.w).normalize();
      targetDeltaQuat.copy(bindPoseQuat).invert().multiply(absoluteQuat);
    } else if (parsedTarget.isScalar) {

      const axisDir = new THREE.Vector3(1, 0, 0);
      const axis = axisDir.applyQuaternion(boneInfo.bone.quaternion).normalize();

      const currentDeltaQuat = bindPoseQuat.clone().invert().multiply(boneInfo.bone.quaternion);
      const currentAngle = this.extractAngleFromQuat(currentDeltaQuat, axis);

      let targetAngle = parsedTarget.scalar || 0;
      if (limits) targetAngle = Math.max(limits.min, Math.min(limits.max, targetAngle));

      const EPSILON = 0.002;
      if (Math.abs(targetAngle - currentAngle) < EPSILON) {
        targetDeltaQuat.setFromAxisAngle(axis, targetAngle);

        this.settledBones.add(canonical);
        this.settledBoneTargets.set(canonical, targetDeltaQuat.clone());
      } else {
        let newAngle = currentAngle + (targetAngle - currentAngle) * this.lerpSpeed;
        if (limits) newAngle = Math.max(limits.min, Math.min(limits.max, newAngle));
        targetDeltaQuat.setFromAxisAngle(axis, newAngle);
      }
    } else {

      let eulerX = parsedTarget.x || 0;
      let eulerY = parsedTarget.y || 0;
      let eulerZ = parsedTarget.z || 0;

      if (limits) {
        eulerX = Math.max(limits.min, Math.min(limits.max, eulerX));
      }

      const eulerOrder: THREE.EulerOrder = 'XYZ';
      const targetEuler = new THREE.Euler(eulerX, eulerY, eulerZ, eulerOrder);
      const desiredDeltaQuat = new THREE.Quaternion().setFromEuler(targetEuler);

      const currentDeltaQuat = bindPoseQuat.clone().invert().multiply(boneInfo.bone.quaternion);

      const EPSILON = 0.002;
      if (currentDeltaQuat.angleTo(desiredDeltaQuat) < EPSILON) {
        targetDeltaQuat.copy(desiredDeltaQuat);

        this.settledBones.add(canonical);
        this.settledBoneTargets.set(canonical, desiredDeltaQuat.clone());
      } else {
        targetDeltaQuat.copy(currentDeltaQuat).slerp(desiredDeltaQuat, this.lerpSpeed);
      }
    }

    const finalQuat = bindPoseQuat.clone().multiply(targetDeltaQuat);
    boneInfo.bone.quaternion.copy(finalQuat);
  }

  private computeDesiredTargetQuat(canonical: string, parsedTarget: any, _bindPoseQuat: THREE.Quaternion): THREE.Quaternion {
    const limits = this.jointLimits.get(canonical) || getAnatomicalLimitForBone(canonical);

    if (parsedTarget.isQuaternion && parsedTarget.w !== undefined) {

      const absoluteQuat = new THREE.Quaternion(parsedTarget.x, parsedTarget.y, parsedTarget.z, parsedTarget.w).normalize();
      return _bindPoseQuat.clone().invert().multiply(absoluteQuat);
    }

    if (parsedTarget.isScalar) {
      const boneInfo = this.boneInfoMap.get(canonical);
      if (!boneInfo) return new THREE.Quaternion();

      const axisDir = new THREE.Vector3(1, 0, 0);
      const axis = axisDir.applyQuaternion(boneInfo.bone.quaternion).normalize();
      let targetAngle = parsedTarget.scalar || 0;
      if (limits) targetAngle = Math.max(limits.min, Math.min(limits.max, targetAngle));
      return new THREE.Quaternion().setFromAxisAngle(axis, targetAngle);
    }

    let eulerX = parsedTarget.x || 0;
    let eulerY = parsedTarget.y || 0;
    let eulerZ = parsedTarget.z || 0;
    if (limits) eulerX = Math.max(limits.min, Math.min(limits.max, eulerX));

    return new THREE.Quaternion().setFromEuler(new THREE.Euler(eulerX, eulerY, eulerZ, 'XYZ'));
  }

  private extractAngleFromQuat(quat: THREE.Quaternion, axis: THREE.Vector3): number {

    const sinHalfAngle = axis.x * quat.x + axis.y * quat.y + axis.z * quat.z;
    return 2 * Math.asin(Math.max(-1, Math.min(1, sinHalfAngle)));
  }

  public setLerpSpeed(speed: number): void {
    this.lerpSpeed = Math.max(0.01, Math.min(1.0, speed));
  }

  public executeProgramSequence(programs: string[]): void {

    this.lastAiCommandTime = Date.now();
    this.airborneTimer = 0;
    this.groundingMagnetStrength = 0.0;

    if (this.buildStep !== 'D' || !this.capsuleBody || !this.capsuleBody.isValid()) return;

    for (const program of programs) {
      const name = program.toLowerCase().replace(/[_\s]/g, '');

      if (name.includes('stand') || name.includes('upright') || name.includes('recover') || name.includes('reorient')) {

        this.capsuleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.capsuleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

        const currentPos = this.capsuleBody.translation();
        const safeStandingY = this.capsuleCenterY + 0.05;
        this.capsuleBody.setTranslation({ x: currentPos.x, y: safeStandingY, z: currentPos.z }, true);

        this.resetToBindPose();
      } else if (name.includes('jump')) {
        this.executeJump(6.0);
      } else if (name.includes('crouch') || name.includes('squat')) {
        this.capsuleBody.setLinvel({ x: 0, y: -0.5, z: 0 }, true);
      } else if (name.includes('fall') || name.includes('collapse')) {

        this.capsuleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      } else {

        Logger.warn(`HumanoidPhysicsBinder.executeProgramSequence: Unknown program "${program}" ignored. AI must use joint_overrides for locomotion via K-GRF foot strokes.`);
      }
    }
  }

  public resetPose(spawnPoint: { x: number; y: number; z: number }): void {
    Logger.info(`HumanoidPhysicsBinder.resetPose: resetting to (${spawnPoint.x}, ${spawnPoint.y}, ${spawnPoint.z})`);

    if (this.capsuleBody && this.capsuleBody.isValid()) {
      this.capsuleBody.setTranslation(
        { x: spawnPoint.x, y: spawnPoint.y + this.capsuleCenterY, z: spawnPoint.z },
        true
      );
      this.capsuleBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.capsuleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.capsuleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.capsuleBody.lockRotations(false, true);
    }

    this.resetToBindPose();

    this.modelRoot?.updateMatrixWorld(true);
    this.previousFootPositions.clear();
  }

  public isOutOfWorldBounds(): boolean {
    if (!this.capsuleBody || !this.capsuleBody.isValid()) return false;
    const t = this.capsuleBody.translation();
    const dist = Math.sqrt(t.x * t.x + t.z * t.z);
    return dist > WORLD_BOUNDARY_RADIUS || Math.abs(t.y) > WORLD_BOUNDARY_RADIUS;
  }

  public resetToBindPose(): void {
    this.currentTargets.clear();

    this.settledBones.clear();
    this.settledBoneTargets.clear();

    this.boneInfoMap.forEach((info, canonical) => {
      const bindQuat = this.bindPoseQuaternions.get(canonical);
      if (bindQuat) {
        info.bone.quaternion.copy(bindQuat);
      } else {
        info.bone.quaternion.identity();
      }
    });

    const armsDownAngle = this.restArmAngleDeg * (Math.PI / 180);

    const applyArmRotation = (canonical: string, angle: number) => {
      const boneInfo = this.boneInfoMap.get(canonical);
      const bindPoseQuat = this.bindPoseQuaternions.get(canonical);
      if (!boneInfo || !bindPoseQuat) return;

      const targetEuler = new THREE.Euler(angle, 0, 0, 'XYZ');
      const targetDeltaQuat = new THREE.Quaternion().setFromEuler(targetEuler);
      boneInfo.bone.quaternion.copy(bindPoseQuat.clone().multiply(targetDeltaQuat));

      this.currentTargets.set(canonical, { x: angle, y: 0, z: 0, isQuaternion: false });
    };

    applyArmRotation('mixamorigrightarm', armsDownAngle);
    applyArmRotation('mixamorigleftarm', armsDownAngle);

    if (this.mbActive && this.multiBodyManager) {
      this.multiBodyManager.syncRigidBodiesFromBones(this.boneInfoMap);
    }
  }

  public async adjustMotors(stiffness: number, damping: number): Promise<boolean> {
    if (this.buildStep !== 'D') {
      Logger.error('HumanoidPhysicsBinder: Must reach STEP D first. Use nextStep() to progress.');
      return false;
    }

    this.currentStiffness = stiffness;
    this.currentDamping = damping;

    if (this.capsuleBody && this.capsuleBody.isValid()) {
      this.capsuleBody.setLinearDamping(damping * 0.2);
    }

    Logger.info(`HumanoidPhysicsBinder: Adjusted capsule damping. stiffness=${stiffness}, damping=${damping}`);
    return true;
  }

  public getModelRoot(): THREE.Group | null {
    return this.modelRoot;
  }

  public getCapsuleBody(): RAPIER.RigidBody | null {
    return this.capsuleBody;
  }

  public getDiagnostics(): Record<string, any> {
    const capsulePos = this.capsuleBody?.isValid() ? this.capsuleBody.translation() : null;
    return {
      buildStep: this.buildStep,
      isLoaded: this.isLoaded,
      boneCount: this.boneInfoMap.size,
      hasCapsuleBody: !!this.capsuleBody,
      capsulePosition: capsulePos ? [capsulePos.x.toFixed(3), capsulePos.y.toFixed(3), capsulePos.z.toFixed(3)] : null,
      modelHeight: this.modelHeight,
      capsuleRadius: this.capsuleRadius,
      capsuleCenterY: this.capsuleCenterY,
      hipToFootDistance: this.hipToFootDistance,
      currentStiffness: this.currentStiffness,
      currentDamping: this.currentDamping,
      gravity: this.gravity,
      friction: this.friction,
      mbActive: this.mbActive,
      multiBodyBoneCount: this.multiBodyManager?.getBoneCount() ?? 0,
      multiBodyMotorJoints: this.multiBodyManager?.getMotorController().getJointCount() ?? 0,
    };
  }

  public cleanup(): void {

    if (this.multiBodyManager) {
      this.multiBodyManager.deactivate();
      this.multiBodyManager = null;
      this.mbActive = false;
    }

    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot.traverse((child) => {
        if ((child as any).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) {
            mesh.geometry.dispose();
          }
          if (Array.isArray(mesh.material)) {
            (mesh.material as THREE.Material[]).forEach(m => m.dispose());
          } else if (mesh.material) {
            (mesh.material as THREE.Material).dispose();
          }
        }
      });
      this.modelRoot = null;
    }

    this.debugSpheres.forEach((sphere) => {
      this.scene.remove(sphere);
      if (sphere.geometry) {
        sphere.geometry.dispose();
      }
      if (sphere.material) {
        (sphere.material as THREE.Material).dispose();
      }
    });
    this.debugSpheres.clear();

    if (this.capsuleBody) {
      try {
        if (this.capsuleBody.isValid()) {
          this.physicsEngine.unregisterVelocityClampBody(this.capsuleBody);
          const world = this.physicsEngine.getWorld();
          world.removeRigidBody(this.capsuleBody);
        }
      } catch (e) {
        Logger.warn('HumanoidPhysicsBinder: Error removing capsule body during cleanup', e);
      }
      this.capsuleBody = null;
    }

    if (this.aiCameraHelper) {
      this.scene.remove(this.aiCameraHelper);
      this.aiCameraHelper = null;
    }
    this.cameraHelpers.forEach(h => this.scene.remove(h));
    this.cameraHelpers = [];

    this.boneInfoMap.clear();
    this.bindPoseQuaternions.clear();
    this.skeleton = null;
    this.skinnedMesh = null;

    this.isLoaded = false;
    this.buildStep = null;
    this.currentStiffness = 0;
    this.currentDamping = 0;
  }
}
