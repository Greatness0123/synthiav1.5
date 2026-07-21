import * as THREE from 'three';
import { ObjectPreset, OBJECT_PRESETS } from '../../constants/objectPresets';
import { PhysicsEngine } from './PhysicsEngine';
import { CollisionAdapter } from './CollisionAdapter';
import { AudioEngine } from './AudioEngine';
import { logger as Logger } from '../../utils/logger';

export interface WorldObject {
  id: string;
  name: string;
  preset: ObjectPreset;
  mesh: THREE.Mesh | THREE.Group;
  colliders: number[]; // geom IDs in MuJoCo
  onContact?: (otherId: number) => void;
  // MuJoCo specific tracking fields
  bodyName?: string;
  bodyId?: number;
  slotIndex?: number; // if pre-allocated
  isCustom?: boolean;
}

export class ObjectManager {
  private physicsEngine: PhysicsEngine;
  private scene: THREE.Scene;
  private objects: Map<string, WorldObject> = new Map();
  private audioEngine: AudioEngine;

  // Track dragging state
  private draggingObjectId: string | null = null;

  // Primitive slot pool tracking (20 slots)
  private slotClaimed: boolean[] = new Array(20).fill(false);
  private slotToObjectId: Map<number, string> = new Map();

  private eventCallback: ((type: string, data: any) => void) | null = null;

  // Cache for custom mesh structures currently added to the scene to allow reloads
  private customMeshesSpec: Array<{
    id: string;
    name: string;
    preset: ObjectPreset;
    position: THREE.Vector3;
    quaternion?: THREE.Quaternion;
    options: { isTerrain: boolean; mass?: number; friction?: number; restitution?: number };
    vertices: Float32Array;
    indices: Uint32Array;
  }> = [];

  constructor(physicsEngine: PhysicsEngine, scene: THREE.Scene, audioEngine: AudioEngine) {
    this.physicsEngine = physicsEngine;
    this.scene = scene;
    this.audioEngine = audioEngine;
  }

  public setEventCallback(cb: (type: string, data: any) => void) {
    this.eventCallback = cb;
  }

  public setDraggingObject(id: string | null): void {
    this.draggingObjectId = id;
    if (id) {
      const obj = this.objects.get(id);
      if (obj && obj.bodyId !== undefined && obj.bodyId >= 0) {
        // Zero out velocities on dragging start to prevent erratic physics throws
        const world = this.physicsEngine.getWorld();
        const qvel = this.physicsEngine.qvel;
        const dofAdr = world.model.body_dofadr[obj.bodyId];
        const dofNum = world.model.body_dofnum[obj.bodyId];
        if (dofAdr !== undefined && dofNum === 6) {
          for (let i = 0; i < 6; i++) {
            qvel[dofAdr + i] = 0;
          }
        }
      }
    }
  }

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
   * Helper to perform scene state-capture, compilation, reload, and hydration
   */
  private reloadStateAndRehydrate(newMeshSpec?: any) {
    this.physicsEngine.setMutating(true);
    this.physicsEngine.setReady(false);

    try {
      const world = this.physicsEngine.getWorld();
      const model = world.model;
      const data = world.data;
      const module = PhysicsEngine.getModule();
      if (!module) return;

      // 1. Capture current simulation state
      const stateCache: Record<string, {
        pos: [number, number, number];
        quat: [number, number, number, number];
        linvel: [number, number, number];
        angvel: [number, number, number];
      }> = {};

      // Capture humanoid qpos / qvel
      const humanoidQPos: number[] = [];
      const humanoidQVel: number[] = [];
      for (let i = 0; i < model.nq; i++) humanoidQPos.push(data.qpos[i]);
      for (let i = 0; i < model.nv; i++) humanoidQVel.push(data.qvel[i]);

      // Capture active dynamic objects state
      this.objects.forEach((obj) => {
        if (obj.bodyId !== undefined && obj.bodyId >= 0) {
          const dofAdr = model.body_dofadr[obj.bodyId];
          const dofNum = model.body_dofnum[obj.bodyId];
          const qposAdr = model.jnt_qposadr[model.body_jntadr[obj.bodyId]];

          if (dofNum === 6) {
            stateCache[obj.id] = {
              pos: [data.qpos[qposAdr], data.qpos[qposAdr + 1], data.qpos[qposAdr + 2]],
              quat: [data.qpos[qposAdr + 3], data.qpos[qposAdr + 4], data.qpos[qposAdr + 5], data.qpos[qposAdr + 6]],
              linvel: [data.qvel[dofAdr], data.qvel[dofAdr + 1], data.qvel[dofAdr + 2]],
              angvel: [data.qvel[dofAdr + 3], data.qvel[dofAdr + 4], data.qvel[dofAdr + 5]],
            };
          }
        }
      });

      // 3. Rebuild the XML MJCF model
      // Retrieve humanoid visual bones model structure
      const skeletonBinder = (window as any).__SYNTHIA_HUMANOID_BINDER__;
      if (!skeletonBinder) {
        throw new Error('Hydration error: Humanoid binder reference is missing.');
      }

      const mbm = skeletonBinder.getMultiBodyManager();

      // Generate base MJCF XML string from pristine or current accumulated base XML
      const baseXml = newMeshSpec
        ? (mbm.getCurrentBaseMjcfXml() || mbm.getPristineBaseMjcfXml())
        : mbm.getPristineBaseMjcfXml();

      if (!baseXml) {
        throw new Error('Hydration error: Pristine or current base MJCF is empty or uninitialized');
      }

      // If we have a new custom mesh, only append the new mesh to the current accumulated XML.
      // If we are reloading/deleting, append all remaining specs onto the pristine base.
      const specsToAppend = newMeshSpec ? [newMeshSpec] : this.customMeshesSpec;

      // Append the new custom mesh spec to specs cache
      if (newMeshSpec) {
        this.customMeshesSpec.push(newMeshSpec);
      }

      // Parse and construct the combined custom model XML tags
      const customModelsXml = specsToAppend.map((spec) => {
        const posMj = PhysicsEngine.worldToMuJoCo(spec.position);
        const quatMj = spec.quaternion
          ? PhysicsEngine.threeQuatToMuJoCo(spec.quaternion)
          : [1, 0, 0, 0];

        // Format vertex lists and index lists for MuJoCo XML
        const verticesStr = Array.from(spec.vertices).join(' ');
        const facesStr = Array.from(spec.indices).join(' ');

        // Declare custom mesh assets inside an inline asset tag or globally
        // For simplicity and XML structure compatibility, declare <asset> with <mesh> inside the body,
        // and link them to <geom type="mesh" mesh="...">.
        return `
    <asset>
      <mesh name="mesh_${spec.id}" vertex="${verticesStr}" face="${facesStr}"/>
    </asset>
    <body name="custom_${spec.id}" pos="${posMj[0]} ${posMj[1]} ${posMj[2]}" quat="${quatMj[0]} ${quatMj[1]} ${quatMj[2]} ${quatMj[3]}">
      <freejoint name="custom_${spec.id}_joint"/>
      <geom name="custom_geom_${spec.id}" type="mesh" mesh="mesh_${spec.id}" contype="2" conaffinity="1"/>
      <inertial pos="0 0 0" mass="${spec.preset.mass}" diaginertia="0.1 0.1 0.1"/>
    </body>`;
      }).join('\n');

      // Inject custom body models inside the worldbody before reload
      let combinedXml = baseXml;

      // Injecting before </worldbody>
      const worldbodyEndIdx = combinedXml.lastIndexOf('</worldbody>');
      if (worldbodyEndIdx >= 0) {
        combinedXml = combinedXml.slice(0, worldbodyEndIdx) + customModelsXml + combinedXml.slice(worldbodyEndIdx);
      }

      // 4. Load compiled XML into the physics engine
      this.physicsEngine.loadMJCFModel(combinedXml);
      skeletonBinder.getMultiBodyManager().setCurrentBaseMjcfXml(combinedXml);
      this.physicsEngine.setReady(true);

      const newWorld = this.physicsEngine.getWorld();
      const newModel = newWorld.model;
      const newData = newWorld.data;

      // 5. State rehydration into the new mjData heap view
      // Rehydrate Humanoid state
      for (let i = 0; i < Math.min(newModel.nq, humanoidQPos.length); i++) newData.qpos[i] = humanoidQPos[i];
      for (let i = 0; i < Math.min(newModel.nv, humanoidQVel.length); i++) newData.qvel[i] = humanoidQVel[i];

      // Rehydrate pre-allocated slot bodies and custom models
      this.objects.forEach((obj) => {
        // Look up new body ID after reload
        let bodyId = -1;
        if (obj.isCustom) {
          bodyId = module.mj_name2id(newModel, module.mjtObj.mjOBJ_BODY.value, `custom_${obj.id}`);
        } else if (obj.slotIndex !== undefined) {
          bodyId = module.mj_name2id(newModel, module.mjtObj.mjOBJ_BODY.value, `env_slot_${obj.slotIndex}`);
        }

        if (bodyId >= 0) {
          obj.bodyId = bodyId;
          const cached = stateCache[obj.id];
          if (cached) {
            const dofAdr = newModel.body_dofadr[bodyId];
            const qposAdr = newModel.jnt_qposadr[newModel.body_jntadr[bodyId]];

            newData.qpos[qposAdr] = cached.pos[0];
            newData.qpos[qposAdr + 1] = cached.pos[1];
            newData.qpos[qposAdr + 2] = cached.pos[2];
            newData.qpos[qposAdr + 3] = cached.quat[0];
            newData.qpos[qposAdr + 4] = cached.quat[1];
            newData.qpos[qposAdr + 5] = cached.quat[2];
            newData.qpos[qposAdr + 6] = cached.quat[3];

            newData.qvel[dofAdr] = cached.linvel[0];
            newData.qvel[dofAdr + 1] = cached.linvel[1];
            newData.qvel[dofAdr + 2] = cached.linvel[2];
            newData.qvel[dofAdr + 3] = cached.angvel[0];
            newData.qvel[dofAdr + 4] = cached.angvel[1];
            newData.qvel[dofAdr + 5] = cached.angvel[2];
          }

          // Re-populate mapped geom colliders IDs
          obj.colliders = [];
          if (obj.isCustom) {
            const geomId = module.mj_name2id(newModel, module.mjtObj.mjOBJ_GEOM.value, `custom_geom_${obj.id}`);
            if (geomId >= 0) obj.colliders.push(geomId);
          } else if (obj.slotIndex !== undefined) {
            // Re-claim sibling geom ID (mapping cube, wedge, slope, ramp to box)
            const actualPresetShapeId = ['cube', 'wedge', 'slope', 'ramp'].includes(obj.preset.id) ? 'box' : obj.preset.id;
            const activeGeomName = `env_slot_${obj.slotIndex}_${actualPresetShapeId}`;
            const geomId = module.mj_name2id(newModel, module.mjtObj.mjOBJ_GEOM.value, activeGeomName);
            if (geomId >= 0) obj.colliders.push(geomId);
          }
        }
      });

    } catch (error) {
      Logger.error('ObjectManager: Mesh reload and state hydration failed!', error);
    } finally {
      this.physicsEngine.setMutating(false);
    }
  }

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

    const preset: ObjectPreset = {
      id: `custom_${id}`,
      name,
      category: options.isTerrain ? 'Terrain' : 'Primitives',
      icon: 'Cube',
      mass,
      friction,
      restitution,
    };

    const { vertices, indices } = this.collectMeshGeometry(group);

    const worldObject: WorldObject = {
      id,
      name,
      preset,
      mesh: group,
      colliders: [],
      isCustom: true,
    };

    this.objects.set(id, worldObject);

    // Call XML compilation reload and rehydration
    this.reloadStateAndRehydrate({
      id,
      name,
      preset,
      position,
      options,
      vertices,
      indices
    });

    return worldObject;
  }

  public spawnObject(presetId: string, position: THREE.Vector3): WorldObject | null {
    if (presetId === 'piano') {
      const id = Math.random().toString(36).substring(2, 9);
      return this.spawnPiano(id, { id: 'piano', name: 'Piano', category: 'Interactive', icon: 'MusicNotes', mass: 50, friction: 0.5, restitution: 0.1 }, position);
    }

    const preset = OBJECT_PRESETS.find((p: any) => p.id === presetId);
    if (!preset) return null;

    // 1. Find an unclaimed pre-allocated pool slot
    const slotIdx = this.slotClaimed.indexOf(false);
    if (slotIdx < 0) {
      Logger.warn('ObjectManager: Pre-allocated slots exhausted (all 20 slots active!)');
      return null;
    }

    const id = Math.random().toString(36).substring(2, 9);

    // 2. Set slot claimed
    this.slotClaimed[slotIdx] = true;
    this.slotToObjectId.set(slotIdx, id);

    // 3. Create visual representation in Three.js
    let geometry: THREE.BufferGeometry;
    switch (preset.id) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(0.5);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1);
        break;
      case 'wedge':
      case 'slope':
      case 'ramp':
        geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
          -0.5, -0.5,  0.5,
           0.5, -0.5,  0.5,
          -0.5, -0.5, -0.5,
           0.5, -0.5, -0.5,
          -0.5,  0.5, -0.5,
           0.5,  0.5, -0.5
        ]);
        const indices = [
          0, 1, 3, 0, 3, 2,
          0, 1, 5, 0, 5, 4,
          2, 3, 5, 2, 5, 4,
          0, 4, 2,
          1, 5, 3
        ];
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        break;
      case 'cube':
      default:
        geometry = new THREE.BoxGeometry(1, 1, 1);
        break;
    }

    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.name = preset.name;
    mesh.userData.isSynthiaPrimitive = true;
    mesh.userData.objectId = id;
    this.scene.add(mesh);

    // 4. Activate MuJoCo sibling geom (sphere, box, cylinder, capsule) in the claiming slot body
    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;
    const module = PhysicsEngine.getModule();
    if (!module) return null;

    const bodyName = `env_slot_${slotIdx}`;
    const bodyId = module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, bodyName);
    if (bodyId < 0) return null;

    // Activate the corresponding sibling geom size and collision bits
    // We map cube, wedge, slope, ramp to oriented dynamic box geoms as confirmed by the user
    const actualPresetShapeId = ['cube', 'wedge', 'slope', 'ramp'].includes(preset.id) ? 'box' : preset.id;
    const activeGeomName = `env_slot_${slotIdx}_${actualPresetShapeId}`;
    const geomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, activeGeomName);

    if (geomId >= 0) {
      // Set correct size dimensions
      const adapterGeom = CollisionAdapter.objectPresetToMJCFGeom(preset);
      const sizeValues = adapterGeom.size.split(' ').map(Number);

      // Update sizes in MjModel directly (size size stride)
      const sizeOffset = geomId * 3;
      model.geom_size[sizeOffset] = sizeValues[0] || 0;
      model.geom_size[sizeOffset + 1] = sizeValues[1] || 0;
      model.geom_size[sizeOffset + 2] = sizeValues[2] || 0;

      // Enable collision parameters (ENVIRONMENT_CONTYPE = 2, ENVIRONMENT_CONAFFINITY = 3)
      model.geom_contype[geomId] = 2;
      model.geom_conaffinity[geomId] = 3;

      // Set global friction & restitution in model
      model.geom_friction[geomId * 3] = preset.friction;
      model.geom_solref[geomId * 2] = 0.02; // default solref kp
      model.geom_solimp[geomId * 3 + 2] = preset.restitution; // default solimp damp
    }

    // Move pre-allocated body slot position to spawn coordinates in qpos (freejoint has 7 coordinates: x,y,z, w,x,y,z)
    const qposAdr = model.jnt_qposadr[model.body_jntadr[bodyId]];
    const posMj = PhysicsEngine.worldToMuJoCo(position);
    data.qpos[qposAdr] = posMj[0];
    data.qpos[qposAdr + 1] = posMj[1];
    data.qpos[qposAdr + 2] = posMj[2];

    const worldObject: WorldObject = {
      id,
      name: preset.name,
      preset,
      mesh,
      colliders: geomId >= 0 ? [geomId] : [],
      bodyName,
      bodyId,
      slotIndex: slotIdx,
    };

    this.objects.set(id, worldObject);
    return worldObject;
  }

  public spawnPiano(id: string, preset: ObjectPreset, position: THREE.Vector3): WorldObject {
    const group = new THREE.Group();
    group.position.copy(position);
    group.name = preset.name;
    group.userData.isSynthiaPrimitive = true;
    group.userData.objectId = id;
    this.scene.add(group);

    // Build Three.js visual key blocks matching the pre-allocated boxes
    for (let i = 0; i < 88; i++) {
      const isBlack = [1, 3, 6, 8, 10].includes((i + 9) % 12);
      const width = isBlack ? 0.012 : 0.022;
      const height = isBlack ? 0.022 : 0.015;
      const depth = isBlack ? 0.08 : 0.12;
      const color = isBlack ? 0x1a1a1a : 0xe8e8e8;

      const geo = new THREE.BoxGeometry(width, height, depth);
      const mat = new THREE.MeshStandardMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);

      const xOffset = (i - 44) * 0.023;
      const yOffset = isBlack ? 0.015 : 0;
      const zOffset = isBlack ? -0.02 : 0;

      mesh.position.set(xOffset, yOffset, zOffset);
      group.add(mesh);
    }

    // Activate pre-allocated piano body
    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;
    const module = PhysicsEngine.getModule();

    let pianoBodyId = -1;
    const colliders: number[] = [];

    if (module) {
      pianoBodyId = module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, 'piano_body');
      if (pianoBodyId >= 0) {
        // Move piano body to spawn point
        const qposAdr = model.jnt_qposadr[model.body_jntadr[pianoBodyId]];
        const posMj = PhysicsEngine.worldToMuJoCo(position);
        data.qpos[qposAdr] = posMj[0];
        data.qpos[qposAdr + 1] = posMj[1];
        data.qpos[qposAdr + 2] = posMj[2];

        // Enable collision masks (contype/conaffinity) for all 88 keys
        const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        for (let i = 0; i < 88; i++) {
          const midiNote = 21 + i;
          const octave = Math.floor(midiNote / 12) - 1;
          const noteIndex = midiNote % 12;
          const noteName = NOTE_NAMES[noteIndex] + octave;

          const geomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, `piano_${noteName}`);
          if (geomId >= 0) {
            colliders.push(geomId);
            // Sensor key: ENVIRONMENT_CONTYPE=2, ENVIRONMENT_CONAFFINITY=3 (can be triggered as sensor note)
            model.geom_contype[geomId] = 2;
            model.geom_conaffinity[geomId] = 3;
          }
        }
      }
    }

    const worldObject: WorldObject = {
      id,
      name: preset.name,
      preset,
      mesh: group,
      colliders,
      bodyName: 'piano_body',
      bodyId: pianoBodyId,
    };

    this.objects.set(id, worldObject);
    return worldObject;
  }

  public renameObject(id: string, newName: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    obj.name = newName;
    obj.mesh.name = newName;

    if (this.eventCallback) {
      this.eventCallback('update', { id, action: 'rename', object: obj });
    }
  }

  public updateObjectPhysics(id: string, updates: { mass?: number; friction?: number; restitution?: number }): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    if (updates.mass !== undefined) obj.preset.mass = updates.mass;
    if (updates.friction !== undefined) obj.preset.friction = updates.friction;
    if (updates.restitution !== undefined) obj.preset.restitution = updates.restitution;

    const world = this.physicsEngine.getWorld();
    const model = world.model;

    obj.colliders.forEach((geomId) => {
      if (updates.friction !== undefined) {
        model.geom_friction[geomId * 3] = updates.friction;
      }
      if (updates.restitution !== undefined) {
        model.geom_solimp[geomId * 3 + 2] = updates.restitution;
      }
    });

    if (obj.mesh) {
      obj.mesh.userData.physics = {
        mass: obj.preset.mass,
        friction: obj.preset.friction,
        restitution: obj.preset.restitution,
      };
    }
  }

  public setGlobalFriction(friction: number): void {
    this.objects.forEach((obj) => {
      obj.preset.friction = friction;
      this.updateObjectPhysics(obj.id, { friction });
    });
  }

  public setObjectPosition(id: string, position: THREE.Vector3, quaternion?: THREE.Quaternion): void {
    const obj = this.objects.get(id);
    if (!obj || obj.bodyId === undefined || obj.bodyId < 0) return;

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;

    const jntAdr = model.body_jntadr[obj.bodyId];
    if (jntAdr < 0) return;

    const qposAdr = model.jnt_qposadr[jntAdr];
    const dofAdr = model.body_dofadr[obj.bodyId];

    const posMj = PhysicsEngine.worldToMuJoCo(position);
    data.qpos[qposAdr] = posMj[0];
    data.qpos[qposAdr + 1] = posMj[1];
    data.qpos[qposAdr + 2] = posMj[2];

    if (quaternion) {
      const quatMj = PhysicsEngine.threeQuatToMuJoCo(quaternion);
      data.qpos[qposAdr + 3] = quatMj[0];
      data.qpos[qposAdr + 4] = quatMj[1];
      data.qpos[qposAdr + 5] = quatMj[2];
      data.qpos[qposAdr + 6] = quatMj[3];
    }

    // Zero out velocities to ensure accurate static placement
    if (dofAdr >= 0) {
      data.qvel[dofAdr] = 0;
      data.qvel[dofAdr + 1] = 0;
      data.qvel[dofAdr + 2] = 0;
      data.qvel[dofAdr + 3] = 0;
      data.qvel[dofAdr + 4] = 0;
      data.qvel[dofAdr + 5] = 0;
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

    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;

    // Reset geom collision/size bounds on slot releasing
    if (obj.slotIndex !== undefined) {
      this.slotClaimed[obj.slotIndex] = false;
      this.slotToObjectId.delete(obj.slotIndex);

      obj.colliders.forEach((geomId) => {
        // Zero size and disable collision bits
        const sizeOffset = geomId * 3;
        model.geom_size[sizeOffset] = 0.001;
        model.geom_size[sizeOffset + 1] = 0.001;
        model.geom_size[sizeOffset + 2] = 0.001;

        model.geom_contype[geomId] = 0;
        model.geom_conaffinity[geomId] = 0;
      });

      // Move body far below scene to hide it from step constraints
      if (obj.bodyId !== undefined && obj.bodyId >= 0) {
        const qposAdr = model.jnt_qposadr[model.body_jntadr[obj.bodyId]];
        data.qpos[qposAdr] = 0;
        data.qpos[qposAdr + 1] = 0;
        data.qpos[qposAdr + 2] = -10; // underground
      }
    } else if (obj.preset.id === 'piano' && obj.bodyId !== undefined && obj.bodyId >= 0) {
      // Deactivate pre-allocated piano body
      obj.colliders.forEach((geomId) => {
        model.geom_contype[geomId] = 0;
        model.geom_conaffinity[geomId] = 0;
      });
      const qposAdr = model.jnt_qposadr[model.body_jntadr[obj.bodyId]];
      data.qpos[qposAdr] = 0;
      data.qpos[qposAdr + 1] = 0;
      data.qpos[qposAdr + 2] = -30; // deep underground
    } else if (obj.isCustom) {
      // Custom uploaded dynamic meshes: remove spec and reload state to fully strip from the XML memory compilation
      this.customMeshesSpec = this.customMeshesSpec.filter(spec => spec.id !== id);
      this.reloadStateAndRehydrate();
    }

    this.objects.delete(id);
  }

  public getObjects(): Map<string, WorldObject> {
    return this.objects;
  }

  public syncVisuals() {
    const world = this.physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;

    this.objects.forEach((obj) => {
      if (obj.bodyId === undefined || obj.bodyId < 0) return;

      const jntAdr = model.body_jntadr[obj.bodyId];
      if (jntAdr < 0) return;

      const qposAdr = model.jnt_qposadr[jntAdr];

      if (obj.id === this.draggingObjectId) {
        // Direct kinematic visual mapping
        const posMj = PhysicsEngine.worldToMuJoCo(obj.mesh.position);
        data.qpos[qposAdr] = posMj[0];
        data.qpos[qposAdr + 1] = posMj[1];
        data.qpos[qposAdr + 2] = posMj[2];

        const quatMj = PhysicsEngine.threeQuatToMuJoCo(obj.mesh.quaternion);
        data.qpos[qposAdr + 3] = quatMj[0];
        data.qpos[qposAdr + 4] = quatMj[1];
        data.qpos[qposAdr + 5] = quatMj[2];
        data.qpos[qposAdr + 6] = quatMj[3];
      } else {
        // MuJoCo positions (p_mj = [x, y, z]) converted back to Three.js coordinates
        const x_mj = data.qpos[qposAdr];
        const y_mj = data.qpos[qposAdr + 1];
        const z_mj = data.qpos[qposAdr + 2];
        const posThree = PhysicsEngine.mujocoToWorld([x_mj, y_mj, z_mj]);
        obj.mesh.position.set(posThree.x, posThree.y, posThree.z);

        const qW = data.qpos[qposAdr + 3];
        const qX = data.qpos[qposAdr + 4];
        const qY = data.qpos[qposAdr + 5];
        const qZ = data.qpos[qposAdr + 6];
        const rotThree = PhysicsEngine.mujocoQuatToThree([qW, qX, qY, qZ]);
        obj.mesh.quaternion.set(rotThree.x, rotThree.y, rotThree.z, rotThree.w);
      }
    });
  }

  public update() {
    const module = PhysicsEngine.getModule();
    if (!module) return;

    const world = this.physicsEngine.getWorld();
    const pairs = CollisionAdapter.getCollisionPairs(module, world.model, world.data);

    // Track triggered note events to prevent duplicate frame fires
    const triggeredNotes = new Set<string>();

    pairs.forEach((pair) => {
      // 1. Piano Notes Detection: Check if either geom matches piano_key sequence
      const pianoKeyPrefix = 'piano_';
      let keyGeomName: string | null = null;
      if (pair.name1.startsWith(pianoKeyPrefix)) keyGeomName = pair.name1;
      else if (pair.name2.startsWith(pianoKeyPrefix)) keyGeomName = pair.name2;

      if (keyGeomName) {
        const note = keyGeomName.substring(pianoKeyPrefix.length);
        if (!triggeredNotes.has(note)) {
          triggeredNotes.add(note);
          if (this.eventCallback) {
            this.eventCallback('piano_note', { note });
            this.audioEngine.playNote(note);
          }
        }
      }

      // 2. Button Press Callback: check if either geom belongs to a claims slot of a button primitive
      this.objects.forEach((obj) => {
        if (obj.preset.id === 'button') {
          if (obj.colliders.includes(pair.geom1Id) || obj.colliders.includes(pair.geom2Id)) {
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
        }
      });
    });
  }
}
