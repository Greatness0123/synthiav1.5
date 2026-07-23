import { PhysicsEngine } from '../world/engine/PhysicsEngine';

let _intervalId: ReturnType<typeof setInterval> | null = null;

const FOOT_BONES = ['mixamorigleftfoot', 'mixamorigrightfoot'];

function logFootGroundDistance() {
  const engine = (window as any).__SYNTHIA_PHYSICS_ENGINE__;
  if (!engine) return;
  const model = engine.getModel?.();
  const data = engine.getData?.();
  if (!model || !data) return;
  const module = PhysicsEngine.getModule();
  if (!module) return;

  for (const boneName of FOOT_BONES) {
    const geomName = boneName + '_geom';
    const geomId = module.mj_name2id(model, module.mjtObj.mjOBJ_GEOM.value, geomName);
    if (geomId < 0) continue;

    // Retrieve geom size (half sizes hx, hy, hz)
    const hx = model.geom_size[geomId * 3];
    const hy = model.geom_size[geomId * 3 + 1];
    const hz = model.geom_size[geomId * 3 + 2];

    const posZ = data.geom_xpos[geomId * 3 + 2];
    const r6 = data.geom_xmat[geomId * 9 + 6];
    const r7 = data.geom_xmat[geomId * 9 + 7];
    const r8 = data.geom_xmat[geomId * 9 + 8];

    // Compute minimum world Z of 8 corners
    let minZ = Infinity;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const cz = posZ + r6 * (sx * hx) + r7 * (sy * hy) + r8 * (sz * hz);
          if (cz < minZ) {
            minZ = cz;
          }
        }
      }
    }

    const bodyId = module.mj_name2id(model, module.mjtObj.mjOBJ_BODY.value, boneName);
    const bodyZ = bodyId >= 0 ? data.xpos[bodyId * 3 + 2] : 0;

    const gapMm = minZ * 1000;
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
