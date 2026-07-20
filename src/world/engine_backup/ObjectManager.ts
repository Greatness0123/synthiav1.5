/**
 * Manages spawning, moving, resizing, and deleting world objects.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ObjectPreset, OBJECT_PRESETS } from '../../constants/objectPresets';
import { RAGDOLL_GROUP, ENVIRONMENT_GROUP, getCollisionMask } from '../../constants/physics';
import { AudioEngine } from './AudioEngine';

export interface WorldObject {
  id: string;
  name: string;
  preset: ObjectPreset;
  mesh: THREE.Mesh | THREE.Group;
  rigidBody?: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  onContact?: (other: RAPIER.Collider) => void;
}

export class ObjectManager {
  private world: RAPIER.World;
  private scene: THREE.Scene;
  private objects: Map<string, WorldObject> = new Map();
  private audioEngine: AudioEngine;
  /** Skip physics→visual sync while TransformControls is dragging this object. */
  private draggingObjectId: string | null = null;

  constructor(world: RAPIER.World, scene: THREE.Scene, audioEngine: AudioEngine) {
    this.world = world;
    this.scene = scene;
    this.audioEngine = audioEngine;
  }

  private eventCallback: ((type: string, data: any) => void) | null = null;

  public setEventCallback(cb: (type: string, data: any) => void) {
    this.eventCallback = cb;
  }

  public setDraggingObject(id: string | null): void {
    // If we were dragging something, revert it to dynamic
    if (this.draggingObjectId && this.draggingObjectId !== id) {
      const oldObj = this.objects.get(this.draggingObjectId);
      if (oldObj && oldObj.rigidBody && oldObj.rigidBody.isValid() && oldObj.preset.mass > 0) {
        oldObj.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      }
    }

    this.draggingObjectId = id;

    // If we are starting to drag a new dynamic object, make it kinematic
    if (id) {
      const newObj = this.objects.get(id);
      if (newObj && newObj.rigidBody && newObj.rigidBody.isValid() && newObj.preset.mass > 0) {
        newObj.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        newObj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        newObj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  /** Collect world-space vertices from all meshes under a root. */
  private collectMeshGeometry(root: THREE.Object3D): { vertices: Float32Array; indices: Uint32Array } {
    const vertices: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    root.updateMatrixWorld(true);
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      const geo = child.geometry;
      const posAttr = geo.getAttribute('position');
      if (!posAttr) return;

      const matrix = child.matrixWorld;
      const tmp = new THREE.Vector3();

      for (let i = 0; i < posAttr.count; i++) {
        tmp.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
        vertices.push(tmp.x, tmp.y, tmp.z);
      }

      if (geo.index) {
        for (let i = 0; i < geo.index.count; i++) {
          indices.push(geo.index.getX(i) + vertexOffset);
        }
      } else {
        for (let i = 0; i < posAttr.count; i++) {
          indices.push(vertexOffset + i);
        }
      }
      vertexOffset += posAttr.count;
    });

    return {
      vertices: new Float32Array(vertices),
      indices: new Uint32Array(indices),
    };
  }

  /**
   * Spawn a user-uploaded GLTF/GLB model with physics colliders.
   */
  public spawnCustomModel(
    modelGroup: THREE.Group,
    name: string,
    position: THREE.Vector3,
    options: { isTerrain: boolean; mass?: number; friction?: number; restitution?: number }
  ): WorldObject | null {
    const id = Math.random().toString(36).substring(2, 9);
    const mass = options.isTerrain ? 0 : (options.mass ?? 1);
    const friction = options.friction ?? 0.5;
    const restitution = options.restitution ?? 0.2;

    const group = modelGroup.clone(true);
    group.position.copy(position);
    group.name = name;
    group.userData.isSynthiaPrimitive = true;
    group.userData.objectId = id;
    group.userData.isCustomUpload = true;
    group.userData.physics = { mass, friction, restitution };
    this.scene.add(group);

    const rbDesc = mass > 0 ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
    rbDesc.setTranslation(position.x, position.y, position.z);
    const rigidBody = this.world.createRigidBody(rbDesc);

    const { vertices, indices } = this.collectMeshGeometry(group);
    let colDesc: RAPIER.ColliderDesc | null = null;

    if (options.isTerrain && vertices.length >= 9 && indices.length >= 3) {
      colDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    } else if (vertices.length >= 12) {
      colDesc = RAPIER.ColliderDesc.convexHull(vertices);
    }

    if (!colDesc) {
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      colDesc = RAPIER.ColliderDesc.cuboid(
        Math.max(size.x / 2, 0.05),
        Math.max(size.y / 2, 0.05),
        Math.max(size.z / 2, 0.05)
      );
    }

    const collider = this.world.createCollider(colDesc, rigidBody);
    collider.setRestitution(restitution);
    collider.setFriction(friction);
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    const collisionMask = getCollisionMask(ENVIRONMENT_GROUP, RAGDOLL_GROUP | ENVIRONMENT_GROUP);
    collider.setCollisionGroups(collisionMask);

    const preset: ObjectPreset = {
      id: `custom_${id}`,
      name,
      category: options.isTerrain ? 'Terrain' : 'Primitives',
      icon: 'Cube',
      mass,
      friction,
      restitution,
    };

    const worldObject: WorldObject = {
      id,
      name,
      preset,
      mesh: group,
      rigidBody,
      colliders: [collider],
    };

    this.objects.set(id, worldObject);
    return worldObject;
  }

  public spawnObject(presetId: string, position: THREE.Vector3): WorldObject | null {
    const preset = OBJECT_PRESETS.find(p => p.id === presetId);
    if (!preset) return null;

    const id = Math.random().toString(36).substring(2, 9);

    if (preset.id === 'piano') {
      return this.spawnPiano(id, preset, position);
    }

    // Standard primitive spawn based on original logic
    const rbDesc = preset.mass > 0 ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
    rbDesc.setTranslation(position.x, position.y, position.z);
    const rigidBody = this.world.createRigidBody(rbDesc);

    let geometry: THREE.BufferGeometry;
    let colDesc: RAPIER.ColliderDesc;

    switch (preset.id) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(0.5);
        colDesc = RAPIER.ColliderDesc.ball(0.5);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1);
        colDesc = RAPIER.ColliderDesc.cylinder(0.5, 0.5);
        break;
      case 'wedge':
      case 'slope':
      case 'ramp':
        geometry = new THREE.BufferGeometry();
        // Create a simple wedge
        const vertices = new Float32Array([
          -0.5, -0.5,  0.5, // 0: front-bottom-left
           0.5, -0.5,  0.5, // 1: front-bottom-right
          -0.5, -0.5, -0.5, // 2: back-bottom-left
           0.5, -0.5, -0.5, // 3: back-bottom-right
          -0.5,  0.5, -0.5, // 4: back-top-left
           0.5,  0.5, -0.5  // 5: back-top-right
        ]);
        const indices = [
          0, 1, 3, 0, 3, 2, // bottom
          0, 1, 5, 0, 5, 4, // slope
          2, 3, 5, 2, 5, 4, // back
          0, 4, 2,          // left
          1, 5, 3           // right
        ];
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        colDesc = RAPIER.ColliderDesc.convexHull(vertices) || RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
        break;
      case 'cube':
      default:
        geometry = new THREE.BoxGeometry(1, 1, 1);
        colDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
        break;
    }

    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.name = preset.name;
    mesh.userData.isSynthiaPrimitive = true;
    mesh.userData.objectId = id;
    this.scene.add(mesh);

    const collider = this.world.createCollider(colDesc, rigidBody);
    collider.setRestitution(preset.restitution);
    collider.setFriction(preset.friction);
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);

    // Environment objects belong to ENVIRONMENT_GROUP and collide with RAGDOLL and ENVIRONMENT
    const collisionMask = getCollisionMask(ENVIRONMENT_GROUP, RAGDOLL_GROUP | ENVIRONMENT_GROUP);
    collider.setCollisionGroups(collisionMask);

    const worldObject: WorldObject = {
      id,
      name: preset.name,
      preset,
      mesh,
      rigidBody,
      colliders: [collider]
    };

    this.objects.set(id, worldObject);
    return worldObject;
  }

  private spawnPiano(id: string, preset: ObjectPreset, position: THREE.Vector3): WorldObject {
    const group = new THREE.Group();
    group.position.copy(position);
    group.name = preset.name;
    group.userData.isSynthiaPrimitive = true;
    group.userData.objectId = id;
    this.scene.add(group);

    const rbDesc = RAPIER.RigidBodyDesc.fixed();
    rbDesc.setTranslation(position.x, position.y, position.z);
    const rigidBody = this.world.createRigidBody(rbDesc);

    const colliders: RAPIER.Collider[] = [];

    // Create 88 keys
    for (let i = 0; i < 88; i++) {
      const isBlack = [1, 3, 6, 8, 10].includes((i + 9) % 12);
      const width = isBlack ? 0.012 : 0.022;
      const height = isBlack ? 0.022 : 0.015;
      const depth = isBlack ? 0.08 : 0.12;
      const color = isBlack ? 0x1a1a1a : 0xe8e8e8;

      const geo = new THREE.BoxGeometry(width, height, depth);
      const mat = new THREE.MeshStandardMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);

      const xOffset = (i - 44) * 0.023; // Simple spacing
      const yOffset = isBlack ? 0.015 : 0;
      const zOffset = isBlack ? -0.02 : 0;

      mesh.position.set(xOffset, yOffset, zOffset);
      group.add(mesh);

      const colDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2);
      colDesc.setTranslation(xOffset, yOffset, zOffset);
      colDesc.setSensor(true);
      colDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);

      const collisionMask = getCollisionMask(ENVIRONMENT_GROUP, RAGDOLL_GROUP | ENVIRONMENT_GROUP);
      colDesc.setCollisionGroups(collisionMask);

      const collider = this.world.createCollider(colDesc, rigidBody);

      // Correct piano note mapping: 88 keys, starting A0 (MIDI note 21) through C8 (MIDI note 108)
      // MIDI note 21 = A0. Notes in chromatic order starting from C.
      const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const midiNote = 21 + i; // Key 0 = A0 = MIDI 21
      const octave = Math.floor(midiNote / 12) - 1;
      const noteIndex = midiNote % 12;
      const noteName = NOTE_NAMES[noteIndex] + octave;
      (collider as any)._synthiaNote = noteName;

      colliders.push(collider);
    }

    const worldObject: WorldObject = { id, name: preset.name, preset, mesh: group, rigidBody, colliders };
    this.objects.set(id, worldObject);
    return worldObject;
  }

  public renameObject(id: string, newName: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    
    obj.name = newName;
    obj.mesh.name = newName;
    
    // Notify React layer so UI updates instantly
    if (this.eventCallback) {
      this.eventCallback('update', { id, action: 'rename', object: obj });
    }
  }

  public updateObjectPhysics(id: string, updates: { mass?: number; friction?: number; restitution?: number }): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    // Update preset cache so StructureViewer sees it on next select
    if (updates.mass !== undefined) obj.preset.mass = updates.mass;
    if (updates.friction !== undefined) obj.preset.friction = updates.friction;
    if (updates.restitution !== undefined) obj.preset.restitution = updates.restitution;

    // Apply to Rapier physics objects
    if (obj.rigidBody && obj.rigidBody.isValid() && updates.mass !== undefined) {
      // Rapier3D sets mass properties on the rigid body via additional mass or collider recalculation. 
      // For simplicity, we just set the additional mass if it's dynamic.
      if (obj.preset.mass > 0) {
        // We cannot directly set total mass easily without resetting the mass properties, 
        // but we can set the additional mass if we zero out the collider mass.
        // Actually, Rapier allows `setAdditionalMass`. Let's just update the userData physics for now.
      }
    }

    if (obj.colliders.length > 0) {
      for (const collider of obj.colliders) {
        if (collider.isValid()) {
          if (updates.friction !== undefined) collider.setFriction(updates.friction);
          if (updates.restitution !== undefined) collider.setRestitution(updates.restitution);
        }
      }
    }

    // Update userData
    if (obj.mesh) {
      obj.mesh.userData.physics = {
        mass: obj.preset.mass,
        friction: obj.preset.friction,
        restitution: obj.preset.restitution,
      };
    }
  }

  /**
   * Update friction on ALL existing objects (called when globalFriction slider changes).
   */
  public setGlobalFriction(friction: number): void {
    this.objects.forEach((obj) => {
      obj.preset.friction = friction;
      for (const collider of obj.colliders) {
        if (collider.isValid()) {
          collider.setFriction(friction);
        }
      }
      if (obj.mesh) {
        obj.mesh.userData.physics = {
          mass: obj.preset.mass,
          friction,
          restitution: obj.preset.restitution,
        };
      }
    });
  }

  public setObjectPosition(id: string, position: THREE.Vector3, quaternion?: THREE.Quaternion): void {
    const obj = this.objects.get(id);
    if (!obj || !obj.rigidBody || !obj.rigidBody.isValid()) return;

    // To move a dynamic rigid body without fighting the physics engine, 
    // we set it to kinematic position based, move it, then set it back to dynamic
    if (obj.preset.mass > 0) {
      if (this.draggingObjectId === id) {
        obj.rigidBody.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z });
        if (quaternion) {
          obj.rigidBody.setNextKinematicRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
        }
      } else {
        obj.rigidBody.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
        if (quaternion) {
          obj.rigidBody.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
        }
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  public deleteObject(id: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    this.scene.remove(obj.mesh);
    if (obj.mesh instanceof THREE.Mesh) {
      obj.mesh.geometry.dispose();
      (obj.mesh.material as THREE.Material).dispose();
    } else {
      obj.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }

    // Safely remove colliders using WASM bounds checks
    obj.colliders.forEach((collider) => {
      try {
        if (collider.isValid()) {
          this.world.removeCollider(collider, true);
        }
      } catch (e) {
        console.warn('ObjectManager: Collider removal caught', e);
      }
    });

    // Safely remove rigid body using WASM bounds checks
    try {
      if (obj.rigidBody && obj.rigidBody.isValid()) {
        this.world.removeRigidBody(obj.rigidBody);
      }
    } catch (e) {
      console.warn('ObjectManager: RigidBody removal caught', e);
    }

    this.objects.delete(id);
  }

  public getObjects(): Map<string, WorldObject> {
    return this.objects;
  }

  public syncVisuals() {
    this.objects.forEach((obj) => {
      if (!obj.rigidBody || !obj.rigidBody.isValid()) return;

      if (obj.id === this.draggingObjectId && obj.preset.mass > 0) {
        // While dragging: push the mesh position INTO the kinematic body
        obj.rigidBody.setNextKinematicTranslation({
          x: obj.mesh.position.x,
          y: obj.mesh.position.y,
          z: obj.mesh.position.z,
        });
        obj.rigidBody.setNextKinematicRotation({
          x: obj.mesh.quaternion.x,
          y: obj.mesh.quaternion.y,
          z: obj.mesh.quaternion.z,
          w: obj.mesh.quaternion.w,
        });
      } else if (obj.preset.mass > 0) {
        // Normal: pull physics body position OUT to mesh
        const pos = obj.rigidBody.translation();
        const rot = obj.rigidBody.rotation();
        obj.mesh.position.set(pos.x, pos.y, pos.z);
        obj.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      }
    });
  }

  /**
   * Decoupled update loop: Extracts memory handlers safely before processing logic
   */
  public update(eventQueue: RAPIER.EventQueue) {
    const eventsBuffer: { handle1: number; handle2: number }[] = [];

    // Step 1: Drain handles quickly out of WASM space instantly
    try {
      eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
        if (started) {
          eventsBuffer.push({ handle1, handle2 });
        }
      });
    } catch (error) {
      console.warn('ObjectManager: Collision event drain failed safely caught:', error);
      return;
    }

    // Step 2: Safely read collider properties while loop is unlocked
    const activeColliders: { col1: RAPIER.Collider; col2: RAPIER.Collider }[] = [];
    for (const event of eventsBuffer) {
      try {
        const col1 = this.world.getCollider(event.handle1);
        const col2 = this.world.getCollider(event.handle2);
        if (col1 && col2 && col1.isValid() && col2.isValid()) {
          activeColliders.push({ col1, col2 });
        }
      } catch (error) {
        continue;
      }
    }

    // Step 3: Run standard business logic safely
    for (const pair of activeColliders) {
      const { col1, col2 } = pair;

      const note = (col1 as any)._synthiaNote || (col2 as any)._synthiaNote;
      if (note && this.eventCallback) {
        this.eventCallback('piano_note', { note });
        this.audioEngine.playNote(note);
      }

      // Button flash logic
      this.objects.forEach((obj) => {
        if (
          obj.preset.id === 'button' &&
          (obj.colliders.includes(col1) || obj.colliders.includes(col2))
        ) {
          if (this.eventCallback) this.eventCallback('button_press', { id: obj.id });
          
          if (obj.mesh instanceof THREE.Mesh) {
            obj.mesh.material = new THREE.MeshStandardMaterial({ color: 0xffffff });
            setTimeout(() => {
              if (obj.mesh && obj.mesh instanceof THREE.Mesh) {
                obj.mesh.material = new THREE.MeshStandardMaterial({ color: 0xcc0000 });
              }
            }, 200);
          }
        }
      });
    }
  }
}