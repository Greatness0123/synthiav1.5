/**
 * React hook to initialize and manage the World Engine.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { WorldEngine } from "../engine/WorldEngine";
import { PhysicsEngine } from "../engine/PhysicsEngine";
import { MuJoCoPhysicsEngine } from "../engine/MuJoCoPhysicsEngine";
import { AudioEngine } from "../engine/AudioEngine";
import { ObjectManager } from "../engine/ObjectManager";
import { MuJoCoObjectManager } from "../engine/MuJoCoObjectManager";
import { RagdollBuilder } from "../engine/RagdollBuilder";
import { HumanoidPhysicsBinder } from "../engine/HumanoidPhysicsBinder";
import { HumanoidPhysicsBinderMuJoCo } from "../engine/HumanoidPhysicsBinderMuJoCo";
import { ProceduralHumanoidBuilder, ProceduralBuildResult } from "../engine/ProceduralHumanoidBuilder";
import { ProceduralMotorController } from "../engine/ProceduralMotorController";
import { ObservationBuilder } from "../engine/ObservationBuilder";
import { BODY_TYPE_CONFIGS } from "../../constants/bodyTypes";
import { useWorldStore } from "../../store/worldStore";
import { useAgentStore } from "../../store/agentStore";
import { useConnectionStore } from "../../store/connectionStore";
import { useCoordinator } from "./useCoordinator";
import { useUIStore } from "../../store/uiStore";
import { synthiaToast } from "../../components/ui/Toast";
import { debouncedToast } from "../../utils/toastUtils";
import { STRINGS } from "../../constants/strings";
import { logger as Logger } from "../../utils/logger";
import * as THREE from "three";

export const useWorld = (containerRef: React.RefObject<HTMLDivElement>) => {
  const [isReady, setIsReady] = useState(false);
  const { sendMessage } = useCoordinator();
  const worldEngineRef = useRef<WorldEngine | null>(null);
  const physicsEngineRef = useRef<PhysicsEngine | null>(null);
  const mujocoEngineRef = useRef<MuJoCoPhysicsEngine | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const objectManagerRef = useRef<ObjectManager | null>(null);
  const mujocoObjectManagerRef = useRef<MuJoCoObjectManager | null>(null);
  const ragdollBuilderRef = useRef<RagdollBuilder | null>(null);
  const humanoidPhysicsBinderRef = useRef<HumanoidPhysicsBinder | null>(null);
  const proceduralBuilderRef = useRef<ProceduralHumanoidBuilder | null>(null);
  const proceduralMotorRef = useRef<ProceduralMotorController | null>(null);
  const proceduralBuildResultRef = useRef<ProceduralBuildResult | null>(null);
  const proceduralObsBuilderRef = useRef<ObservationBuilder | null>(null);

  const worldStore = useWorldStore();
  const agentStore = useAgentStore();
  const pendingOutcomesRef = useRef<any[]>([]);
  const lastJointStateRef = useRef<Record<string, any>>({});
  const boundaryViolationCountRef = useRef(0);
  const BOUNDARY_RESET_FRAMES = 5;

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const init = async () => {
      try {
        const useMuJoCo = useWorldStore.getState().useMuJoCo;

        let physicsEngine: any;
        if (useMuJoCo) {
          Logger.info("useWorld: Initializing MuJoCo physics...");
          physicsEngine = new MuJoCoPhysicsEngine();
          mujocoEngineRef.current = physicsEngine;
        } else {
          Logger.info("useWorld: Initializing Rapier physics...");
          physicsEngine = new PhysicsEngine();
        }
        physicsEngineRef.current = physicsEngine;
        await physicsEngine.init();
        if (cancelled) {
          physicsEngine.cleanup();
          return;
        }

        Logger.info("useWorld: Initializing audio...");
        const audioEngine = new AudioEngine();
        audioEngineRef.current = audioEngine;
        audioEngine
          .init()
          .catch((err) => Logger.error("Audio init failed", err));

        (window as any)._synthia_audio_engine = audioEngine;
        (window as any)._synthia_connection_store_metrics =
          useConnectionStore.getState().setMetrics;

        Logger.info("useWorld: Initializing world engine...");
        const worldEngine = new WorldEngine(
          containerRef.current!,
          physicsEngine,
        );
        worldEngineRef.current = worldEngine;

        let objectManager: any;
        if (useMuJoCo) {
          objectManager = new MuJoCoObjectManager(
            physicsEngine,
            worldEngine.getScene(),
            audioEngine
          );
          mujocoObjectManagerRef.current = objectManager;
        } else {
          objectManager = new ObjectManager(
            physicsEngine.getWorld(),
            worldEngine.getScene(),
            audioEngine,
          );
          objectManagerRef.current = objectManager;
        }

        if (cancelled) {
          physicsEngine.cleanup();
          return;
        }

        objectManager.setEventCallback((type: string, data: any) => {
          if (type === "piano_note") {
            pendingOutcomesRef.current.push({
              type: "outcome",
              data: {
                success: true,
                reward: 1.0,
                description: `Played piano note: ${data.note}`,
              },
            });
          } else if (type === "button_press") {
            pendingOutcomesRef.current.push({
              type: "outcome",
              data: {
                success: true,
                reward: 0.5,
                description: `Pressed button: ${data.id}`,
              },
            });
          }
        });

        const cam = worldEngine.getCameraManager();
        cam.onDragChanged = (dragging, object) => {
          const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
          if (!activeObjManager) return;

          if (!object) {
            activeObjManager.setDraggingObject(null);
            return;
          }
          let target: THREE.Object3D | null = object;
          while (target && !target.userData.objectId && target.parent) {
            target = target.parent;
          }
          activeObjManager.setDraggingObject(
            dragging && target?.userData.objectId ? target.userData.objectId : null
          );
        };
        cam.onDragEnd = (object) => {
          const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
          if (!activeObjManager) return;

          let target: THREE.Object3D | null = object;
          while (target && !target.userData.objectId && target.parent) {
            target = target.parent;
          }
          if (target?.userData.objectId) {
            activeObjManager.setObjectPosition(
              target.userData.objectId,
              target.position,
              target.quaternion
            );
          } else if (object === humanoidPhysicsBinderRef.current?.getModelRoot()) {
            humanoidPhysicsBinderRef.current?.setCapsulePosition(
              object.position.x,
              object.position.y,
              object.position.z
            );
          }
        };

        const ragdollBuilder = new RagdollBuilder(
          physicsEngine,
          worldEngine.getScene(),
        );
        ragdollBuilderRef.current = ragdollBuilder;

        let humanoidPhysicsBinder: any;
        if (useMuJoCo) {
          humanoidPhysicsBinder = new HumanoidPhysicsBinderMuJoCo(
            physicsEngine,
            worldEngine.getScene()
          );
        } else {
          humanoidPhysicsBinder = new HumanoidPhysicsBinder(
            physicsEngine,
            worldEngine.getScene()
          );
        }
        humanoidPhysicsBinderRef.current = humanoidPhysicsBinder;

        // Expose humanoid binder to window for step-by-step testing
        (window as any).__SYNTHIA_HUMANOID_BINDER__ = humanoidPhysicsBinder;
        (window as any).__SYNTHIA_PHYSICS_ENGINE__ = physicsEngine;

        // Print step progression guide to console
        Logger.info(`
╔════════════════════════════════════════════════════════════════════════════╗
║  HUMANOID PHYSICS BINDER - STEP-BY-STEP DEBUG INTERFACE                   ║
╠════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  STEP A (Current): Bones loaded with debug spheres - NO PHYSICS YET      ║
║                                                                            ║
║  To progress through steps, use console:                                  ║
║                                                                            ║
║    await __SYNTHIA_HUMANOID_BINDER__.nextStep()                           ║
║      → A→B: Creates rigid bodies + colliders (no joints)                  ║
║      → B→C: Adds spherical joints with ZERO motors (floppy ragdoll)       ║
║      → C→D: Activates motors with LOW stiffness (20/5)                    ║
║                                                                            ║
║  Once in STEP D, tune stiffness/damping incrementally:                    ║
║                                                                            ║
║    await __SYNTHIA_HUMANOID_BINDER__.adjustMotors(stiffness, damping)     ║
║      Try: 20/5 → 50/8 → 100/10 → 150/12                                   ║
║                                                                            ║
║  View diagnostics:                                                         ║
║                                                                            ║
║    __SYNTHIA_HUMANOID_BINDER__.getDiagnostics()                           ║
║                                                                            ║
║  Get motor settings:                                                       ║
║                                                                            ║
║    __SYNTHIA_HUMANOID_BINDER__.getMotorSettings()                         ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
        `);

        Logger.info("useWorld: Starting animation loop...");
        worldEngineRef.current.start(() => {
          const physics = physicsEngineRef.current;
          const ragdoll = ragdollBuilderRef.current;
          const humanoidBinder = humanoidPhysicsBinderRef.current;

          // ABORT IMMEDIATELY IF RAGDOLL IS BUILDING/REBUILDING
          if (!physics || physics.isStepping || physics.isMutating) {
            return;
          }

          const useMuJoCo = useWorldStore.getState().useMuJoCo;
          if (useMuJoCo) {
            try {
              mujocoObjectManagerRef.current?.update();
              mujocoObjectManagerRef.current?.syncVisuals();
            } catch (error) {
              Logger.warn("MuJoCoObjectManager update error caught safely", error);
            }
          } else {
            const eq = physics.getEventQueue();
            if (eq) {
              try {
                objectManagerRef.current?.update(eq);
                objectManagerRef.current?.syncVisuals();
              } catch (error) {
                Logger.warn("ObjectManager update error caught safely", error);
              }
            }
          }

          if (worldStore.bodyType === 'humanoid' && humanoidBinder) {
            try {
              humanoidBinder.updateMotorTargets();
              humanoidBinder.syncVisuals();
              humanoidBinder.renderAICameraHelper(
                useWorldStore.getState().showAICameraHelper,
                worldEngineRef.current?.getCameraManager().getCameraData()
              );
              const state = humanoidBinder.getJointState();
              lastJointStateRef.current = state;

              const headTransform = humanoidBinder.getHeadTransform();
              if (headTransform) {
                const headMatrix = new THREE.Matrix4().compose(
                  headTransform.position,
                  headTransform.quaternion,
                  new THREE.Vector3(1, 1, 1)
                );

                // Get capsule position/quat for stable chase cam tracking
                let capsuleQuat: THREE.Quaternion | undefined;
                let capsulePos: THREE.Vector3 | undefined;
                const capsuleBody = humanoidBinder.getCapsuleBody();
                if (capsuleBody?.isValid()) {
                  const t = capsuleBody.translation();
                  const r = capsuleBody.rotation();
                  capsulePos = new THREE.Vector3(t.x, t.y, t.z);
                  capsuleQuat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
                }

                worldEngineRef.current?.getCameraManager().update(headMatrix, headTransform.position, capsuleQuat, capsulePos);
              }

              if (humanoidBinder.isOutOfWorldBounds()) {
                boundaryViolationCountRef.current += 1;
                if (boundaryViolationCountRef.current >= BOUNDARY_RESET_FRAMES) {
                  Logger.warn('useWorld: humanoid exceeded world boundary — auto reset');
                  humanoidBinder.resetPose(useWorldStore.getState().spawnPoint);
                  boundaryViolationCountRef.current = 0;
                }
              } else {
                boundaryViolationCountRef.current = 0;
              }
            } catch (error) {
              Logger.warn('HumanoidPhysicsBinder sync failed:', error);
            }
          }

          // ── Procedural Model Sync ──────────────────────────────────
          if (worldStore.useProcedural && proceduralBuildResultRef.current && proceduralBuilderRef.current) {
            try {
              proceduralBuilderRef.current.syncVisuals(proceduralBuildResultRef.current.parts);
              const pelvisPart = proceduralBuildResultRef.current.parts.get('pelvis');
              if (pelvisPart?.body.isValid()) {
                const pp = pelvisPart.body.translation();
                worldEngineRef.current?.getCameraManager().update(undefined, new THREE.Vector3(pp.x, pp.y, pp.z));
              }
            } catch (error) {
              Logger.warn('Procedural model sync failed:', error);
            }
          } else if (ragdoll) {
            try {
              ragdoll.syncVisuals();
              const state = ragdoll.getJointState();
              lastJointStateRef.current = state;

              const pelvis = state.pelvis;
              if (pelvis) {
                const pos = new THREE.Vector3(pelvis.position[0], pelvis.position[1], pelvis.position[2]);
                worldEngineRef.current?.getCameraManager().update(undefined, pos);
              }
            } catch (error) {
              Logger.warn('Ragdoll state pipeline execution deferred safely:', error);
            }
          }
        });

        setIsReady(true);
        // Mark rehydration/loading as complete so the startup modal will close.
        agentStore.setHasRehydrated(true);
        Logger.info('useWorld: Initialization complete.');
      } catch (error) {
        Logger.error("useWorld: Initialization failed", error);
        debouncedToast("physics-init-fail", () => {
          synthiaToast.error(STRINGS.TOASTS.RAPIER_LOAD_FAIL);
        });
      }
    };

    init();

    return () => {
      cancelled = true;
      worldEngineRef.current?.stop();
      if (proceduralBuildResultRef.current && proceduralBuilderRef.current) {
        proceduralBuilderRef.current.cleanup(
          proceduralBuildResultRef.current.parts,
          proceduralBuildResultRef.current.rootGroup
        );
      }
      physicsEngineRef.current?.cleanup();
      mujocoEngineRef.current?.cleanup();
    };
  }, [containerRef]);

  useEffect(() => {
    if (physicsEngineRef.current) {
      physicsEngineRef.current.setGravity(worldStore.gravity);
    }
  }, [worldStore.gravity]);

  useEffect(() => {
    if (humanoidPhysicsBinderRef.current) {
      humanoidPhysicsBinderRef.current.friction = worldStore.globalFriction;
    }
    // Also update friction on all spawned objects
    if (worldStore.useMuJoCo) {
      if (mujocoObjectManagerRef.current) {
        mujocoObjectManagerRef.current.setGlobalFriction(worldStore.globalFriction);
      }
    } else {
      if (objectManagerRef.current) {
        objectManagerRef.current.setGlobalFriction(worldStore.globalFriction);
      }
    }
  }, [worldStore.globalFriction, worldStore.useMuJoCo]);

  useEffect(() => {
    if (humanoidPhysicsBinderRef.current) {
      humanoidPhysicsBinderRef.current.setLerpSpeed(worldStore.movementSmoothing);
    }
  }, [worldStore.movementSmoothing]);

  useEffect(() => {
    if (humanoidPhysicsBinderRef.current) {
      humanoidPhysicsBinderRef.current.renderDebugSpheres(worldStore.showDebugJoints);
    }
  }, [worldStore.showDebugJoints]);

  useEffect(() => {
    // When toggling to ragdoll, switch to procedural model so AI can control it.
    // When toggling to rigid, switch back to GLB model.
    if (worldStore.bodyType === 'humanoid') {
      const shouldUseProcedural = worldStore.bodyMode === 'ragdoll';
      if (worldStore.useProcedural !== shouldUseProcedural) {
        worldStore.setUseProcedural(shouldUseProcedural);
        return; // Rebuild effect will handle the rest
      }
      if (humanoidPhysicsBinderRef.current) {
        humanoidPhysicsBinderRef.current.setMode(worldStore.bodyMode);
      }
    } else if (ragdollBuilderRef.current) {
      ragdollBuilderRef.current.setMode(worldStore.bodyMode);
    }
  }, [worldStore.bodyMode, worldStore.bodyType]);

  // Handle floor, grid, and sky state
  useEffect(() => {
    if (worldEngineRef.current) {
      worldEngineRef.current.updateFloor(worldStore.showFloor, worldStore.floorColor);
      worldEngineRef.current.updateGrid(worldStore.showGrid);
      worldEngineRef.current.updateSkyColor(worldStore.skyColor);
    }
  }, [worldStore.showFloor, worldStore.floorColor, worldStore.showGrid, worldStore.skyColor]);

  // Handle object renaming, physics update, and deletion
  useEffect(() => {
    const handleRename = (e: any) => {
      const { id, name } = e.detail;
      const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
      activeObjManager?.renameObject(id, name);
    };

    const handleUpdatePhysics = (e: any) => {
      const { id, updates } = e.detail;
      const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
      activeObjManager?.updateObjectPhysics(id, updates);
    };

    const handleDeleteObject = (e: any) => {
      const { id } = e.detail;
      const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
      // Detach TransformControls before removing the object to prevent
      // "not part of scene graph" errors from the gizmo tracking a removed object.
      worldEngineRef.current?.getCameraManager().attachTransform(null);
      activeObjManager?.deleteObject(id);
      if (useUIStore.getState().selectedEntityId === id) {
        useUIStore.getState().setSelectedEntityId(null);
      }
    };

    window.addEventListener('synthia:rename', handleRename);
    window.addEventListener('synthia:updatePhysics', handleUpdatePhysics);
    window.addEventListener('synthia:deleteObject', handleDeleteObject);
    return () => {
      window.removeEventListener('synthia:rename', handleRename);
      window.removeEventListener('synthia:updatePhysics', handleUpdatePhysics);
      window.removeEventListener('synthia:deleteObject', handleDeleteObject);
    };
  }, []);

  // Bug 4 Fix: Subscribe to camera mode and relay to CameraManager
  useEffect(() => {
    worldEngineRef.current?.getCameraManager().setMode(worldStore.cameraMode);
  }, [worldStore.cameraMode]);


  const findSpawnPosition = useCallback((skipHumanoidCheck = false): THREE.Vector3 => {
    let humanoidPos = new THREE.Vector3(0, 0, 5);
    const binder = humanoidPhysicsBinderRef.current;
    if (binder) {
      const headTransform = binder.getHeadTransform();
      if (headTransform) {
        humanoidPos.set(headTransform.position.x, 0, headTransform.position.z);
      }
    }

    const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
    const spawnRadius = 2.2;
    let spawnPos = new THREE.Vector3();
    let placed = false;

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = (attempt / 8) * Math.PI * 2;
      const candidateX = humanoidPos.x + Math.sin(angle) * spawnRadius;
      const candidateZ = humanoidPos.z + Math.cos(angle) * spawnRadius;
      const candidateY = 0.6;

      let overlaps = false;
      activeObjManager?.getObjects().forEach((obj) => {
        if (overlaps) return;
        const dx = Math.abs(obj.mesh.position.x - candidateX);
        const dz = Math.abs(obj.mesh.position.z - candidateZ);
        if (dx < 1.2 && dz < 1.2) overlaps = true;
      });
      if (!skipHumanoidCheck) {
        const dhx = Math.abs(humanoidPos.x - candidateX);
        const dhz = Math.abs(humanoidPos.z - candidateZ);
        if (dhx < 0.8 && dhz < 0.8) overlaps = true;
      }

      if (!overlaps) {
        spawnPos.set(candidateX, candidateY, candidateZ);
        placed = true;
        break;
      }
    }

    if (!placed) {
      spawnPos.set(humanoidPos.x + 4, 0.6, humanoidPos.z);
    }
    return spawnPos;
  }, []);

  // Bug 3 Fix: Listen for object spawn events dispatched by ObjectSpawner UI
  useEffect(() => {
    const handleSpawnEvent = (e: Event) => {
      const { presetId } = (e as CustomEvent).detail;
      const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
      if (!activeObjManager) {
        Logger.warn('useWorld: spawnObject called but activeObjManager not ready');
        return;
      }

      const spawnPos = findSpawnPosition();
      const obj = activeObjManager.spawnObject(presetId, spawnPos);
      if (obj) {
        Logger.info(`useWorld: Object '${presetId}' spawned successfully (id=${obj.id}). Total objects: ${activeObjManager.getObjects().size}`);
      } else {
        Logger.error(`useWorld: spawnObject returned null for presetId='${presetId}'`);
      }
    };

    window.addEventListener('synthia:spawn', handleSpawnEvent);
    return () => window.removeEventListener('synthia:spawn', handleSpawnEvent);
  }, [findSpawnPosition]);

  useEffect(() => {
    const handleSpawnCustom = (e: Event) => {
      const { name, scene, isTerrain } = (e as CustomEvent).detail as {
        name: string;
        scene: THREE.Group;
        isTerrain: boolean;
      };
      const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
      if (!activeObjManager) return;

      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const spawnPos = findSpawnPosition(isTerrain);
      if (isTerrain) {
        spawnPos.y = -box.min.y;
      } else {
        spawnPos.y = Math.max(0.1, size.y / 2 + 0.01);
      }

      const obj = activeObjManager.spawnCustomModel(scene, name, spawnPos, { isTerrain });
      if (obj) {
        Logger.info(`useWorld: Custom model '${name}' spawned (id=${obj.id})`);
      }
    };

    window.addEventListener('synthia:spawnCustom', handleSpawnCustom);
    return () => window.removeEventListener('synthia:spawnCustom', handleSpawnCustom);
  }, [findSpawnPosition]);

  useEffect(() => {
    if (useWorldStore.getState().useMuJoCo) return;
    const handlePush = (e: any) => {
      const { partName, impulse } = e.detail;
      if (worldStore.bodyType === 'humanoid' && humanoidPhysicsBinderRef.current) {
        humanoidPhysicsBinderRef.current.push(partName, new THREE.Vector3(impulse.x, impulse.y, impulse.z));
      } else if (ragdollBuilderRef.current) {
        ragdollBuilderRef.current.push(partName, new THREE.Vector3(impulse.x, impulse.y, impulse.z));
      }
    };

    window.addEventListener('synthia:push', handlePush);
    return () => window.removeEventListener('synthia:push', handlePush);
  }, [worldStore.bodyType]);

  useEffect(() => {
    if (useWorldStore.getState().useMuJoCo) return;
    const handleAction = (e: any) => {
      // Fix 5: Clear any pending timeline so the new action isn't overwritten
      // by stale interpolated values from the previous timeline.
      const binder = humanoidPhysicsBinderRef.current as any;
      if (binder) {
        binder['timelineQueue'] = [];
        binder['timelineSequenceStart'] = null;
      }

      const { jointOverrides, programSequence, sequence, activeGaitPhase } = e.detail;
      Logger.info(`[ACTION_PIPELINE] useWorld handling action: jointOverrides=${Object.keys(jointOverrides || {}).length} keys, sequence=${Array.isArray(sequence) ? sequence.length : 0}, programSequence=${JSON.stringify(programSequence || [])}`);

      if (worldStore.useProcedural && proceduralMotorRef.current) {
        try {
          const targets = new Map<string, any>();
          if (jointOverrides && typeof jointOverrides === 'object') {
            for (const [key, value] of Object.entries(jointOverrides)) {
              targets.set(key, value);
            }
          }
          proceduralMotorRef.current.setTargets(targets);
        } catch (err) {
          Logger.warn('Procedural motor action failed', err);
        }
      } else if (worldStore.bodyType === 'humanoid' && humanoidPhysicsBinderRef.current) {
        try {
          const skeleton = binder['skeleton'];

          if (Array.isArray(sequence) && sequence.length > 0) {
            // Use full timeline provided by coordinator
            const validation = binder.validateAndApplyTimeline(skeleton, sequence, { activeGaitPhase: !!activeGaitPhase });

            // Apply immediate frames (timeOffsetMs === 0)
            for (const f of validation.appliedTimeline) {
              if (f.timeOffsetMs === 0) {
                binder.setMotorTargets(f.overrides as any);
              }
            }

            if (validation.rejections.length > 0 || validation.clampingNotes.length > 0 || validation.injections.length > 0) {
              sendMessage('action_feedback', {
                agentId: 'agent_a',
                rejections: validation.rejections,
                clamping: validation.clampingNotes,
                injections: validation.injections,
              });
            }
          } else {
            // Fallback: single-frame jointOverrides
            const seq = [{ timeOffsetMs: 0, overrides: jointOverrides || {} }];
            const validation = binder.validateAndApplyTimeline(skeleton, seq, { activeGaitPhase: false });
            for (const f of validation.appliedTimeline) {
              if (f.timeOffsetMs === 0) binder.setMotorTargets(f.overrides as any);
            }
            if (validation.rejections.length > 0 || validation.clampingNotes.length > 0 || validation.injections.length > 0) {
              sendMessage('action_feedback', {
                agentId: 'agent_a',
                rejections: validation.rejections,
                clamping: validation.clampingNotes,
                injections: validation.injections,
              });
            }
          }

          if (programSequence && Array.isArray(programSequence) && programSequence.length > 0) {
            humanoidPhysicsBinderRef.current.executeProgramSequence(programSequence);
          }
        } catch (err) {
          // Fix 6: Send error feedback to coordinator so the AI knows its action failed
          Logger.warn('Action validation failed', err);
          sendMessage('action_feedback', {
            agentId: 'agent_a',
            rejections: [{ joint: 'internal', reason: String(err), requested: null }],
            clamping: [],
            injections: []
          });
        }
      }
    };

    window.addEventListener('synthia:action', handleAction);
    return () => window.removeEventListener('synthia:action', handleAction);
  }, [worldStore.bodyType, worldStore.useProcedural, sendMessage]);

  // ── Reset Pose Event Handler ─────────────────────────────────────────
  // Dispatched by BodyControls.tsx "RESET POSE" button and console scripts.
  useEffect(() => {
    if (useWorldStore.getState().useMuJoCo) return;
    const handleResetPose = () => {
      const binder = humanoidPhysicsBinderRef.current;
      if (binder) {
        binder.resetPose(worldStore.spawnPoint);
      } else if (ragdollBuilderRef.current) {
        ragdollBuilderRef.current.resetToSpawn(worldStore.spawnPoint);
      }
    };
    window.addEventListener('synthia:resetPose', handleResetPose);
    return () => window.removeEventListener('synthia:resetPose', handleResetPose);
  }, [worldStore.spawnPoint]);

  // ── Root Motion Event Handler ────────────────────────────────────────
  // Accepts { dx, dz } in meters and applies as capsule translation delta.
  // Used by console animation scripts to move the character forward.
  useEffect(() => {
    if (useWorldStore.getState().useMuJoCo) return;
    const handleRootMotion = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const { dx = 0, dz = 0 } = detail;
      if (worldStore.bodyType !== 'humanoid' || !humanoidPhysicsBinderRef.current) return;
      const capsuleBody = humanoidPhysicsBinderRef.current.getCapsuleBody();
      if (!capsuleBody || !capsuleBody.isValid()) return;
      const t = capsuleBody.translation();
      capsuleBody.setTranslation({ x: t.x + dx, y: t.y, z: t.z + dz }, true);
    };
    window.addEventListener('synthia:rootMotion', handleRootMotion);
    return () => { window.removeEventListener('synthia:rootMotion', handleRootMotion); };
  }, [worldStore.bodyType]);

  useEffect(() => {
    if (!isReady) return;
    if (useWorldStore.getState().useMuJoCo) return;

    const build = async () => {
      // Detach TransformControls before any cleanup to prevent
      // "not part of scene graph" errors from the gizmo tracking a removed object.
      worldEngineRef.current?.getCameraManager().attachTransform(null);

      // Clean up previous procedural model if switching modes
      if (proceduralBuildResultRef.current) {
        proceduralBuilderRef.current?.cleanup(
          proceduralBuildResultRef.current.parts,
          proceduralBuildResultRef.current.rootGroup
        );
        proceduralBuildResultRef.current = null;
        proceduralMotorRef.current = null;
        proceduralObsBuilderRef.current = null;
      }

      if (worldStore.bodyType === 'humanoid' && humanoidPhysicsBinderRef.current) {
        ragdollBuilderRef.current?.cleanup();

        if (worldStore.useProcedural) {
          // ── Procedural Model Path ──────────────────────────────────
          Logger.info('useWorld: Building procedural humanoid model');
          const builder = new ProceduralHumanoidBuilder(
            worldEngineRef.current!.getScene(),
            physicsEngineRef.current!
          );
          proceduralBuilderRef.current = builder;

          const spawnPoint = new THREE.Vector3(
            worldStore.spawnPoint.x,
            worldStore.spawnPoint.y,
            worldStore.spawnPoint.z
          );
          const result = builder.build(spawnPoint);
          proceduralBuildResultRef.current = result;

          const motorController = new ProceduralMotorController();
          motorController.init(result);
          proceduralMotorRef.current = motorController;

          // Initialize ObservationBuilder for procedural model
          const obsBuilder = new ObservationBuilder();
          const pelvisBody = result.rigidBodiesMap.get('pelvis');
          if (pelvisBody) obsBuilder.registerJoint('pelvis', pelvisBody, null);
          for (const [name, body] of result.rigidBodiesMap) {
            if (name === 'pelvis') continue;
            obsBuilder.registerJoint(name, body, pelvisBody ?? null);
          }
          obsBuilder.setGroundHeight(0);
          proceduralObsBuilderRef.current = obsBuilder;

          // If ragdoll mode is active, start the procedural model in limp mode
          if (worldStore.bodyMode === 'ragdoll') {
            proceduralMotorRef.current?.setLimpMode(true);
          }

          Logger.info('useWorld: Procedural humanoid built');
        } else {
          // ── GLB Model Path (original) ──────────────────────────────
          const binder = humanoidPhysicsBinderRef.current;

          // STEP A: Load model at x=0, z=0, y=0 initially to read bind pose bone positions
          const probePoint = new THREE.Vector3(0, 0, 0);
          const stepA = await binder.loadAndVisualizeBindPose(probePoint);
          if (!stepA) { Logger.error('useWorld: STEP A failed'); return; }

          // Reposition the model root. Since model root is at the feet, we use spawnPoint directly.
          binder.repositionModel(
            worldStore.spawnPoint.x,
            worldStore.spawnPoint.y,
            worldStore.spawnPoint.z
          );

          binder.renderDebugSpheres(worldStore.showDebugJoints);

          // STEP B: Create single capsule rigid body
          const stepB = await binder.createRigidBodiesAndColliders();
          if (!stepB) { Logger.error('useWorld: STEP B failed'); return; }
          Logger.info('useWorld: STEP B complete — single capsule created');

          // STEP C & D: No-ops for single capsule, but we call them for API compat
          await binder.createJointsWithZeroMotors();
          await binder.activateMotorsWithStiffnessAndDamping(80, 10);
          Logger.info('useWorld: STEP D complete — model is standing');

          // Activate multi-body PD motor control if enabled
          if (worldStore.useMultiBodyPD) {
            const mbSuccess = await binder.activateMultiBody();
            if (mbSuccess) {
              Logger.info('useWorld: Multi-body PD motor control activated');
            } else {
              Logger.warn('useWorld: Multi-body activation failed, using single capsule');
            }
          }

          binder.setMode(worldStore.bodyMode);
        }
      } else if (ragdollBuilderRef.current) {
        humanoidPhysicsBinderRef.current?.cleanup();
        const config = BODY_TYPE_CONFIGS[worldStore.bodyType];
        if (config) {
          const spawnPoint = new THREE.Vector3(
            worldStore.spawnPoint.x,
            worldStore.spawnPoint.y,
            worldStore.spawnPoint.z
          );
          await ragdollBuilderRef.current.build(
            config,
            spawnPoint,
            worldStore.simplifiedSkeleton,
          );
        }
      }
    };

    build();
  }, [
    isReady,
    worldStore.bodyType,
    worldStore.simplifiedSkeleton,
    worldStore.spawnPoint,
    worldStore.useProcedural,
    worldStore.useMultiBodyPD,
  ]);

  useEffect(() => {
    if (!isReady || !worldEngineRef.current) return;

    const interval = setInterval(() => {
      const nextState = worldStore.lightState === "day" ? "night" : "day";
      worldStore.setLightState(nextState);
    }, worldStore.dayNightCycleMs);

    return () => clearInterval(interval);
  }, [isReady, worldStore.dayNightCycleMs, worldStore.lightState]);

  useEffect(() => {
    if (!worldEngineRef.current) return;

    const startTime = Date.now();
    const duration = 30000;

    const update = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      worldEngineRef.current?.updateLighting(worldStore.lightState, progress);

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };

    update();
  }, [worldStore.lightState]);

  // Escape to deselect + Delete to remove selected object
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        useUIStore.getState().setSelectedEntityId(null);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedId = useUIStore.getState().selectedEntityId;
        if (selectedId) {
          window.dispatchEvent(new CustomEvent('synthia:deleteObject', { detail: { id: selectedId } }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const captureWorldState = useCallback(async () => {
    if (
      !worldEngineRef.current ||
      (!ragdollBuilderRef.current && !humanoidPhysicsBinderRef.current) ||
      !audioEngineRef.current
    )
      return null;

    const renderer = worldEngineRef.current.getRenderer();
    const scene = worldEngineRef.current.getScene();
    const camera = worldEngineRef.current.getCamera();

    // Render main view for user (unchanged)
    renderer.render(scene, camera);

    // Get AI frame from dedicated 448×448 offscreen capture (raw base64, no prefix)
    const rawFrame = worldEngineRef.current.getLastAIFrame();

    if (!rawFrame || rawFrame === '') {
      Logger.warn('captureWorldState: frame not yet available, skipping cycle');
      return null;
    }

    const frame = rawFrame;

    // Estimate file size: base64 is ~75% of decoded bytes, divide by 1024 for KB
    const fileSize = (frame.length * 0.75) / 1024;

    (window as any)._synthia_connection_store_metrics?.({
      frameSize: fileSize,
    });

    const joints = lastJointStateRef.current;

    // Build local-frame observation for AI proprioception
    let proprioception: any = null;
    if (worldStore.useProcedural && proceduralObsBuilderRef.current) {
      const pelvisBody = proceduralBuildResultRef.current?.rigidBodiesMap.get('pelvis');
      if (pelvisBody?.isValid()) {
        proprioception = proceduralObsBuilderRef.current.buildVLMProprioception(pelvisBody);
      }
    } else if (humanoidPhysicsBinderRef.current?.mbActive) {
      const obsBuilder = humanoidPhysicsBinderRef.current.getObservationBuilder();
      const capsuleBody = humanoidPhysicsBinderRef.current.getCapsuleBody();
      if (capsuleBody?.isValid()) {
        proprioception = obsBuilder.buildVLMProprioception(capsuleBody);
      }
    }

    const audioBuffer = await audioEngineRef.current.getBuffer();
    const audioPcm = audioBuffer ? btoa(String.fromCharCode(...new Uint8Array(audioBuffer.buffer))) : "";

    // Gather contact forces from the active humanoid/ragdoll
    let contact_forces: Record<string, any> = {};
    if (useWorldStore.getState().bodyType === 'humanoid' && humanoidPhysicsBinderRef.current) {
      contact_forces = humanoidPhysicsBinderRef.current.getContactForces();
    }

    const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
    const objects = activeObjManager
      ? Array.from(activeObjManager.getObjects().values()).map((obj: any) => ({
          id: obj.id,
          type: obj.type,
          name: obj.name || obj.type,
          position: {
            x: obj.mesh?.position.x ?? 0,
            y: obj.mesh?.position.y ?? 0,
            z: obj.mesh?.position.z ?? 0
          },
          dimensions: obj.dimensions || { w: 1, h: 1, d: 1 },
          isStatic: obj.isStatic ?? true,
          interactionZones: obj.interactionZones?.map((z: any) => ({
            zoneId: z.id || z.zoneId,
            note: z.note,
            onContact: z.onContact
          })) || []
        }))
      : [];

    const uprightPreset = humanoidPhysicsBinderRef.current
      ? humanoidPhysicsBinderRef.current.getUprightPreset()
      : {};

    const isGrounded = humanoidPhysicsBinderRef.current
      ? humanoidPhysicsBinderRef.current.getIsGrounded()
      : true;

    return {
      frame,
      joints,
      proprioception,
      audio_pcm: audioPcm,
      contact_forces,
      objects,
      uprightPreset,
      isGrounded,
      heartbeat: useAgentStore.getState().heartbeat,
      currentRung: useAgentStore.getState().currentRung,
      bodyType: useWorldStore.getState().bodyType,
      currentGoal: useAgentStore.getState().currentGoal,
      lightState: useWorldStore.getState().lightState,
      timestamp: Date.now(),
    };
  }, []);

  const detectOutcomes = useCallback(() => {
    const outcomes = [...pendingOutcomesRef.current];
    pendingOutcomesRef.current = [];

    if (useAgentStore.getState().status === "falling") {
      outcomes.push({
        type: "outcome",
        data: { success: false, reward: -1.0, description: "Agent fell" },
      });
    }

    return outcomes;
  }, []);

  return {
    isReady,
    getRagdoll: () => ragdollBuilderRef.current,
    spawnObject: (presetId: string, pos: THREE.Vector3) => {
      const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
      return activeObjManager?.spawnObject(presetId, pos) || null;
    },
    deleteObject: (id: string) => {
      const activeObjManager = useWorldStore.getState().useMuJoCo ? mujocoObjectManagerRef.current : objectManagerRef.current;
      activeObjManager?.deleteObject(id);
    },
    push: (partName: string, impulse: THREE.Vector3) => {
      if (worldStore.bodyType === 'humanoid' && humanoidPhysicsBinderRef.current) {
        humanoidPhysicsBinderRef.current.push(partName, impulse);
      } else if (ragdollBuilderRef.current) {
        ragdollBuilderRef.current.push(partName, impulse);
      }
    },
    captureWorldState,
    detectOutcomes,
  };
};
