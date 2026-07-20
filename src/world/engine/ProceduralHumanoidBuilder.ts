import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEngine } from './PhysicsEngine';
import { RAGDOLL_GROUP, ENVIRONMENT_GROUP, getCollisionMask } from '../../constants/physics';
import { logger as Logger } from '../../utils/logger';

interface BodyPartDef {
  name: string;
  shape: 'sphere' | 'capsule' | 'box';
  dims: { rx: number; ry?: number; rz?: number; h?: number };
  density: number;
  localPos: [number, number, number];
  parent: string | null;
  jointType: 'revolute' | 'spherical';
  jointAxis?: [number, number, number]; 
  jointLimits?: [number, number]; 
}

const BODY_PARTS: BodyPartDef[] = [

  {
    name: 'pelvis',
    shape: 'capsule',
    dims: { rx: 0.12, h: 0.15 },
    density: 1050,
    localPos: [0, 0, 0],
    parent: null,
    jointType: 'spherical',
  },
  {
    name: 'torso',
    shape: 'capsule',
    dims: { rx: 0.14, h: 0.35 },
    density: 1100,
    localPos: [0, 0.35, 0],
    parent: 'pelvis',
    jointType: 'revolute',
    jointAxis: [1, 0, 0], // Pitch
    jointLimits: [-0.35, 0.78],
  },
  {
    name: 'chest',
    shape: 'capsule',
    dims: { rx: 0.13, h: 0.25 },
    density: 1050,
    localPos: [0, 0.60, 0],
    parent: 'torso',
    jointType: 'revolute',
    jointAxis: [1, 0, 0],
    jointLimits: [-0.26, 0.52],
  },
  {
    name: 'neck',
    shape: 'capsule',
    dims: { rx: 0.05, h: 0.10 },
    density: 900,
    localPos: [0, 0.80, 0],
    parent: 'chest',
    jointType: 'spherical',
  },
  {
    name: 'head',
    shape: 'sphere',
    dims: { rx: 0.10 },
    density: 1000,
    localPos: [0, 0.95, 0],
    parent: 'neck',
    jointType: 'spherical',
  },

  {
    name: 'left_shoulder',
    shape: 'capsule',
    dims: { rx: 0.04, h: 0.28 },
    density: 800,
    localPos: [-0.22, 0.72, 0],
    parent: 'chest',
    jointType: 'spherical',
  },
  {
    name: 'left_elbow',
    shape: 'capsule',
    dims: { rx: 0.035, h: 0.25 },
    density: 700,
    localPos: [-0.22, 0.44, 0],
    parent: 'left_shoulder',
    jointType: 'revolute',
    jointAxis: [1, 0, 0],
    jointLimits: [-2.53, 0.0],
  },
  {
    name: 'left_wrist',
    shape: 'box',
    dims: { rx: 0.04, ry: 0.03, rz: 0.08 },
    density: 600,
    localPos: [-0.22, 0.20, 0],
    parent: 'left_elbow',
    jointType: 'spherical',
  },

  {
    name: 'right_shoulder',
    shape: 'capsule',
    dims: { rx: 0.04, h: 0.28 },
    density: 800,
    localPos: [0.22, 0.72, 0],
    parent: 'chest',
    jointType: 'spherical',
  },
  {
    name: 'right_elbow',
    shape: 'capsule',
    dims: { rx: 0.035, h: 0.25 },
    density: 700,
    localPos: [0.22, 0.44, 0],
    parent: 'right_shoulder',
    jointType: 'revolute',
    jointAxis: [1, 0, 0],
    jointLimits: [-2.53, 0.0],
  },
  {
    name: 'right_wrist',
    shape: 'box',
    dims: { rx: 0.04, ry: 0.03, rz: 0.08 },
    density: 600,
    localPos: [0.22, 0.20, 0],
    parent: 'right_elbow',
    jointType: 'spherical',
  },

  {
    name: 'left_hip',
    shape: 'capsule',
    dims: { rx: 0.06, h: 0.35 },
    density: 1000,
    localPos: [-0.10, -0.20, 0],
    parent: 'pelvis',
    jointType: 'spherical',
  },
  {
    name: 'left_knee',
    shape: 'capsule',
    dims: { rx: 0.05, h: 0.35 },
    density: 900,
    localPos: [-0.10, -0.55, 0],
    parent: 'left_hip',
    jointType: 'revolute',
    jointAxis: [1, 0, 0],
    jointLimits: [-2.35, 0.0],
  },
  {
    name: 'left_ankle',
    shape: 'box',
    dims: { rx: 0.06, ry: 0.04, rz: 0.12 },
    density: 1200,
    localPos: [-0.10, -0.78, 0.04],
    parent: 'left_knee',
    jointType: 'spherical',
  },

  {
    name: 'right_hip',
    shape: 'capsule',
    dims: { rx: 0.06, h: 0.35 },
    density: 1000,
    localPos: [0.10, -0.20, 0],
    parent: 'pelvis',
    jointType: 'spherical',
  },
  {
    name: 'right_knee',
    shape: 'capsule',
    dims: { rx: 0.05, h: 0.35 },
    density: 900,
    localPos: [0.10, -0.55, 0],
    parent: 'right_hip',
    jointType: 'revolute',
    jointAxis: [1, 0, 0],
    jointLimits: [-2.35, 0.0],
  },
  {
    name: 'right_ankle',
    shape: 'box',
    dims: { rx: 0.06, ry: 0.04, rz: 0.12 },
    density: 1200,
    localPos: [0.10, -0.78, 0.04],
    parent: 'right_knee',
    jointType: 'spherical',
  },
];

const BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x667788,
  roughness: 0.6,
  metalness: 0.1,
  transparent: true,
  opacity: 0.85,
});

export interface ProceduralPart {
  name: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
}

export interface ProceduralBuildResult {
  rootGroup: THREE.Group;
  parts: Map<string, ProceduralPart>;
  rigidBodiesMap: Map<string, RAPIER.RigidBody>;
  jointsMap: Map<string, RAPIER.ImpulseJoint>;
  boneMap: Map<string, string>;
  totalHeight: number;
}

export class ProceduralHumanoidBuilder {
  private scene: THREE.Scene;
  private world: RAPIER.World;
  private physicsEngine: PhysicsEngine;

  constructor(scene: THREE.Scene, physicsEngine: PhysicsEngine) {
    this.scene = scene;
    this.world = physicsEngine.getWorld();
    this.physicsEngine = physicsEngine;
  }

  public build(spawnPoint: THREE.Vector3): ProceduralBuildResult {
    const rootGroup = new THREE.Group();
    rootGroup.position.copy(spawnPoint);
    rootGroup.position.y += 0.78; 
    rootGroup.userData.isSynthiaPrimitive = true;
    this.scene.add(rootGroup);

    const parts = new Map<string, ProceduralPart>();
    const rigidBodiesMap = new Map<string, RAPIER.RigidBody>();
    const jointsMap = new Map<string, RAPIER.ImpulseJoint>();
    const boneMap = new Map<string, string>();

    for (const def of BODY_PARTS) {
      const parentPart = def.parent ? parts.get(def.parent) : null;
      const parentBody = parentPart?.body ?? null;

      const feetOffset = 0.78; 
      const worldPos = new THREE.Vector3(
        spawnPoint.x + def.localPos[0],
        spawnPoint.y + feetOffset + def.localPos[1],
        spawnPoint.z + def.localPos[2],
      );

      const mesh = this.createMesh(def, new THREE.Vector3(def.localPos[0], def.localPos[1], def.localPos[2]));
      rootGroup.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setLinearDamping(1.5)
        .setAngularDamping(6.0);

      const body = this.world.createRigidBody(bodyDesc);

      const colliderDesc = this.createColliderDesc(def);
      colliderDesc.setCollisionGroups(getCollisionMask(RAGDOLL_GROUP, ENVIRONMENT_GROUP));
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      const collider = this.world.createCollider(colliderDesc, body);
      this.physicsEngine.registerVelocityClampBody(body);

      if (parentBody && parentBody.isValid()) {
        const parentPos = parentBody.translation();
        const parentRot = parentBody.rotation();
        const parentQuatInv = new THREE.Quaternion(
          parentRot.x, parentRot.y, parentRot.z, parentRot.w
        ).invert();
        const worldOffset = new THREE.Vector3(
          worldPos.x - parentPos.x,
          worldPos.y - parentPos.y,
          worldPos.z - parentPos.z
        ).applyQuaternion(parentQuatInv);
        const anchor1: RAPIER.Vector3 = {
          x: worldOffset.x,
          y: worldOffset.y,
          z: worldOffset.z,
        };
        const anchor2: RAPIER.Vector3 = { x: 0, y: 0, z: 0 };

        let jointData: RAPIER.JointData;
        if (def.jointType === 'revolute' && def.jointAxis) {
          jointData = RAPIER.JointData.revolute(
            anchor1,
            anchor2,
            { x: def.jointAxis[0], y: def.jointAxis[1], z: def.jointAxis[2] }
          );
          if (def.jointLimits) {
            jointData.limitsEnabled = true;
            jointData.limits = def.jointLimits;
          }
        } else {
          jointData = RAPIER.JointData.spherical(anchor1, anchor2);
        }

        const joint = this.world.createImpulseJoint(jointData, parentBody, body, true);
        jointsMap.set(def.name, joint);
      }

      const part: ProceduralPart = { name: def.name, body, collider, mesh };
      parts.set(def.name, part);
      rigidBodiesMap.set(def.name, body);
      boneMap.set(def.name, def.name);

      mesh.userData.proceduralPart = def.name;
      mesh.userData.isSynthiaPrimitive = true;
    }

    const lowestY = Math.min(...BODY_PARTS.map(p => p.localPos[1]));
    const highestY = Math.max(...BODY_PARTS.map(p => p.localPos[1]));
    const totalHeight = highestY - lowestY + 0.10; 

    Logger.info(`ProceduralHumanoidBuilder: Built ${parts.size} body parts, totalHeight=${totalHeight.toFixed(2)}m`);

    return { rootGroup, parts, rigidBodiesMap, jointsMap, boneMap, totalHeight };
  }

  private createMesh(def: BodyPartDef, position: THREE.Vector3): THREE.Mesh {
    let geometry: THREE.BufferGeometry;

    switch (def.shape) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(def.dims.rx, 16, 12);
        break;
      case 'capsule':
        geometry = new THREE.CapsuleGeometry(def.dims.rx, def.dims.h ?? 0.2, 8, 16);
        break;
      case 'box':
        geometry = new THREE.BoxGeometry(
          (def.dims.rx ?? 0.1) * 2,
          (def.dims.ry ?? 0.05) * 2,
          (def.dims.rz ?? 0.1) * 2
        );
        break;
    }

    const mesh = new THREE.Mesh(geometry, BODY_MATERIAL.clone());
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createColliderDesc(def: BodyPartDef): RAPIER.ColliderDesc {
    switch (def.shape) {
      case 'sphere':
        return RAPIER.ColliderDesc.ball(def.dims.rx);
      case 'capsule':
        return RAPIER.ColliderDesc.capsule(
          (def.dims.h ?? 0.2) / 2,
          def.dims.rx
        );
      case 'box':
        return RAPIER.ColliderDesc.cuboid(
          (def.dims.rx ?? 0.1),
          (def.dims.ry ?? 0.05),
          (def.dims.rz ?? 0.1)
        );
    }
  }

  public syncVisuals(parts: Map<string, ProceduralPart>): void {
    parts.forEach((part) => {
      if (!part.body.isValid()) return;
      const pos = part.body.translation();
      const rot = part.body.rotation();

      const rootPos = part.mesh.parent?.position ?? new THREE.Vector3();
      part.mesh.position.set(pos.x - rootPos.x, pos.y - rootPos.y, pos.z - rootPos.z);
      part.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    });
  }

  public cleanup(parts: Map<string, ProceduralPart>, rootGroup: THREE.Group): void {
    parts.forEach((part) => {
      try {
        if (part.body.isValid()) {
          this.physicsEngine.unregisterVelocityClampBody(part.body);
          this.world.removeRigidBody(part.body);
        }
      } catch (e) {
        // Silently ignore during cleanup
      }
      if (part.mesh.geometry) part.mesh.geometry.dispose();
      if (part.mesh.material) {
        if (Array.isArray(part.mesh.material)) {
          part.mesh.material.forEach(m => m.dispose());
        } else {
          (part.mesh.material as THREE.Material).dispose();
        }
      }
    });
    parts.clear();

    this.scene.remove(rootGroup);
    rootGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
          } else {
            (mesh.material as THREE.Material).dispose();
          }
        }
      }
    });
  }
}
