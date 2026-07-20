/**
 * AvatarSynchronizer — Physics-to-Visual Transform Sync
 *
 * Copies RigidBody translations/rotations to Three.js skeleton bones.
 * Handles offset adjustments, coordinate system mappings, and floor clipping.
 *
 * This is the render-side counterpart of RapierJointMotorController:
 * physics truth (RigidBody transforms) → visual puppet (Skeleton bones).
 *
 * Ported from ProtoMotion extraction blueprint (§3.1 Physics-to-Visual Sync):
 *   - One-directional: physics → visual
 *   - Physics is the source of truth
 *   - Visual mesh follows without affecting physics
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { logger as Logger } from '../../utils/logger';

export interface RigidBodyMap {
  /** Canonical bone name → Rapier RigidBody */
  [canonicalName: string]: RAPIER.RigidBody;
}

/**
 * Configuration for a single bone's visual-physics mapping.
 */
export interface BoneSyncConfig {
  /** Canonical Mixamo bone name */
  canonicalName: string;
  /** Allow rotation from physics to drive this bone */
  syncRotation: boolean;
  /** Allow translation from physics to drive this bone (root only) */
  syncTranslation: boolean;
  /** Vertical offset to apply to the root visual mesh (floor clipping guard) */
  rootOffsetY?: number;
}

export class AvatarSynchronizer {
  private rootOffsetHeight: number = 0.04; // Floor clipping cushion (matches human2humanoid extraction)
  private boneNameMap: Map<string, string> = new Map(); // canonicalName → actual bone name in skeleton
  private syncConfigs: Map<string, BoneSyncConfig> = new Map();
  private sortedBoneNames: string[] = []; // Parent-first sorted order
  private sortedDirty = true;

  // SLERP smoothing cache: previous world quaternion per bone
  private prevWorldQuat: Map<string, THREE.Quaternion> = new Map();
  private smoothingAlpha: number = 0.5; // 1.0 = no smoothing, 0.0 = no movement

  constructor(rootOffsetHeight: number = 0.04, smoothingAlpha: number = 0.5) {
    this.rootOffsetHeight = rootOffsetHeight;
    this.smoothingAlpha = smoothingAlpha;
  }

  /**
   * Register a sync configuration for a bone.
   * @param canonicalName The canonical bone name (lowercase, no colons)
   * @param actualBoneName The actual bone name in the THREE.Skeleton
   * @param config Sync behavior configuration
   */
  public registerBone(canonicalName: string, actualBoneName: string, config: BoneSyncConfig): void {
    this.boneNameMap.set(canonicalName, actualBoneName);
    this.syncConfigs.set(canonicalName, config);
    this.sortedDirty = true;
  }

  /**
   * Register a full mapping from canonical names to bone names.
   */
  public registerBoneMap(boneMap: Map<string, string>, defaultConfig?: Partial<BoneSyncConfig>): void {
    const defaults: BoneSyncConfig = {
      canonicalName: '',
      syncRotation: true,
      syncTranslation: false,
      ...defaultConfig,
    };

    boneMap.forEach((actualBoneName, canonicalName) => {
      this.registerBone(canonicalName, actualBoneName, {
        ...defaults,
        canonicalName,
      });
    });
  }

  /**
   * Sort registered bones in parent-first order using the bonesMap hierarchy.
   * This ensures parent transforms are synced before children, so
   * parent.getWorldQuaternion() returns fresh data during child sync.
   */
  private ensureSorted(bonesMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>): void {
    if (!this.sortedDirty && this.sortedBoneNames.length === this.syncConfigs.size) return;

    const visited = new Set<string>();
    const sorted: string[] = [];

    const visit = (canonicalName: string) => {
      if (visited.has(canonicalName)) return;
      visited.add(canonicalName);
      const boneData = bonesMap.get(canonicalName);
      if (boneData) {
        const parent = boneData.bone.parent;
        if (parent) {
          const parentCanonical = parent.name.toLowerCase().replace(/:/g, '');
          if (this.syncConfigs.has(parentCanonical)) {
            visit(parentCanonical);
          }
        }
      }
      sorted.push(canonicalName);
    };

    for (const name of this.syncConfigs.keys()) {
      visit(name);
    }

    this.sortedBoneNames = sorted;
    this.sortedDirty = false;
  }

  /**
   * Sync all registered bones from their RigidBodies to the skeleton.
   * Should be called every frame AFTER the physics step.
   *
   * @param bonesMap Map of canonical name → THREE.Bone from the skeleton
   * @param rigidBodies Map of canonical name → RAPIER.RigidBody from physics
   * @param disableSync Optional set of bone names to skip syncing (e.g. for motors controlling them directly)
   */
  public synchronize(
    bonesMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>,
    rigidBodies: Map<string, RAPIER.RigidBody>,
    disableSync?: Set<string>
  ): void {
    // Process bones in parent-first order so parent transforms are fresh
    // when children call parent.getWorldQuaternion()
    this.ensureSorted(bonesMap);

    const parentWorldQuat = new THREE.Quaternion();
    const rawWorldQuat = new THREE.Quaternion();
    const smoothedQuat = new THREE.Quaternion();

    for (const canonicalName of this.sortedBoneNames) {
      if (disableSync?.has(canonicalName)) continue;

      const config = this.syncConfigs.get(canonicalName)!;
      const boneData = bonesMap.get(canonicalName);
      const rigidBody = rigidBodies.get(canonicalName);
      if (!boneData || !rigidBody || !rigidBody.isValid()) continue;

      const bone = boneData.bone;

      if (config.syncRotation) {
        const rot = rigidBody.rotation();
        rawWorldQuat.set(rot.x, rot.y, rot.z, rot.w);

        // SLERP with previous frame to smooth jitter
        const prev = this.prevWorldQuat.get(canonicalName);
        if (prev) {
          smoothedQuat.copy(prev).slerp(rawWorldQuat, this.smoothingAlpha);
          this.prevWorldQuat.set(canonicalName, smoothedQuat.clone());
        } else {
          smoothedQuat.copy(rawWorldQuat);
          this.prevWorldQuat.set(canonicalName, rawWorldQuat.clone());
        }

        // Convert WORLD → LOCAL by factoring out parent's world rotation.
        const parent = bone.parent;
        if (parent) {
          parent.getWorldQuaternion(parentWorldQuat);
          bone.quaternion.copy(parentWorldQuat.invert().multiply(smoothedQuat));
        } else {
          bone.quaternion.copy(smoothedQuat);
        }
      }

      if (config.syncTranslation) {
        const pos = rigidBody.translation();
        const offsetY = config.rootOffsetY ?? 0;

        bone.position.set(
          pos.x,
          pos.y + offsetY,
          pos.z
        );
      }
    }
  }

  /**
   * Sync only the root (capsule/pelvis) transform to the model root group.
   * The root is special because it drives the entire model's world position.
   *
   * @param modelRoot The root THREE.Group of the character
   * @param physicsRoot The root RigidBody (capsule body)
   * @param capsuleCenterY The Y-offset from capsule center to model feet
   */
  public syncRoot(
    modelRoot: THREE.Group,
    physicsRoot: RAPIER.RigidBody,
    capsuleCenterY: number
  ): void {
    if (!physicsRoot.isValid()) return;

    const t = physicsRoot.translation();
    const r = physicsRoot.rotation();

    // The model root sits at the feet position, which is capsule center minus half-height
    modelRoot.position.set(t.x, t.y - capsuleCenterY, t.z);
    modelRoot.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /**
   * Sync a mesh that contains a SkinnedMesh by traversing its bone hierarchy.
   * Each bone's RigidBody is looked up by canonical name.
   */
  public syncSkinnedMesh(
    root: THREE.Object3D,
    rigidBodies: Map<string, RAPIER.RigidBody>,
    canonicalNameMap: Map<string, string>, // actualBoneName → canonicalName
    disableSync?: Set<string>
  ): void {
    root.traverse((child) => {
      if (!(child instanceof THREE.Bone)) return;

      const boneName = child.name.toLowerCase().replace(/:/g, '');
      const canonicalName = canonicalNameMap.get(boneName) ?? boneName;
      const rigidBody = rigidBodies.get(canonicalName);

      if (!rigidBody || !rigidBody.isValid()) return;
      if (disableSync?.has(canonicalName)) return;

      const rot = rigidBody.rotation();
      child.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    });
  }

  /**
   * Set the floor clipping cushion offset.
   */
  public setRootOffset(offset: number): void {
    this.rootOffsetHeight = offset;
  }

  /**
   * Get current root offset.
   */
  public getRootOffset(): number {
    return this.rootOffsetHeight;
  }

  /**
   * Clear all registered bone mappings.
   */
  public clear(): void {
    this.boneNameMap.clear();
    this.syncConfigs.clear();
    this.sortedBoneNames = [];
    this.sortedDirty = true;
    this.prevWorldQuat.clear();
  }
}
