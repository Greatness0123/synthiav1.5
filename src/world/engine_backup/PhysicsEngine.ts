/**
 * Manages the Rapier physics world, stepping, and collider registry.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { logger as Logger } from '../../utils/logger';
import { ENVIRONMENT_GROUP, RAGDOLL_GROUP, getCollisionMask } from '../../constants/physics';
import {
  MAX_ANGULAR_VELOCITY,
  MAX_LINEAR_VELOCITY,
} from '../../constants/anatomicalLimits';

export interface ContactForceData {
  collider1: number;
  collider2: number;
  impulse_magnitude: number;
  contact_normal: [number, number, number];
  max_force_magnitude: number;
  started: boolean;
  lastUpdate: number;
}

export interface ColliderContactState {
  inContact: boolean;
  impulse_magnitude: number;
  contact_normal: [number, number, number];
  max_force_magnitude: number;
  lastUpdate: number;
}

export class PhysicsEngine {
  private static rapierInitPromise: Promise<void> | null = null;
  private static rapierInitialized = false;

  private world: RAPIER.World | null = null;
  private eventQueue: RAPIER.EventQueue | null = null;
  private initialized = false;
  public isReady = false;
  public isStepping = false;
  private isMutatingWorld = false;
  private isPhysicsBroken = false;

  // Contact force registry: maps collider handle → accumulated contact state
  private contactForceRegistry: Map<number, ColliderContactState> = new Map();
  // Active collision pairs: "handle1:handle2" → { started, lastUpdate }
  private activeCollisions: Map<string, { started: boolean; lastUpdate: number }> = new Map();

  // Bodies that receive per-step velocity clamping (humanoid capsule, ragdoll parts)
  private velocityClampBodies: Set<RAPIER.RigidBody> = new Set();

  private static async ensureRapierInitialized(): Promise<void> {
    if (PhysicsEngine.rapierInitialized) return;

    if (!PhysicsEngine.rapierInitPromise) {
      PhysicsEngine.rapierInitPromise = (async () => {
        await RAPIER.init();
        PhysicsEngine.rapierInitialized = true;
      })();
    }

    try {
      await PhysicsEngine.rapierInitPromise;
    } catch (error) {
      PhysicsEngine.rapierInitPromise = null;
      throw error;
    }
  }

  public async init(): Promise<void> {
    try {
      await PhysicsEngine.ensureRapierInitialized();
      this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      this.world.numSolverIterations = 16;
      this.world.timestep = 1 / 60;

      // Create a static ground plane
      const groundRbDesc = RAPIER.RigidBodyDesc.fixed();
      const groundRb = this.world.createRigidBody(groundRbDesc);
      const groundColDesc = RAPIER.ColliderDesc.cuboid(1000, 0.1, 1000);
      groundColDesc.setTranslation(0, -0.1, 0);

      // FIX 6: Environment group collides ONLY with ragdoll group (not with other environment objects).
      // This prevents static environment objects from wasting solver iterations on self-collisions.
      const collisionMask = getCollisionMask(ENVIRONMENT_GROUP, RAGDOLL_GROUP);
      groundColDesc.setCollisionGroups(collisionMask);
      groundColDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);

      this.world.createCollider(groundColDesc, groundRb);

      this.eventQueue = new RAPIER.EventQueue(true);
      this.initialized = true;
      this.isPhysicsBroken = false;
      Logger.info('PhysicsEngine: Rapier initialized');
    } catch (error) {
      Logger.error('PhysicsEngine: Failed to initialize Rapier', error);
      throw error;
    }
  }

  public step(): void {
    if (
      !this.initialized ||
      !this.isReady ||
      !this.world ||
      !this.eventQueue ||
      this.isStepping ||
      this.isMutatingWorld || // Instantly drops frames when mutating
      this.isPhysicsBroken
    ) return;

    this.isStepping = true;
    try {
      this.world.step(this.eventQueue);

      this.clampRegisteredBodyVelocities();

      // Drain contact force events after each step
      this.drainContactForceEventsInternal();
    } catch (error) {
      Logger.error('PhysicsEngine: Fatal WASM memory or aliasing fault detected.', error);
      this.isPhysicsBroken = true;
      this.isReady = false;
    } finally {
      this.isStepping = false;
    }
  }

  public registerVelocityClampBody(body: RAPIER.RigidBody): void {
    this.velocityClampBodies.add(body);
  }

  public unregisterVelocityClampBody(body: RAPIER.RigidBody): void {
    this.velocityClampBodies.delete(body);
  }

  private clampRegisteredBodyVelocities(): void {
    for (const body of this.velocityClampBodies) {
      if (!body.isValid()) {
        this.velocityClampBodies.delete(body);
        continue;
      }

      const linvel = body.linvel();
      const speed = Math.sqrt(linvel.x ** 2 + linvel.y ** 2 + linvel.z ** 2);
      if (speed > MAX_LINEAR_VELOCITY) {
        const scale = MAX_LINEAR_VELOCITY / speed;
        body.setLinvel(
          { x: linvel.x * scale, y: linvel.y * scale, z: linvel.z * scale },
          true
        );
      }

      const angvel = body.angvel();
      const angSpeed = Math.sqrt(angvel.x ** 2 + angvel.y ** 2 + angvel.z ** 2);
      if (angSpeed > MAX_ANGULAR_VELOCITY) {
        const scale = MAX_ANGULAR_VELOCITY / angSpeed;
        body.setAngvel(
          { x: angvel.x * scale, y: angvel.y * scale, z: angvel.z * scale },
          true
        );
      }
    }
  }

  public get isBroken(): boolean {
    return this.isPhysicsBroken;
  }

  public setMutating(mutating: boolean): void {
    this.isMutatingWorld = mutating;
    Logger.info(`PhysicsEngine: Mutation lock set to ${mutating}`);
    if (mutating) {
      // Flush any pending events out of WASM space to avoid aliasing when we mutate the world
      try {
        if (this.eventQueue) {
          this.eventQueue.drainCollisionEvents(() => { });
        }
      } catch (e) {
        Logger.warn('PhysicsEngine: Failed to flush event queue during mutation safe-guard', e);
      }
      // Ensure step loop will not run while we're mutating
      this.isReady = false;
    }
  }

  public get isMutating(): boolean {
    return this.isMutatingWorld;
  }

  public setReady(ready: boolean): void {
    this.isReady = ready;
    // Allow recovery from broken state whenever physics is re-enabled
    if (ready) this.isPhysicsBroken = false;
    Logger.info(`PhysicsEngine: Ready state set to ${ready}`);
  }

  public setGravity(y: number): void {
    if (this.world) {
      this.world.gravity = { x: 0, y, z: 0 };
    }
  }

  public getWorld(): RAPIER.World {
    if (!this.world) throw new Error('PhysicsEngine not initialized');
    return this.world;
  }

  public getEventQueue(): RAPIER.EventQueue {
    if (!this.eventQueue) throw new Error('PhysicsEngine not initialized');
    return this.eventQueue;
  }

  /**
   * Drain contact force events from the event queue and update the registry.
   * Called automatically after each step().
   */
  private drainContactForceEventsInternal(): void {
    if (!this.eventQueue || this.isMutatingWorld || this.isPhysicsBroken) return;

    try {
      // Drain contact force events — these provide force magnitudes and normals
      this.eventQueue.drainContactForceEvents((event: any) => {
        const collider1 = event.collider1();
        const collider2 = event.collider2();
        const totalForceMag = event.totalForceMagnitude();
        const maxForceDir = event.maxForceDirection();
        const maxForceMag = event.maxForceMagnitude();

        const normal: [number, number, number] = [
          maxForceDir.x,
          maxForceDir.y,
          maxForceDir.z,
        ];

        const now = Date.now();

        // Update collider1 entry
        const existing1 = this.contactForceRegistry.get(collider1);
        if (existing1) {
          existing1.inContact = true;
          existing1.impulse_magnitude = totalForceMag;
          existing1.contact_normal = normal;
          existing1.max_force_magnitude = maxForceMag;
          existing1.lastUpdate = now;
        } else {
          this.contactForceRegistry.set(collider1, {
            inContact: true,
            impulse_magnitude: totalForceMag,
            contact_normal: normal,
            max_force_magnitude: maxForceMag,
            lastUpdate: now,
          });
        }

        // Update collider2 entry
        const existing2 = this.contactForceRegistry.get(collider2);
        if (existing2) {
          existing2.inContact = true;
          existing2.impulse_magnitude = totalForceMag;
          existing2.contact_normal = [normal[0] * -1, normal[1] * -1, normal[2] * -1];
          existing2.max_force_magnitude = maxForceMag;
          existing2.lastUpdate = now;
        } else {
          this.contactForceRegistry.set(collider2, {
            inContact: true,
            impulse_magnitude: totalForceMag,
            contact_normal: [normal[0] * -1, normal[1] * -1, normal[2] * -1],
            max_force_magnitude: maxForceMag,
            lastUpdate: now,
          });
        }
      });

      // Also drain collision events to track contact begin/end
      this.eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
        const key = handle1 < handle2 ? `${handle1}:${handle2}` : `${handle2}:${handle1}`;
        const now = Date.now();

        if (started) {
          this.activeCollisions.set(key, { started: true, lastUpdate: now });
        } else {
          this.activeCollisions.delete(key);
          // Mark colliders as no longer in contact if they have no other active collisions
          if (!this.hasAnyActiveCollision(handle1)) {
            const state1 = this.contactForceRegistry.get(handle1);
            if (state1) state1.inContact = false;
          }
          if (!this.hasAnyActiveCollision(handle2)) {
            const state2 = this.contactForceRegistry.get(handle2);
            if (state2) state2.inContact = false;
          }
        }
      });
    } catch (e) {
      // Silently ignore — contact force draining is best-effort
    }
  }

  private hasAnyActiveCollision(handle: number): boolean {
    for (const [key] of this.activeCollisions) {
      const [a, b] = key.split(':').map(Number);
      if (a === handle || b === handle) return true;
    }
    return false;
  }

  /**
   * Get the contact force registry. Maps collider handle → contact state.
   * Updated every physics step.
   */
  public getContactForceRegistry(): Map<number, ColliderContactState> {
    return this.contactForceRegistry;
  }

  /**
   * Get the collider handle for a given collider.
   * Returns the raw handle number used in the registry.
   */
  public getColliderHandle(collider: RAPIER.Collider): number {
    return collider.handle;
  }

  public drainEvents(onContact: (handle1: number, handle2: number, started: boolean) => void): void {
    if (this.eventQueue && !this.isMutatingWorld && !this.isPhysicsBroken) {
      try {
        this.eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
          onContact(handle1, handle2, started);
        });
      } catch (e) {
        Logger.warn('PhysicsEngine: drainEvents failed safely caught', e);
      }
    }
  }

  /**
   * Forcefully clear any pending events. Safe to call while preparing mutations.
   */
  public flushEventQueue(): void {
    try {
      if (this.eventQueue) this.eventQueue.drainCollisionEvents(() => { });
      if (this.eventQueue) this.eventQueue.drainContactForceEvents(() => { });
      this.contactForceRegistry.clear();
      this.activeCollisions.clear();
    } catch (e) {
      Logger.warn('PhysicsEngine: flushEventQueue failed safely caught', e);
    }
  }

  public cleanup(): void {
    this.world?.free();
    this.eventQueue?.free();
    this.world = null;
    this.eventQueue = null;
    this.initialized = false;
    this.isReady = false;
    this.isPhysicsBroken = false;
  }
}
