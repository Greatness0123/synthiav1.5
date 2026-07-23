import { PhysicsEngine } from '../world/engine/PhysicsEngine';

let _intervalId: ReturnType<typeof setInterval> | null = null;

const FOOT_BONES = ['mixamorigleftfoot', 'mixamorigrightfoot'];
const FOOT_HALF_HEIGHT = 0.01;
const FOOT_OFFSET_Z = 0.02;

function logFootGroundDistance() {
  const engine = (window as any).__SYNTHIA_PHYSICS_ENGINE__;
  if (!engine) return;
  const model = engine.getModel?.();
  const data = engine.getData?.();
  if (!model || !data) return;
  const module = PhysicsEngine.getModule();
  if (!module) return;

  for (const boneName of FOOT_BONES) {
    const bodyId = module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, boneName);
    if (bodyId < 0) continue;

    const idx = bodyId * 3;
    const bodyZ = data.xpos[idx + 2];
    const lowestPointZ = bodyZ + FOOT_OFFSET_Z - FOOT_HALF_HEIGHT;
    const gapMm = lowestPointZ * 1000;

    const side = boneName.includes('left') ? 'L' : 'R';
    const ts = (performance.now() / 1000).toFixed(2);
    console.log(`[foot-ground] ${ts}s ${side}foot gap=${gapMm.toFixed(1)}mm  bodyZ=${(bodyZ * 1000).toFixed(1)}mm`);
  }
}

function start() {
  if (_intervalId !== null) return;

  console.log('[foot-ground] Starting — will stop after 8 seconds.');

  _intervalId = setInterval(() => {
    try {
      logFootGroundDistance();
    } catch {
      // engine not ready yet, silently retry
    }
  }, 16);

  setTimeout(() => {
    stop();
  }, 8000);
}

function stop() {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
    console.log('[foot-ground] Stopped.');
  }
}

// Expose to window
if (typeof window !== 'undefined') {
  (window as any).startFootGroundDistance = start;
  (window as any).stopFootGroundDistance = stop;

  // Auto-start: poll until physics engine is ready, then start logging
  const autoStart = setInterval(() => {
    const engine = (window as any).__SYNTHIA_PHYSICS_ENGINE__;
    if (engine && typeof engine.getModel === 'function') {
      clearInterval(autoStart);
      start();
    }
  }, 500);
}
