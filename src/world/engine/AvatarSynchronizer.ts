import * as THREE from 'three';

export interface RigidBodyMap {
  [canonicalName: string]: any;
}

export interface BoneSyncConfig {
  canonicalName: string;
  syncRotation: boolean;
  syncTranslation: boolean;
  rootOffsetY?: number;
}

export class AvatarSynchronizer {
  private rootOffsetHeight: number = 0.04; 
  private boneNameMap: Map<string, string> = new Map(); 
  private syncConfigs: Map<string, BoneSyncConfig> = new Map();
  private sortedBoneNames: string[] = []; 
  private sortedDirty = true;

  private prevWorldQuat: Map<string, THREE.Quaternion> = new Map();
  private smoothingAlpha: number = 0.85; 

  constructor(rootOffsetHeight: number = 0.04, smoothingAlpha: number = 0.85) {
    this.rootOffsetHeight = rootOffsetHeight;
    this.smoothingAlpha = smoothingAlpha;
  }

  public registerBone(canonicalName: string, actualBoneName: string, config: BoneSyncConfig): void {
    this.boneNameMap.set(canonicalName, actualBoneName);
    this.syncConfigs.set(canonicalName, config);
    this.sortedDirty = true;
  }

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

  public synchronize(
    bonesMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>,
    rigidBodies: Map<string, any>,
    disableSync?: Set<string>
  ): void {

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

        const prev = this.prevWorldQuat.get(canonicalName);
        if (prev) {
          smoothedQuat.copy(prev).slerp(rawWorldQuat, this.smoothingAlpha);
          this.prevWorldQuat.set(canonicalName, smoothedQuat.clone());
        } else {
          smoothedQuat.copy(rawWorldQuat);
          this.prevWorldQuat.set(canonicalName, rawWorldQuat.clone());
        }

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

  public syncRoot(
    modelRoot: THREE.Group,
    physicsRoot: any,
    capsuleCenterY: number
  ): void {
    if (!physicsRoot.isValid()) return;

    const t = physicsRoot.translation();
    const r = physicsRoot.rotation();

    modelRoot.position.set(t.x, t.y - capsuleCenterY, t.z);
    modelRoot.quaternion.set(r.x, r.y, r.z, r.w);
  }

  public syncSkinnedMesh(
    root: THREE.Object3D,
    rigidBodies: Map<string, any>,
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

  public setRootOffset(offset: number): void {
    this.rootOffsetHeight = offset;
  }

  public getRootOffset(): number {
    return this.rootOffsetHeight;
  }

  public clear(): void {
    this.boneNameMap.clear();
    this.syncConfigs.clear();
    this.sortedBoneNames = [];
    this.sortedDirty = true;
    this.prevWorldQuat.clear();
  }
}
