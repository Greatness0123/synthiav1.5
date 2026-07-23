/**
 * Zustand store for world-specific state (physics, objects, camera).
 * Includes session persistence logic.
 */

import { create } from 'zustand';
import type { WorldObject, BodyType, BodyMode, Vector3, CameraMode } from '../types/world';

interface WorldState {
  objects: WorldObject[];
  gravity: number;
  globalFriction: number;
  bodyType: BodyType;
  bodyMode: BodyMode;
  spawnPoint: Vector3;
  cameraMode: CameraMode;
  godModeOpen: boolean;
  simplifiedSkeleton: boolean;
  showDebugJoints: boolean;
  sessionName: string;
  lightState: 'day' | 'night';
  dayNightCycleMs: number;
  showFloor: boolean;
  floorColor: string;
  skyColor: string;
  showGrid: boolean;
  showAICameraHelper: boolean;
  showAIPiP: boolean;
  showCapsuleDebug: boolean;
  movementSmoothing: number;
  useMultiBodyPD: boolean;
  useProcedural: boolean;
  lastAIFrameForDisplay: string | null;
  useMuJoCo: boolean;

  // Actions
  setUseMultiBodyPD: (enable: boolean) => void;
  setUseProcedural: (enable: boolean) => void;
  setGravity: (gravity: number) => void;
  setGlobalFriction: (friction: number) => void;
  setBodyType: (type: BodyType) => void;
  setBodyMode: (mode: BodyMode) => void;
  setSimplifiedSkeleton: (simplified: boolean) => void;
  setShowDebugJoints: (show: boolean) => void;
  setCameraMode: (mode: CameraMode) => void;
  setGodModeOpen: (open: boolean) => void;
  setLightState: (state: 'day' | 'night') => void;
  setDayNightCycleMs: (ms: number) => void;
  setShowFloor: (show: boolean) => void;
  setFloorColor: (color: string) => void;
  setSkyColor: (color: string) => void;
  setShowGrid: (show: boolean) => void;
  setShowAICameraHelper: (show: boolean) => void;
  setShowCapsuleDebug: (show: boolean) => void;
  setShowAIPiP: (show: boolean) => void;
  setMovementSmoothing: (speed: number) => void;
  setLastAIFrameForDisplay: (frame: string | null) => void;
  setUseMuJoCo: (enable: boolean) => void;
  addObject: (obj: WorldObject) => void;
  removeObject: (id: string) => void;
  saveSession: () => void;
  loadSession: () => void;
}

const STORAGE_KEY = 'synthia_world_session';

export const useWorldStore = create<WorldState>((set, get) => ({
  objects: [],
  gravity: -9.81,
  globalFriction: 0.5,
  bodyType: 'humanoid',
  bodyMode: 'rigid',
  spawnPoint: { x: 0, y: 0, z: 0 },
  cameraMode: 'third_person',
  godModeOpen: false,
  simplifiedSkeleton: true,
  showDebugJoints: false,
  sessionName: 'Default Session',
  lightState: 'day',
  dayNightCycleMs: 600000,
  showFloor: true,
  floorColor: '#222222',
  skyColor: '#87ceeb',
  showGrid: true,
  showAICameraHelper: false,
  showAIPiP: true,
  showCapsuleDebug: false,
  movementSmoothing: 0.15,
  useMultiBodyPD: true,
  useProcedural: false,
  lastAIFrameForDisplay: null as string | null,
  useMuJoCo: false,

  setUseMultiBodyPD: (useMultiBodyPD) => {
    set({ useMultiBodyPD });
    get().saveSession();
  },
  setUseProcedural: (useProcedural) => {
    set({ useProcedural });
    get().saveSession();
  },
  setGravity: (gravity) => {
    set({ gravity });
    get().saveSession();
  },
  setGlobalFriction: (globalFriction) => {
    set({ globalFriction });
    get().saveSession();
  },
  setBodyType: (bodyType) => {
    if (bodyType !== 'humanoid') {
      console.warn(`Body type ${bodyType} is currently disabled. Coming in a future update.`);
      return;
    }
    set({ bodyType });
    get().saveSession();
  },
  setBodyMode: (bodyMode) => {
    set({ bodyMode });
    get().saveSession();
  },
  setSimplifiedSkeleton: (simplifiedSkeleton) => {
    set({ simplifiedSkeleton });
    get().saveSession();
  },
  setShowDebugJoints: (showDebugJoints) => {
    set({ showDebugJoints });
    get().saveSession();
  },
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setGodModeOpen: (godModeOpen) => set({ godModeOpen }),
  setLightState: (lightState) => set({ lightState }),
  setDayNightCycleMs: (dayNightCycleMs) => set({ dayNightCycleMs }),
  setShowFloor: (showFloor) => {
    set({ showFloor });
    get().saveSession();
  },
  setFloorColor: (floorColor) => {
    set({ floorColor });
    get().saveSession();
  },
  setSkyColor: (skyColor) => {
    set({ skyColor });
    get().saveSession();
  },
  setShowGrid: (showGrid) => {
    set({ showGrid });
    get().saveSession();
  },
  setShowAICameraHelper: (showAICameraHelper) => {
    set({ showAICameraHelper });
    get().saveSession();
  },
  setShowCapsuleDebug: (showCapsuleDebug) => set({ showCapsuleDebug }),
  setShowAIPiP: (showAIPiP) => set({ showAIPiP }),
  setMovementSmoothing: (movementSmoothing) => {
    set({ movementSmoothing });
    get().saveSession();
  },
  setLastAIFrameForDisplay: (lastAIFrameForDisplay) => set({ lastAIFrameForDisplay }),
  setUseMuJoCo: (useMuJoCo) => {
    set({ useMuJoCo });
    get().saveSession();
  },
  addObject: (obj) => {
    set((state) => ({ objects: [...state.objects, obj] }));
    get().saveSession();
  },
  removeObject: (id) => {
    set((state) => ({ objects: state.objects.filter(o => o.id !== id) }));
    get().saveSession();
  },

  saveSession: () => {
    const state = get();
    const data = {
      sessionName: state.sessionName,
      spawnPoint: state.spawnPoint,
      objects: state.objects,
      gravity: state.gravity,
      globalFriction: state.globalFriction,
      bodyType: state.bodyType,
      simplifiedSkeleton: state.simplifiedSkeleton,
      showDebugJoints: state.showDebugJoints,
      showFloor: state.showFloor,
      floorColor: state.floorColor,
      skyColor: state.skyColor,
      showGrid: state.showGrid,
      showAICameraHelper: state.showAICameraHelper,
      movementSmoothing: state.movementSmoothing,
      useProcedural: state.useProcedural,
      useMuJoCo: state.useMuJoCo,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },

  loadSession: () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        set({ ...data });
      } catch (e) {
        console.error('Failed to load world session', e);
      }
    }
  }
}));
