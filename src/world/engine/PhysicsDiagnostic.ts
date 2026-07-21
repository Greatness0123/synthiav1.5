/**
 * PhysicsDiagnostic — Runtime Jitter Diagnostic for Synthia-1 Ragdoll (MuJoCo edition)
 *
 * USAGE (browser DevTools console, while the simulation is running):
 *   window.__SYNTHIA_DIAG__.start(300);  // sample for 300 frames (~5 sec)
 *   window.__SYNTHIA_DIAG__.stop();      // stop early and export
 *   window.__SYNTHIA_DIAG__.report();    // print live summary table
 *
 * What it measures per bone per frame:
 *   - angularSpeed      — world-space angular speed (rad/s), primary jitter signal
 *   - angularOscFreq    — sign-change frequency of angVel.x/y/z (>10 Hz = jitter)
 *   - torqueMag         — direct actuator force magnitude from sim.data.actuator_force (Nm)
 *   - torqueClamped     — true if torque is near/at limit range
 *   - errorAngleDeg     — rotational error from bind pose target (deg)
 *   - isTorqueReversing — true if angular velocity direction flipped (instability signal)
 *
 * Console muting:
 *   All console.log / warn / info / debug calls from OTHER sources are silenced
 *   while the diagnostic is running. Diagnostic output always prints.
 *   Original methods are fully restored on stop().
 */

import { PhysicsEngine } from './PhysicsEngine';
import type { HumanoidPhysicsBinder } from './HumanoidPhysicsBinder';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BoneFrameSample {
  frame: number;
  angularSpeed: number;
  angVelX: number;
  angVelY: number;
  angVelZ: number;
  torqueMag: number;
  torqueClamped: boolean;
  errorAngleDeg: number;
  isTorqueReversing: boolean;
}

interface BoneAccumulator {
  samples: BoneFrameSample[];
  prevAngVelSign: { x: number; y: number; z: number };
  prevTorqueDir: { x: number; y: number; z: number };
  signChanges: number;
}

interface BoneSummary {
  avgAngularSpeed: number;
  maxAngularSpeed: number;
  avgErrorAngleDeg: number;
  maxErrorAngleDeg: number;
  avgTorqueMag: number;
  maxTorqueMag: number;
  clampedFrames: number;
  clampedPct: number;
  oscillationsPerSec: number;
  verdict: 'STABLE' | 'WATCH' | 'JITTER' | 'CRITICAL';
}

interface DiagnosticReport {
  durationFrames: number;
  durationMs: number;
  capsule: {
    avgLinVelY: number;
    maxLinVelY: number;
    avgLinSpeed: number;
    maxLinSpeed: number;
    avgAngSpeed: number;
    maxAngSpeed: number;
    verticalDrift: number; // total Y movement over sample period
    verdict: 'STABLE' | 'HOVERING' | 'BOUNCING' | 'EXPLODED';
  } | null;
  bones: Record<string, BoneSummary>;
  topJitterers: Array<{ bone: string; avgAngularSpeed: number; oscillationsPerSec: number }>;
  worstTorqueClamp: Array<{ bone: string; clampedFrames: number; clampedPct: number }>;
}

interface JointDofCache {
  pitchDof: number;
  rollDof: number;
  yawDof: number;
  pitchQpos: number;
  rollQpos: number;
  yawQpos: number;
}

// ─── Console Mute ─────────────────────────────────────────────────────────────

const DIAG_PREFIX = '[DIAG]';

function createConsoleMute(): { install: () => void; restore: () => void } {
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  return {
    install() {
      const makeFilter = (orig: (...a: unknown[]) => void) => (...args: unknown[]) => {
        const first = String(args[0] ?? '');
        if (first.startsWith(DIAG_PREFIX)) orig(...args);
      };
      console.log = makeFilter(original.log);
      console.warn = makeFilter(original.warn);
      console.info = makeFilter(original.info);
      console.debug = makeFilter(original.debug);
      original.warn(DIAG_PREFIX, 'Console muted — only [DIAG] output will appear.');
    },
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.info = original.info;
      console.debug = original.debug;
      original.log(DIAG_PREFIX, 'Console restored to normal operation.');
    },
  };
}

// ─── Main Diagnostic Class ────────────────────────────────────────────────────

export class PhysicsDiagnostic {
  private binder: HumanoidPhysicsBinder;
  private accumulator: Map<string, BoneAccumulator> = new Map();
  private jointDofCache: Map<string, JointDofCache> = new Map();
  private frameCount = 0;
  private targetFrames = 300;
  private running = false;
  private animFrameId: number | null = null;
  private mute = createConsoleMute();
  private capsuleSamples: any[] = [];

  private _log = (...args: unknown[]) => console.log(DIAG_PREFIX, ...args);
  private _warn = (...args: unknown[]) => console.warn(DIAG_PREFIX, ...args);

  constructor(binder: HumanoidPhysicsBinder) {
    this.binder = binder;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  public start(durationFrames = 300): void {
    if (this.running) {
      this._warn('Already running — call stop() first.');
      return;
    }
    this.running = true;
    this.frameCount = 0;
    this.targetFrames = durationFrames;
    this.accumulator.clear();
    this.jointDofCache.clear();
    this.capsuleSamples = [];
    this.mute.install();
    this._log(`Starting — sampling for ${durationFrames} frames...`);

    const tick = () => {
      if (!this.running) return;
      this._sample();
      this.frameCount++;
      if (this.frameCount >= this.targetFrames) {
        this.stop();
      } else {
        this.animFrameId = requestAnimationFrame(tick);
      }
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  public stop(): void {
    if (!this.running) {
      this._warn('Not currently running.');
      return;
    }
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    const ms = this.frameCount * 16.6667;
    this.mute.restore();
    this._log(`Complete — ${this.frameCount} frames in ${ms.toFixed(0)} ms`);
    this.report();
    this._exportJson();
  }

  public report(): void {
    const rep = this._buildReport();
    if (!rep) { this._warn('No data yet. Run start() first.'); return; }

    this._log('══════════════════════════════════════════════════════════════════');
    this._log(`  SYNTHIA MUJOCO JITTER DIAGNOSTIC  |  ${rep.durationFrames} frames  |  ${(rep.durationMs / 1000).toFixed(2)} s`);
    this._log('══════════════════════════════════════════════════════════════════');
    this._log('');
    if (rep.capsule) {
      this._log('── CAPSULE STABILITY ─────────────────────────────────────────────');
      this._log(`  VERDICT:       ${rep.capsule.verdict}`);
      this._log(`  Drift Y:       ${rep.capsule.verticalDrift.toFixed(3)} m`);
      this._log(`  Avg Speed Y:   ${rep.capsule.avgLinVelY.toFixed(3)} m/s (Max: ${rep.capsule.maxLinVelY.toFixed(3)})`);
      this._log(`  Avg Speed XYZ: ${rep.capsule.avgLinSpeed.toFixed(3)} m/s (Max: ${rep.capsule.maxLinSpeed.toFixed(3)})`);
      this._log(`  Avg Ang Speed: ${rep.capsule.avgAngSpeed.toFixed(3)} rad/s`);
      this._log('');
    }
    this._log('── TOP BONES BY ANGULAR SPEED (rad/s) ────────────────────────────');
    this._log('   #  VERDICT    BONE                                avgω   osc/s  errAngle°');
    rep.topJitterers.forEach((j, i) => {
      const s = rep.bones[j.bone];
      const num = String(i + 1).padStart(3);
      const verd = s.verdict.padEnd(10);
      const name = j.bone.padEnd(36);
      const omega = j.avgAngularSpeed.toFixed(3).padStart(7);
      const osc = j.oscillationsPerSec.toFixed(1).padStart(6);
      const err = s.avgErrorAngleDeg.toFixed(1).padStart(9);
      this._log(`  ${num}  ${verd} ${name} ${omega}  ${osc}  ${err}`);
    });
    this._log('');
    this._log('── WORST TORQUE CLAMP RATE ────────────────────────────────────────');
    if (rep.worstTorqueClamp.length === 0) {
      this._log('  None — Actuators did not saturate/clamp.');
    } else {
      rep.worstTorqueClamp.forEach((t, i) => {
        const num = String(i + 1).padStart(3);
        const name = t.bone.padEnd(36);
        const ct = String(t.clampedFrames).padStart(5);
        const pct = t.clampedPct.toFixed(0).padStart(4);
        this._log(`  ${num}  ${name} ${ct} / ${rep.durationFrames} frames  (${pct}%)`);
      });
    }
    this._log('');
    this._log('── VERDICT KEY ────────────────────────────────────────────────────');
    this._log('  STABLE    ω < 0.2 rad/s, negligible oscillation (Calibrated for MuJoCo)');
    this._log('  WATCH     ω 0.2–0.8 rad/s or mild oscillation');
    this._log('  JITTER    ω 0.8–3.0 rad/s or oscillation > 5/s  ← needs fix');
    this._log('  CRITICAL  ω > 3.0 rad/s or oscillation > 15/s ← active instability');
    this._log('══════════════════════════════════════════════════════════════════');
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _sample(): void {
    const manager = this.binder.getMultiBodyManager();
    if (!manager || !manager.isActive) return;

    const bodiesMap = manager.getRigidBodiesMap();
    const capsuleBodyId = manager.getCapsuleBody();

    const world = (this.binder as any).physicsEngine.getWorld();
    const model = world.model;
    const data = world.data;

    if (capsuleBodyId !== null && capsuleBodyId >= 0) {
      const idx = capsuleBodyId * 3;
      const posMj = [data.xpos[idx], data.xpos[idx + 1], data.xpos[idx + 2]];
      const pos = PhysicsEngine.mujocoToWorld(posMj as any);

      const dofAdr = model.body_dofadr[capsuleBodyId];
      const qvel = data.qvel;
      const lMj = [qvel[dofAdr], qvel[dofAdr + 1], qvel[dofAdr + 2]];
      const aMj = [qvel[dofAdr + 3], qvel[dofAdr + 4], qvel[dofAdr + 5]];
      const lv = PhysicsEngine.mujocoToWorld(lMj as any);
      const av = PhysicsEngine.mujocoToWorld(aMj as any);

      this.capsuleSamples.push({
        frame: this.frameCount,
        y: pos.y,
        linSpeed: Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z),
        linVelY: lv.y,
        angSpeed: Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z)
      });
    }

    const currentTargets = (this.binder as any).currentTargets;

    // Build the dof index cache if empty to avoid calling name2id in the loop
    if (this.jointDofCache.size === 0) {
      const module = PhysicsEngine.getModule();
      if (module) {
        bodiesMap.forEach((bodyId, canonical) => {
          if (canonical === 'root_capsule' || bodyId < 0) return;

          const cache: JointDofCache = {
            pitchDof: -1, rollDof: -1, yawDof: -1,
            pitchQpos: -1, rollQpos: -1, yawQpos: -1
          };

          const pitchJntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, canonical + '_pitch');
          const rollJntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, canonical + '_roll');
          const yawJntId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, canonical + '_yaw');

          if (pitchJntId >= 0) {
            cache.pitchDof = model.jnt_dofadr[pitchJntId];
            cache.pitchQpos = model.jnt_qposadr[pitchJntId];
          }
          if (rollJntId >= 0) {
            cache.rollDof = model.jnt_dofadr[rollJntId];
            cache.rollQpos = model.jnt_qposadr[rollJntId];
          }
          if (yawJntId >= 0) {
            cache.yawDof = model.jnt_dofadr[yawJntId];
            cache.yawQpos = model.jnt_qposadr[yawJntId];
          }

          this.jointDofCache.set(canonical, cache);
        });
      }
    }

    bodiesMap.forEach((bodyId, canonical) => {
      if (canonical === 'root_capsule' || bodyId < 0) return;

      const cache = this.jointDofCache.get(canonical);
      if (!cache) return;

      const qvel = data.qvel;
      let ax = 0, ay = 0, az = 0;

      if (cache.pitchDof >= 0) ax = qvel[cache.pitchDof];
      if (cache.rollDof >= 0) ay = qvel[cache.rollDof];
      if (cache.yawDof >= 0) az = qvel[cache.yawDof];

      const angularSpeed = Math.sqrt(ax * ax + ay * ay + az * az);

      let acc = this.accumulator.get(canonical);
      if (!acc) {
        acc = {
          samples: [],
          prevAngVelSign: { x: 0, y: 0, z: 0 },
          prevTorqueDir: { x: 0, y: 0, z: 0 },
          signChanges: 0,
        };
        this.accumulator.set(canonical, acc);
      }

      const sx = Math.sign(ax), sy = Math.sign(ay), sz = Math.sign(az);
      if (acc.prevAngVelSign.x !== 0 && sx !== 0 && sx !== acc.prevAngVelSign.x) acc.signChanges++;
      if (acc.prevAngVelSign.y !== 0 && sy !== 0 && sy !== acc.prevAngVelSign.y) acc.signChanges++;
      if (acc.prevAngVelSign.z !== 0 && sz !== 0 && sz !== acc.prevAngVelSign.z) acc.signChanges++;
      acc.prevAngVelSign = { x: sx, y: sy, z: sz };

      let errorAngleDeg = 0;
      const target = currentTargets.get(canonical);
      if (target) {
        const qpos = data.qpos;
        let currPitch = 0, currRoll = 0, currYaw = 0;

        if (cache.pitchQpos >= 0) currPitch = qpos[cache.pitchQpos];
        if (cache.rollQpos >= 0) currRoll = qpos[cache.rollQpos];
        if (cache.yawQpos >= 0) currYaw = qpos[cache.yawQpos];

        let tPitch = 0, tRoll = 0, tYaw = 0;
        if (target.isScalar) {
          tPitch = target.scalar;
        } else {
          tYaw = target.z || 0;
          tPitch = target.x || 0;
          tRoll = target.y || 0;
        }

        const diffPitch = currPitch - tPitch;
        const diffRoll = currRoll - tRoll;
        const diffYaw = currYaw - tYaw;
        errorAngleDeg = (Math.sqrt(diffPitch * diffPitch + diffRoll * diffRoll + diffYaw * diffYaw) * 180) / Math.PI;
      }

      let maxTorqueMag = 0;
      let torqueClamped = false;
      const actuatorIds = manager.getActuatorMap().get(canonical);
      if (actuatorIds && actuatorIds.length > 0) {
        actuatorIds.forEach((actId) => {
          const actForce = Math.abs(data.actuator_force[actId]);
          if (actForce > maxTorqueMag) maxTorqueMag = actForce;

          const limitMin = model.actuator_forcerange[actId * 2];
          const limitMax = model.actuator_forcerange[actId * 2 + 1];
          if (limitMin !== 0 || limitMax !== 0) {
            if (actForce >= Math.abs(limitMax) * 0.98 || actForce >= Math.abs(limitMin) * 0.98) {
              torqueClamped = true;
            }
          }
        });
      }

      const invSpeed = angularSpeed > 1e-4 ? 1 / angularSpeed : 0;
      const nx = ax * invSpeed, ny = ay * invSpeed, nz = az * invSpeed;
      const dot = nx * acc.prevTorqueDir.x + ny * acc.prevTorqueDir.y + nz * acc.prevTorqueDir.z;
      const isTorqueReversing = dot < -0.7;
      acc.prevTorqueDir = { x: nx, y: ny, z: nz };

      acc.samples.push({
        frame: this.frameCount,
        angularSpeed,
        angVelX: ax,
        angVelY: ay,
        angVelZ: az,
        torqueMag: maxTorqueMag,
        torqueClamped,
        errorAngleDeg,
        isTorqueReversing,
      });
    });
  }

  private _buildReport(): DiagnosticReport | null {
    if (this.frameCount === 0) return null;
    const ms = this.frameCount * 16.6667;

    let capsuleSummary = null;
    if (this.capsuleSamples.length > 0) {
      const n = this.capsuleSamples.length;
      const avgLinVelY = this.capsuleSamples.reduce((s, x) => s + Math.abs(x.linVelY), 0) / n;
      const maxLinVelY = Math.max(...this.capsuleSamples.map(x => Math.abs(x.linVelY)));
      const avgLinSpeed = this.capsuleSamples.reduce((s, x) => s + x.linSpeed, 0) / n;
      const maxLinSpeed = Math.max(...this.capsuleSamples.map(x => x.linSpeed));
      const avgAngSpeed = this.capsuleSamples.reduce((s, x) => s + x.angSpeed, 0) / n;
      const maxAngSpeed = Math.max(...this.capsuleSamples.map(x => x.angSpeed));
      const minY = Math.min(...this.capsuleSamples.map(x => x.y));
      const maxY = Math.max(...this.capsuleSamples.map(x => x.y));
      const verticalDrift = maxY - minY;

      let verdict: 'STABLE' | 'HOVERING' | 'BOUNCING' | 'EXPLODED' = 'STABLE';
      if (maxLinSpeed > 20) verdict = 'EXPLODED';
      else if (avgLinVelY > 1.0 || verticalDrift > 0.5) verdict = 'BOUNCING';
      else if (avgLinVelY > 0.1 || verticalDrift > 0.1) verdict = 'HOVERING';

      capsuleSummary = {
        avgLinVelY, maxLinVelY,
        avgLinSpeed, maxLinSpeed,
        avgAngSpeed, maxAngSpeed,
        verticalDrift, verdict
      };
    }

    const bones: Record<string, BoneSummary> = {};

    this.accumulator.forEach((acc, canonical) => {
      if (acc.samples.length === 0) return;
      const n = acc.samples.length;

      const avgAngularSpeed = acc.samples.reduce((s, x) => s + x.angularSpeed, 0) / n;
      const maxAngularSpeed = Math.max(...acc.samples.map(x => x.angularSpeed));
      const avgErrorAngleDeg = acc.samples.reduce((s, x) => s + x.errorAngleDeg, 0) / n;
      const maxErrorAngleDeg = Math.max(...acc.samples.map(x => x.errorAngleDeg));
      const avgTorqueMag = acc.samples.reduce((s, x) => s + x.torqueMag, 0) / n;
      const maxTorqueMag = Math.max(...acc.samples.map(x => x.torqueMag));
      const clampedFrames = acc.samples.filter(x => x.torqueClamped).length;
      const clampedPct = (clampedFrames / n) * 100;
      const oscillationsPerSec = (acc.signChanges / 3) / (ms / 1000);

      let verdict: BoneSummary['verdict'];
      if (avgAngularSpeed > 3.0 || (avgAngularSpeed > 0.3 && oscillationsPerSec > 15)) verdict = 'CRITICAL';
      else if (avgAngularSpeed > 0.8 || (avgAngularSpeed > 0.1 && oscillationsPerSec > 5)) verdict = 'JITTER';
      else if (avgAngularSpeed > 0.2 || (avgAngularSpeed > 0.05 && oscillationsPerSec > 1)) verdict = 'WATCH';
      else verdict = 'STABLE';

      bones[canonical] = {
        avgAngularSpeed, maxAngularSpeed,
        avgErrorAngleDeg, maxErrorAngleDeg,
        avgTorqueMag, maxTorqueMag,
        clampedFrames, clampedPct,
        oscillationsPerSec,
        verdict,
      };
    });

    const sortedByOmega = Object.entries(bones)
      .sort(([, a], [, b]) => b.avgAngularSpeed - a.avgAngularSpeed)
      .map(([bone, s]) => ({ bone, avgAngularSpeed: s.avgAngularSpeed, oscillationsPerSec: s.oscillationsPerSec }));

    const sortedByClamp = Object.entries(bones)
      .filter(([, s]) => s.clampedFrames > 0)
      .sort(([, a], [, b]) => b.clampedFrames - a.clampedFrames)
      .map(([bone, s]) => ({ bone, clampedFrames: s.clampedFrames, clampedPct: s.clampedPct }));

    return {
      durationFrames: this.frameCount,
      durationMs: ms,
      capsule: capsuleSummary,
      bones,
      topJitterers: sortedByOmega.slice(0, 15),
      worstTorqueClamp: sortedByClamp.slice(0, 10),
    };
  }

  private _exportJson(): void {
    const rep = this._buildReport();
    if (!rep) return;
    const json = JSON.stringify(rep, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synthia_mujoco_diag_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._log('Full report JSON auto-downloaded.');
  }
}

declare global {
  interface Window {
    __SYNTHIA_DIAG__: {
      start: (frames?: number) => void;
      stop: () => void;
      report: () => void;
      _instance?: PhysicsDiagnostic;
    };
  }
}

export function installDiagnostic(binder: HumanoidPhysicsBinder): void {
  const diag = new PhysicsDiagnostic(binder);
  window.__SYNTHIA_DIAG__ = {
    start: (frames) => diag.start(frames),
    stop: () => diag.stop(),
    report: () => diag.report(),
    _instance: diag,
  };
  console.log('[DIAG] MuJoCo Diagnostic ready. Commands:');
  console.log('[DIAG]   window.__SYNTHIA_DIAG__.start(300)  — sample 300 frames');
  console.log('[DIAG]   window.__SYNTHIA_DIAG__.stop()      — stop & export JSON');
  console.log('[DIAG]   window.__SYNTHIA_DIAG__.report()    — print live table');
}
