/**
 * React hook to initialize and manage the World Engine with multi-agent client-side support.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { WorldEngine } from "../engine/WorldEngine";
import { PhysicsEngine } from "../engine/PhysicsEngine";
import { AudioEngine } from "../engine/AudioEngine";
import { ObjectManager } from "../engine/ObjectManager";
import { HumanoidPhysicsBinder } from "../engine/HumanoidPhysicsBinder";
import { useWorldStore } from "../../store/worldStore";
import { useAgentStore } from "../../store/agentStore";
import { useConnectionStore } from "../../store/connectionStore";
import { useUIStore } from "../../store/uiStore";
import { synthiaToast } from "../../components/ui/Toast";
import { debouncedToast } from "../../utils/toastUtils";
import { STRINGS } from "../../constants/strings";
import { logger as Logger } from "../../utils/logger";
import * as THREE from "three";
import { AgentLoop } from "../engine/AgentLoop";

export const useWorld = (containerRef: React.RefObject<HTMLDivElement>) => {
  const [isReady, setIsReady] = useState(false);
  const worldEngineRef = useRef<WorldEngine | null>(null);
  const physicsEngineRef = useRef<PhysicsEngine | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const objectManagerRef = useRef<ObjectManager | null>(null);
  const humanoidPhysicsBinderRef = useRef<HumanoidPhysicsBinder | null>(null);

  const worldStore = useWorldStore();
  const agentStore = useAgentStore();
  const pendingOutcomesRef = useRef<any[]>([]);
  const lastJointStateRef = useRef<Record<string, any>>({});
  const boundaryViolationCountRef = useRef(0);
  const BOUNDARY_RESET_FRAMES = 5;

  // Multi-agent active loops
  const agentLoopsRef = useRef<Map<string, AgentLoop>>(new Map());

  // ─── Fall diagnostics ring buffer ────────────────────
  const DIAG_RING_SIZE = 300;
  const diagRingRef = useRef<any[]>([]);
  const diagRingIdx = useRef(0);
  const diagRingFull = useRef(false);
  const diagRingFrameCount = useRef(0);
  const diagCaptureDone = useRef(false);
  const diagJointCacheRef = useRef<Map<string, { bodyId: number; qposAdr: number; dofAdr: number; dofCount: number; qposCount: number; name: string }> | null>(null);
  const diagGeomCacheRef = useRef<Map<string, { geomId: number; bodyName: string; type: number }> | null>(null);
  const diagBodyCacheRef = useRef<Map<string, { bodyId: number; mass: number; parentBodyId: number; geomIds: number[] }> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const init = async () => {
      try {
        Logger.info("useWorld: Initializing MuJoCo physics...");
        const physicsEngine = new PhysicsEngine();
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

        const objectManager = new ObjectManager(
          physicsEngine,
          worldEngine.getScene(),
          audioEngine
        );
        objectManagerRef.current = objectManager;

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
          const activeObjManager = objectManagerRef.current;
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
          const activeObjManager = objectManagerRef.current;
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
              object.position.z,
              'agent_0'
            );
          }
        };

        const humanoidPhysicsBinder = new HumanoidPhysicsBinder(
          physicsEngine,
          worldEngine.getScene()
        );
        humanoidPhysicsBinderRef.current = humanoidPhysicsBinder;

        // Expose humanoid binder and agents to window for step-by-step testing
        (window as any).__SYNTHIA_HUMANOID_BINDER__ = humanoidPhysicsBinder;
        (window as any).__SYNTHIA_PHYSICS_ENGINE__ = physicsEngine;
        (window as any).__SYNTHIA_MUJOCO_MODULE__ = PhysicsEngine.getModule();
        (window as any).__SYNTHIA_CAMERA__ = worldEngineRef.current.getCamera();
        (window as any).__SYNTHIA_RENDERER__ = worldEngineRef.current.getRenderer();
        (window as any).__SYNTHIA_SCENE__ = worldEngineRef.current.getScene();
        (window as any).THREE = THREE;
        (window as any).__SYNTHIA_FLOOR_MESH__ = worldEngineRef.current.getFloorMesh();

        // Register window.spawnAgent on the global window object
        (window as any).spawnAgent = async (agentId?: string) => {
          const id = agentId || `agent_${agentLoopsRef.current.size}`;
          const currentCount = agentLoopsRef.current.size;
          // Spawn at 2.0 meters spacing on the X-axis to prevent collision overlap
          const spawnOffset = new THREE.Vector3(currentCount * 2.0, 0, 0);

          console.log(`[useWorld] Spawning new agent ${id} with offset x=${spawnOffset.x}`);
          synthiaToast.info(`Spawning agent ${id}...`);

          await humanoidPhysicsBinder.spawnAgent(id, spawnOffset);

          const newLoop = new AgentLoop({
            agentId: id,
            getWorldState: () => captureWorldState(id),
          });
          agentLoopsRef.current.set(id, newLoop);
          await newLoop.start();

          synthiaToast.success(`Agent ${id} is fully spawned and active.`);
          return id;
        };

        Logger.info("useWorld: Starting animation loop...");
        worldEngineRef.current.start(
          () => {
            // Diagnostics step callback
          },
          () => {
            // Per-frame (60Hz) synchronizations
            try {
              objectManagerRef.current?.update();
              objectManagerRef.current?.syncVisuals();
            } catch (error) {
              Logger.warn("ObjectManager update error caught safely", error);
            }

            if (worldStore.bodyType === 'humanoid' && humanoidPhysicsBinder) {
              try {
                humanoidPhysicsBinder.updateMotorTargets();
                humanoidPhysicsBinder.syncVisuals();

                humanoidPhysicsBinder.renderAICameraHelper(
                  useWorldStore.getState().showAICameraHelper,
                  worldEngineRef.current?.getCameraManager().getCameraData()
                );
                const state = humanoidPhysicsBinder.getJointState('agent_0');
                lastJointStateRef.current = state;

                const headTransform = humanoidPhysicsBinder.getHeadTransform('agent_0');
                if (headTransform) {
                  const headMatrix = new THREE.Matrix4().compose(
                    headTransform.position,
                    headTransform.quaternion,
                    new THREE.Vector3(1, 1, 1)
                  );

                  let capsuleQuat: THREE.Quaternion | undefined;
                  let capsulePos: THREE.Vector3 | undefined;
                  const capsuleBody = humanoidPhysicsBinder.getCapsuleBody('agent_0');
                  if (capsuleBody?.isValid()) {
                    const t = capsuleBody.translation();
                    const r = capsuleBody.rotation();
                    capsulePos = new THREE.Vector3(t.x, t.y, t.z);
                    capsuleQuat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
                  }

                  worldEngineRef.current?.getCameraManager().update(headMatrix, headTransform.position, capsuleQuat, capsulePos);
                }

                if (humanoidPhysicsBinder.isOutOfWorldBounds('agent_0')) {
                  boundaryViolationCountRef.current += 1;
                  if (boundaryViolationCountRef.current >= BOUNDARY_RESET_FRAMES) {
                    Logger.warn('useWorld: agent_0 exceeded world boundary — auto reset');
                    humanoidPhysicsBinder.resetPose(useWorldStore.getState().spawnPoint, 'agent_0');
                    boundaryViolationCountRef.current = 0;
                  }
                } else {
                  boundaryViolationCountRef.current = 0;
                }
              } catch (error) {
                Logger.warn('HumanoidPhysicsBinder sync failed:', error);
              }
            }
          }
        );

        setIsReady(true);
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
      physicsEngineRef.current?.cleanup();
      // Stop all agent loops on cleanup
      agentLoopsRef.current.forEach((loop) => loop.stop());
      agentLoopsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (objectManagerRef.current) {
      objectManagerRef.current.setGlobalFriction(worldStore.globalFriction);
    }
  }, [worldStore.globalFriction]);

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
    if (worldStore.bodyType === 'humanoid') {
      if (humanoidPhysicsBinderRef.current) {
        humanoidPhysicsBinderRef.current.setMode(worldStore.bodyMode);
      }
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

  // Handle object actions
  useEffect(() => {
    const handleRename = (e: any) => {
      const { id, name } = e.detail;
      objectManagerRef.current?.renameObject(id, name);
    };

    const handleUpdatePhysics = (e: any) => {
      const { id, updates } = e.detail;
      objectManagerRef.current?.updateObjectPhysics(id, updates);
    };

    const handleDeleteObject = (e: any) => {
      const { id } = e.detail;
      worldEngineRef.current?.getCameraManager().attachTransform(null);
      objectManagerRef.current?.deleteObject(id);
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

  // Subscribe to camera mode
  useEffect(() => {
    worldEngineRef.current?.getCameraManager().setMode(worldStore.cameraMode);
  }, [worldStore.cameraMode]);

  const findSpawnPosition = useCallback((skipHumanoidCheck = false): THREE.Vector3 => {
    const humanoidPos = new THREE.Vector3(0, 0, 5);
    const binder = humanoidPhysicsBinderRef.current;
    if (binder) {
      const headTransform = binder.getHeadTransform('agent_0');
      if (headTransform) {
        humanoidPos.set(headTransform.position.x, 0, headTransform.position.z);
      }
    }

    const activeObjManager = objectManagerRef.current;
    const spawnRadius = 2.2;
    const spawnPos = new THREE.Vector3();
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

  // Listen for object spawns
  useEffect(() => {
    const handleSpawnEvent = (e: Event) => {
      const { presetId } = (e as CustomEvent).detail;
      const activeObjManager = objectManagerRef.current;
      if (!activeObjManager) return;

      const spawnPos = findSpawnPosition();
      activeObjManager.spawnObject(presetId, spawnPos);
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
      const activeObjManager = objectManagerRef.current;
      if (!activeObjManager) return;

      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const spawnPos = findSpawnPosition(isTerrain);
      if (isTerrain) {
        spawnPos.y = -box.min.y;
      } else {
        spawnPos.y = Math.max(0.1, size.y / 2 + 0.01);
      }

      activeObjManager.spawnCustomModel(scene, name, spawnPos, { isTerrain });
    };

    window.addEventListener('synthia:spawnCustom', handleSpawnCustom);
    return () => window.removeEventListener('synthia:spawnCustom', handleSpawnCustom);
  }, [findSpawnPosition]);

  useEffect(() => {
    const handlePush = (e: any) => {
      const { partName, impulse, agentId = 'agent_0' } = e.detail;
      if (worldStore.bodyType === 'humanoid' && humanoidPhysicsBinderRef.current) {
        humanoidPhysicsBinderRef.current.push(partName, new THREE.Vector3(impulse.x, impulse.y, impulse.z), agentId);
      }
    };

    window.addEventListener('synthia:push', handlePush);
    return () => window.removeEventListener('synthia:push', handlePush);
  }, [worldStore.bodyType]);

  // Handle multi-agent actions cleanly with isolated bone prefix-aware lookup
  useEffect(() => {
    const handleAction = (e: any) => {
      const { agentId = 'agent_0', jointOverrides, programSequence, sequence, activeGaitPhase } = e.detail;
      Logger.info(`[useWorld Action] agent=${agentId}, jointOverrides=${Object.keys(jointOverrides || {}).length}`);

      const binder = humanoidPhysicsBinderRef.current;
      if (worldStore.bodyType === 'humanoid' && binder) {
        const agent = binder.getAgents().get(agentId);
        if (!agent) return;

        try {
          const skeleton = agent.skeleton;

          if (Array.isArray(sequence) && sequence.length > 0) {
            const validation = binder.validateAndApplyTimeline(skeleton, sequence, { activeGaitPhase: !!activeGaitPhase }, agentId);
            for (const f of validation.appliedTimeline) {
              if (f.timeOffsetMs === 0) {
                binder.setMotorTargets(f.overrides as any, agentId);
              }
            }
          } else {
            const seq = [{ timeOffsetMs: 0, overrides: jointOverrides || {} }];
            const validation = binder.validateAndApplyTimeline(skeleton, seq, { activeGaitPhase: false }, agentId);
            for (const f of validation.appliedTimeline) {
              if (f.timeOffsetMs === 0) {
                binder.setMotorTargets(f.overrides as any, agentId);
              }
            }
          }

          if (programSequence && Array.isArray(programSequence) && programSequence.length > 0) {
            binder.executeProgramSequence(programSequence, agentId);
          }
        } catch (err) {
          Logger.warn('Action validation failed', err);
        }
      }
    };

    window.addEventListener('synthia:action', handleAction);
    return () => window.removeEventListener('synthia:action', handleAction);
  }, [worldStore.bodyType]);

  // Reset Pose Event Handler
  useEffect(() => {
    const handleResetPose = () => {
      const binder = humanoidPhysicsBinderRef.current;
      if (binder) {
        binder.resetPose(worldStore.spawnPoint, 'agent_0');
      }
    };
    window.addEventListener('synthia:resetPose', handleResetPose);
    return () => window.removeEventListener('synthia:resetPose', handleResetPose);
  }, [worldStore.spawnPoint]);

  // Root Motion Event Handler
  useEffect(() => {
    const handleRootMotion = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const { dx = 0, dz = 0, agentId = 'agent_0' } = detail;
      if (worldStore.bodyType !== 'humanoid' || !humanoidPhysicsBinderRef.current) return;
      const capsuleBody = humanoidPhysicsBinderRef.current.getCapsuleBody(agentId);
      if (!capsuleBody || !capsuleBody.isValid()) return;
      const t = capsuleBody.translation();
      capsuleBody.setTranslation({ x: t.x + dx, y: t.y, z: t.z + dz }, true);
    };
    window.addEventListener('synthia:rootMotion', handleRootMotion);
    return () => { window.removeEventListener('synthia:rootMotion', handleRootMotion); };
  }, [worldStore.bodyType]);

  // Build the first agent physically in the world
  useEffect(() => {
    if (!isReady) return;

    const build = async () => {
      worldEngineRef.current?.getCameraManager().attachTransform(null);

      if (worldStore.bodyType === 'humanoid' && humanoidPhysicsBinderRef.current) {
        const binder = humanoidPhysicsBinderRef.current;

        const probePoint = new THREE.Vector3(0, 0, 0);
        const stepA = await binder.loadAndVisualizeBindPose(probePoint);
        if (!stepA) { Logger.error('useWorld: STEP A failed'); return; }

        binder.repositionModel(
          worldStore.spawnPoint.x,
          worldStore.spawnPoint.y,
          worldStore.spawnPoint.z,
          'agent_0'
        );

        binder.renderDebugSpheres(worldStore.showDebugJoints);

        const stepB = await binder.createRigidBodiesAndColliders();
        if (!stepB) { Logger.error('useWorld: STEP B failed'); return; }

        await binder.createJointsWithZeroMotors();
        await binder.activateMotorsWithStiffnessAndDamping(80, 10);

        if (worldStore.useMultiBodyPD) {
          await binder.activateMultiBody();
        }

        binder.setMode(worldStore.bodyMode);
        physicsEngineRef.current?.forward();

        // Spin up Agent_0 client-side AgentLoop
        const agent_0_loop = new AgentLoop({
          agentId: 'agent_0',
          getWorldState: () => captureWorldState('agent_0'),
        });
        agentLoopsRef.current.set('agent_0', agent_0_loop);
        await agent_0_loop.start();
      }
    };

    build();
  }, [
    isReady,
    worldStore.bodyType,
    worldStore.spawnPoint,
    worldStore.useMultiBodyPD,
    worldStore.bodyMode,
    worldStore.showDebugJoints,
  ]);

  useEffect(() => {
    if (!isReady) return;

    const interval = setInterval(() => {
      const nextState = worldStore.lightState === "day" ? "night" : "day";
      worldStore.setLightState(nextState);
    }, worldStore.dayNightCycleMs);

    return () => clearInterval(interval);
  }, [isReady, worldStore.dayNightCycleMs, worldStore.lightState, worldStore.setLightState]);

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

  const captureWorldState = useCallback(async (agentId: string = 'agent_0') => {
    if (
      !worldEngineRef.current ||
      !humanoidPhysicsBinderRef.current ||
      !audioEngineRef.current
    )
      return null;

    const renderer = worldEngineRef.current.getRenderer();
    const scene = worldEngineRef.current.getScene();
    const camera = worldEngineRef.current.getCamera();

    // Render main view
    renderer.render(scene, camera);

    // Position first-person AI camera at the requested agent's eye
    const headTransform = humanoidPhysicsBinderRef.current.getHeadTransform(agentId);
    if (headTransform) {
      const aiCam = worldEngineRef.current.getCameraManager().getHeadCamera();
      aiCam.position.copy(headTransform.position);
      aiCam.quaternion.copy(headTransform.quaternion);
    }

    // Get AI frame from offscreen capture
    const rawFrame = worldEngineRef.current.getLastAIFrame();
    if (!rawFrame) {
      return null;
    }

    const frame = rawFrame;
    const joints = humanoidPhysicsBinderRef.current.getJointState(agentId);

    // Local-frame observation builder
    let proprioception: any = null;
    if (humanoidPhysicsBinderRef.current.mbActive) {
      const obsBuilder = humanoidPhysicsBinderRef.current.getObservationBuilder();
      const capsuleBody = humanoidPhysicsBinderRef.current.getCapsuleBody(agentId);
      if (capsuleBody?.isValid()) {
        proprioception = obsBuilder.buildVLMProprioception(capsuleBody);
      }
    }

    const audioBuffer = await audioEngineRef.current.getBuffer();
    const audioPcm = audioBuffer ? btoa(String.fromCharCode(...new Uint8Array(audioBuffer.buffer))) : "";

    const contact_forces = humanoidPhysicsBinderRef.current.getContactForces(agentId);

    const activeObjManager = objectManagerRef.current;
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
        }))
      : [];

    const uprightPreset = humanoidPhysicsBinderRef.current.getUprightPreset(agentId);
    const isGrounded = humanoidPhysicsBinderRef.current.getIsGrounded(agentId);

    return {
      frame,
      joints,
      proprioception,
      audio_pcm: audioPcm,
      contact_forces,
      objects,
      uprightPreset,
      isGrounded,
      heartbeat: useAgentStore.getState().agents[agentId]?.heartbeat || 0,
      currentRung: useAgentStore.getState().agents[agentId]?.currentRung || 0,
      bodyType: useWorldStore.getState().bodyType,
      currentGoal: useAgentStore.getState().agents[agentId]?.currentGoal || null,
      lightState: useWorldStore.getState().lightState,
      timestamp: Date.now(),
    };
  }, []);

  const detectOutcomes = useCallback(() => {
    const outcomes = [...pendingOutcomesRef.current];
    pendingOutcomesRef.current = [];

    // Dispatch outcome feedback directly to active agent loops
    outcomes.forEach((outcome) => {
      agentLoopsRef.current.forEach((loop) => {
        loop.handleOutcome(outcome.data);
      });
    });

    return outcomes;
  }, []);

  return {
    isReady,
    getRagdoll: () => null,
    spawnObject: (presetId: string, pos: THREE.Vector3) => {
      return objectManagerRef.current?.spawnObject(presetId, pos) || null;
    },
    deleteObject: (id: string) => {
      objectManagerRef.current?.deleteObject(id);
    },
    push: (partName: string, impulse: THREE.Vector3) => {
      humanoidPhysicsBinderRef.current?.push(partName, impulse, 'agent_0');
    },
    captureWorldState,
    detectOutcomes,
  };
};
