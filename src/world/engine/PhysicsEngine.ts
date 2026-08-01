import mujoco, { MainModule, MjModel, MjData, MjContact } from '@mujoco/mujoco';
import * as THREE from 'three';
import { logger as Logger } from '../../utils/logger';

export interface ColliderContactState {
  inContact: boolean;
  impulse_magnitude: number;
  contact_normal: [number, number, number];
  /** World-frame (MuJoCo coords) contact force in Newtons applied to this geom. */
  contact_force: [number, number, number];
  max_force_magnitude: number;
  lastUpdate: number;
}

export interface MuJoCoContactForceData {
  collider1: number;
  collider2: number;
  impulse_magnitude: number;
  contact_normal: [number, number, number];
  contact_force: [number, number, number];
  max_force_magnitude: number;
  started: boolean;
  lastUpdate: number;
}

export class PhysicsEngine {
  private static mujocoInitPromise: Promise<MainModule> | null = null;
  private static mujocoModule: MainModule | null = null;

  private model: MjModel | null = null;
  private data: MjData | null = null;
  private initialized = false;
  public isReady = false;
  public isStepping = false;
  private isMutatingWorld = false;
  private isPhysicsBroken = false;
  private lastLoadedXml = '';

  private contactForceRegistry: Map<number, ColliderContactState> = new Map();
  private velocityClampBodies: Set<number> = new Set();
  private stepCount = 0;

  private cachedQPos: Float64Array | null = null;
  private cachedQVel: Float64Array | null = null;
  private cachedCtrl: Float64Array | null = null;

  // Conversion Helpers: WorldToMuJoCo and MuJoCoToWorld (p = (x, -z, y))
  public static worldToMuJoCo(v: { x: number; y: number; z: number }): [number, number, number] {
    return [v.x, -v.z, v.y];
  }

  public static mujocoToWorld(p: [number, number, number]): { x: number; y: number; z: number } {
    return {
      x: p[0],
      y: p[2],
      z: -p[1]
    };
  }

  // Quaternion Alignment: Q_align = +90 deg about X.
  // threeQuat = (x, y, z, w)
  // q_transformed = Q_align * q_three * Q_align⁻¹
  // q_mujoco = (w, x, y, z) [scalar-first]
  public static threeQuatToMuJoCo(q: { x: number; y: number; z: number; w: number }): [number, number, number, number] {
    const threeQ = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const qAlign = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const qAlignInv = qAlign.clone().invert();
    const qTransformed = qAlign.clone().multiply(threeQ).multiply(qAlignInv);
    return [qTransformed.w, qTransformed.x, qTransformed.y, qTransformed.z];
  }

  public static mujocoQuatToThree(qWxyz: [number, number, number, number]): { x: number; y: number; z: number; w: number } {
    const qMj = new THREE.Quaternion(qWxyz[1], qWxyz[2], qWxyz[3], qWxyz[0]);
    const qAlign = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const qAlignInv = qAlign.clone().invert();
    const qThree = qAlignInv.clone().multiply(qMj).multiply(qAlign);
    return {
      x: qThree.x,
      y: qThree.y,
      z: qThree.z,
      w: qThree.w
    };
  }

  private static async ensureMuJoCoInitialized(): Promise<MainModule> {
    if (PhysicsEngine.mujocoModule) return PhysicsEngine.mujocoModule;

    if (!PhysicsEngine.mujocoInitPromise) {
      PhysicsEngine.mujocoInitPromise = (async () => {
        const module = await mujoco({
          locateFile: (filename: string) => {
            if (filename.endsWith('.wasm')) {
              // In Node context (Jest), resolve the real file on the local machine
              if (typeof window === 'undefined') {
                return 'public/mujoco/mujoco.wasm';
              }
              return '/mujoco/mujoco.wasm';
            }
            return filename;
          }
        });
        PhysicsEngine.mujocoModule = module;
        return module;
      })();
    }

    try {
      return await PhysicsEngine.mujocoInitPromise;
    } catch (error) {
      PhysicsEngine.mujocoInitPromise = null;
      throw error;
    }
  }

  public get qpos(): Float64Array {
    if (!this.data) throw new Error('Data not initialized');
    this.cachedQPos = this.data.qpos;
    return this.cachedQPos as Float64Array;
  }

  public get qvel(): Float64Array {
    if (!this.data) throw new Error('Data not initialized');
    this.cachedQVel = this.data.qvel;
    return this.cachedQVel as Float64Array;
  }

  public get ctrl(): Float64Array {
    if (!this.data) throw new Error('Data not initialized');
    this.cachedCtrl = this.data.ctrl;
    return this.cachedCtrl as Float64Array;
  }

  public static getModule(): MainModule | null {
    return PhysicsEngine.mujocoModule;
  }

  public getModel(): MjModel | null {
    return this.model;
  }

  public getData(): MjData | null {
    return this.data;
  }

  public getLastLoadedXml(): string {
    return this.lastLoadedXml;
  }

  public loadMJCFModel(xmlString: string): void {
    const module = PhysicsEngine.mujocoModule;
    if (!module) {
      throw new Error('MuJoCo module not initialized');
    }

    this.isReady = false;
    this.isMutatingWorld = true;

    try {
      if (this.model) {
        this.model.delete();
        this.model = null;
      }
      if (this.data) {
        this.data.delete();
        this.data = null;
      }

      module.FS.writeFile('/model.xml', xmlString);
      this.lastLoadedXml = xmlString;

      this.model = module.MjModel.mj_loadXML('/model.xml');
      if (!this.model) {
        throw new Error('Failed to load MJCF model');
      }

      this.data = new module.MjData(this.model);
      module.mj_forward(this.model, this.data);
      this.initialized = true;
      this.isPhysicsBroken = false;
      Logger.info('MuJoCoPhysicsEngine: MJCF model loaded successfully');
    } catch (error) {
      Logger.error('MuJoCoPhysicsEngine: Failed to load MJCF model', error);
      this.isPhysicsBroken = true;
      throw error;
    } finally {
      this.isMutatingWorld = false;
    }
  }

  public async init(): Promise<void> {
    try {
      const module = await PhysicsEngine.ensureMuJoCoInitialized();

      const minimalMJCF = `
<mujoco model="synthia_phase1_test">
  <compiler angle="radian"/>
  <option gravity="0 0 -9.81" timestep="0.01667"/>
  <worldbody>
    <light directional="true" pos="0 0 3" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="100 100 0.1" rgba="0.8 0.9 0.8 1"/>
  </worldbody>
</mujoco>
      `.trim();

      // Write MJCF XML to Emscripten Virtual File System (FS)
      module.FS.writeFile('/model.xml', minimalMJCF);

      // Load model using mj_loadXML
      this.model = module.MjModel.mj_loadXML('/model.xml');
      if (!this.model) {
        throw new Error('Failed to load minimal MJCF XML model');
      }

      this.data = new module.MjData(this.model);

      this.initialized = true;
      this.isPhysicsBroken = false;
      Logger.info('MuJoCoPhysicsEngine: MuJoCo WASM initialized successfully');
    } catch (error) {
      Logger.error('MuJoCoPhysicsEngine: Failed to initialize MuJoCo', error);
      throw error;
    }
  }

  public step(): void {
    if (
      !this.initialized ||
      !this.isReady ||
      !this.model ||
      !this.data ||
      this.isStepping ||
      this.isMutatingWorld ||
      this.isPhysicsBroken
    ) return;

    this.isStepping = true;
    const module = PhysicsEngine.mujocoModule;
    if (!module) {
      this.isStepping = false;
      return;
    }

    try {
      module.mj_step(this.model, this.data);
      this.stepCount++;

      this.clampRegisteredBodyVelocities();

      this.drainContactForceEventsInternal();
    } catch (error) {
      Logger.error('MuJoCoPhysicsEngine: Fatal WASM memory or aliasing fault detected during step.', error);
      this.isPhysicsBroken = true;
      this.isReady = false;
    } finally {
      this.isStepping = false;
    }
  }

  public forward(): void {
    const module = PhysicsEngine.mujocoModule;
    if (!module || !this.model || !this.data) return;
    module.mj_forward(this.model, this.data);
  }

  public getStepCount(): number {
    return this.stepCount;
  }

  public registerVelocityClampBody(bodyId: number): void {
    this.velocityClampBodies.add(bodyId);
  }

  public unregisterVelocityClampBody(bodyId: number): void {
    this.velocityClampBodies.delete(bodyId);
  }

  private clampRegisteredBodyVelocities(): void {
    if (!this.model || !this.data) return;

    // Direct access to qvel using getter to re-acquire fresh views
    const currentQVel = this.qvel;

    // Clamp velocities for registered bodies
    // MuJoCo joint velocities can be retrieved/modified via qvel.
    // Each body's DOF starts at dofadr[bodyId]. For free bodies, they have 6 DOFs (3 lin, 3 ang).
    const maxLinear = 10.0; // matching MAX_LINEAR_VELOCITY in Rapier engine
    const maxAngular = 10.0; // matching MAX_ANGULAR_VELOCITY in Rapier engine

    for (const bodyId of this.velocityClampBodies) {
      const dofAdr: number = this.model.body_dofadr[bodyId];
      const dofNum: number = this.model.body_dofnum[bodyId];
      if (dofAdr === undefined || dofNum === undefined) continue;

      // If it's a 6-DOF body (free body), we clamp linear (first 3) and angular (next 3) velocities
      if (dofNum === 6) {
        const linIdx = dofAdr;
        const angIdx = dofAdr + 3;

        const lx = currentQVel[linIdx];
        const ly = currentQVel[linIdx + 1];
        const lz = currentQVel[linIdx + 2];
        const linSpeed = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (linSpeed > maxLinear) {
          const scale = maxLinear / linSpeed;
          currentQVel[linIdx] = lx * scale;
          currentQVel[linIdx + 1] = ly * scale;
          currentQVel[linIdx + 2] = lz * scale;
        }

        const ax = currentQVel[angIdx];
        const ay = currentQVel[angIdx + 1];
        const az = currentQVel[angIdx + 2];
        const angSpeed = Math.sqrt(ax * ax + ay * ay + az * az);
        if (angSpeed > maxAngular) {
          const scale = maxAngular / angSpeed;
          currentQVel[angIdx] = ax * scale;
          currentQVel[angIdx + 1] = ay * scale;
          currentQVel[angIdx + 2] = az * scale;
        }
      }
    }
  }

  public get isBroken(): boolean {
    return this.isPhysicsBroken;
  }

  public setMutating(mutating: boolean): void {
    this.isMutatingWorld = mutating;
    Logger.info(`MuJoCoPhysicsEngine: Mutation lock set to ${mutating}`);
    if (mutating) {
      this.isReady = false;
    }
  }

  public get isMutating(): boolean {
    return this.isMutatingWorld;
  }

  public setReady(ready: boolean): void {
    this.isReady = ready;
    if (ready) this.isPhysicsBroken = false;
    Logger.info(`MuJoCoPhysicsEngine: Ready state set to ${ready}`);
  }

  public setGravity(zGravity: number): void {
    if (this.model) {
      // In MuJoCo Z-up convention, gravity is the 3rd element
      this.model.opt.gravity[0] = 0;
      this.model.opt.gravity[1] = 0;
      this.model.opt.gravity[2] = zGravity;
    }
  }

  public getWorld(): { model: MjModel; data: MjData } {
    if (!this.model || !this.data) throw new Error('MuJoCoPhysicsEngine not initialized');
    return { model: this.model, data: this.data };
  }

  public getEventQueue(): null {
    // MuJoCo does not use a separate EventQueue like Rapier
    return null;
  }

  private drainContactForceEventsInternal(): void {
    if (!this.model || !this.data || this.isMutatingWorld || this.isPhysicsBroken) return;
    const module = PhysicsEngine.mujocoModule;
    if (!module) return;

    try {
      const now = Date.now();
      const ncon = this.data.ncon;
      if (ncon <= 0 || ncon > 200) return;

      // Reset contact states
      for (const [, state] of this.contactForceRegistry) {
        state.inContact = false;
      }

      // Read contacts directly from sim.data.contact using DoubleBuffer for mj_contactForce C-API call
      // Allocate a DoubleBuffer of size 6 to store the 6D contact force/torque
      const forceBuffer = new module.DoubleBuffer(6);

      try {
        for (let i = 0; i < ncon; i++) {
          let contact: MjContact | null = null;
          try {
            contact = this.data.contact.get(i) as MjContact;
          } catch {
            break;
          }
          if (!contact) continue;

          const geom1 = contact.geom1;
          const geom2 = contact.geom2;

          // Retrieve contact force using the official C-API function mj_contactForce
          module.mj_contactForce(this.model, this.data, i, forceBuffer);

          // Get force vector view from the DoubleBuffer.
          // Components [normal, tangent1, tangent2] are expressed in the contact
          // frame, whose basis is stored in contact.frame (columns = x,y,z axes
          // of the contact frame in global MuJoCo coordinates).
          const forceView = forceBuffer.GetView();
          const fNormal = forceView[0];
          const fTan1 = forceView[1];
          const fTan2 = forceView[2];
          const totalImpulse = Math.sqrt(
            fNormal * fNormal +
            fTan1 * fTan1 +
            fTan2 * fTan2
          );

          // contact.frame contains the 3x3 rotation matrix for the contact frame. The contact normal is the first column.
          const frame = contact.frame;
          const normal: [number, number, number] = [frame[0], frame[1], frame[2]];

          // Rebuild the world-frame (MuJoCo) contact force vector. This is the
          // KEY missing piece for leg-driven locomotion: the lateral/friction
          // components are what push the foot forward/backward against the
          // floor, and the old code discarded them (only storing the scalar
          // magnitude and the (mostly vertical) contact normal).
          const forceWorldMj: [number, number, number] = [
            frame[0] * fNormal + frame[3] * fTan1 + frame[6] * fTan2,
            frame[1] * fNormal + frame[4] * fTan1 + frame[7] * fTan2,
            frame[2] * fNormal + frame[5] * fTan1 + frame[8] * fTan2,
          ];

          const updateState = (geomId: number, normalDirectionMultiplier: number, forceMultiplier: number) => {
            const mappedNormal: [number, number, number] = [
              normal[0] * normalDirectionMultiplier,
              normal[1] * normalDirectionMultiplier,
              normal[2] * normalDirectionMultiplier
            ];
            const mappedForce: [number, number, number] = [
              forceWorldMj[0] * forceMultiplier,
              forceWorldMj[1] * forceMultiplier,
              forceWorldMj[2] * forceMultiplier,
            ];

            const existing = this.contactForceRegistry.get(geomId);
            if (existing) {
              existing.inContact = true;
              existing.impulse_magnitude = totalImpulse;
              existing.contact_normal = mappedNormal;
              existing.contact_force = mappedForce;
              existing.max_force_magnitude = totalImpulse;
              existing.lastUpdate = now;
            } else {
              this.contactForceRegistry.set(geomId, {
                inContact: true,
                impulse_magnitude: totalImpulse,
                contact_normal: mappedNormal,
                contact_force: mappedForce,
                max_force_magnitude: totalImpulse,
                lastUpdate: now
              });
            }
          };

          // Update states for both geoms involved in the contact.
          // mj_contactForce returns the force applied to geom1; geom2 receives -force.
          updateState(geom1, 1, 1);
          updateState(geom2, -1, -1);
        }
      } finally {
        // Free DoubleBuffer memory to avoid WASM leaks
        forceBuffer.delete();
      }
    } catch (e) {
      Logger.warn('MuJoCoPhysicsEngine: Failed to drain contact force events', e);
    }
  }

  public getContactForceRegistry(): Map<number, ColliderContactState> {
    return this.contactForceRegistry;
  }

  public drainEvents(onContact: (handle1: number, handle2: number, started: boolean) => void): void {
    if (!this.model || !this.data || this.isMutatingWorld || this.isPhysicsBroken) return;

    try {
      const ncon = this.data.ncon;
      if (ncon <= 0 || ncon > 200) return;
      for (let i = 0; i < ncon; i++) {
        const contact: MjContact = this.data.contact.get(i) as MjContact;
        if (!contact) continue;
        onContact(contact.geom1, contact.geom2, true);
      }
    } catch (e) {
      Logger.warn('MuJoCoPhysicsEngine: drainEvents failed safely', e);
    }
  }

  public flushEventQueue(): void {
    this.contactForceRegistry.clear();
  }

  public cleanup(): void {
    if (this.model) {
      this.model.delete();
      this.model = null;
    }
    if (this.data) {
      this.data.delete();
      this.data = null;
    }
    this.initialized = false;
    this.isReady = false;
    this.isPhysicsBroken = false;
    this.contactForceRegistry.clear();
    this.velocityClampBodies.clear();
  }
}
