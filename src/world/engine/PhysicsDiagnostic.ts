/**
 * PhysicsDiagnostic — Runtime Jitter Diagnostic for Synthia-1 Ragdoll
 *
 * USAGE (browser DevTools console, while the simulation is running):
 *   window.__SYNTHIA_DIAG__.start(300);  // sample for 300 frames (~5 sec)
 *   window.__SYNTHIA_DIAG__.stop();      // stop early and export
 *   window.__SYNTHIA_DIAG__.report();    // print live summary table
 *
 * What it measures per bone per frame:
 *   - angularSpeed      — world-space angular speed (rad/s), primary jitter signal
 *   - angularOscFreq    — sign-change frequency of angVel.x/y/z (>10 Hz = jitter)
 *   - torqueMag         — estimated magnitude of PD torque (Nm)
 *   - torqueClamped     — true if MAX_TORQUE clamp would fire this frame
 *   - errorAngleDeg     — rotational error from bind pose (deg)
 *   - isTorqueReversing — true if angular velocity direction flipped (instability signal)
 *
 * Console muting:
 *   All console.log / warn / info / debug calls from OTHER sources are silenced
 *   while the diagnostic is running. Diagnostic output always prints.
 *   Original methods are fully restored on stop().
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { HumanoidMultiBodyManager } from './HumanoidMultiBodyManager';

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
  firstFrameDebug?: {
    currentRelQuat: { x: number, y: number, z: number, w: number },
    bindQ: { x: number, y: number, z: number, w: number },
    errorQuat: { x: number, y: number, z: number, w: number },
    errorAngleDeg: number
  };
}
interface BoneSummary {
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
  firstFrameDebug?: BoneAccumulator['firstFrameDebug'];
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
        // All other callers are silently suppressed during diagnostic run
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
  private manager: HumanoidMultiBodyManager;
  private accumulator: Map<string, BoneAccumulator> = new Map();
  private frameCount = 0;
  private targetFrames = 300;
  private running = false;
  private startTime = 0;
  private animFrameId: number | null = null;
  private mute = createConsoleMute();
  private capsuleSamples: any[] = [];

  // These bypass the mute filter by going directly to the captured originals
  private _log = (...args: unknown[]) => console.log(DIAG_PREFIX, ...args);
  private _warn = (...args: unknown[]) => console.warn(DIAG_PREFIX, ...args);

  private static _BONE_PD_GAINS: Record<string, { stiffness: number; damping: number }> = {};

  constructor(manager: HumanoidMultiBodyManager) {
    this.manager = manager;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Start sampling. durationFrames defaults to 300 (≈5 s at 60 Hz). */
  public start(durationFrames = 300): void {
    if (this.running) {
      this._warn('Already running — call stop() first.');
      return;
    }
    this.running = true;
    this.frameCount = 0;
    this.targetFrames = durationFrames;
    this.accumulator.clear();
    this.capsuleSamples = [];
    this.startTime = performance.now();

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

  /** Stop early — also called automatically when target frames are reached. */
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
    const ms = performance.now() - this.startTime;
    this.mute.restore();
    this._log(`Complete — ${this.frameCount} frames in ${ms.toFixed(0)} ms`);
    this.report();
    this._exportJson();
  }

  /** Print a formatted summary table. Can be called at any time. */
  public report(): void {
    const rep = this._buildReport();
    if (!rep) { this._warn('No data yet. Run start() first.'); return; }

    this._log('══════════════════════════════════════════════════════════════════');
    this._log(`  SYNTHIA JITTER DIAGNOSTIC  |  ${rep.durationFrames} frames  |  ${(rep.durationMs / 1000).toFixed(2)} s`);
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
    this._log('── WORST TORQUE CLAMP RATE (MAX_TORQUE=15 Nm) ────────────────────');
    if (rep.worstTorqueClamp.length === 0) {
      this._log('  None — MAX_TORQUE clamp did not fire.');
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
    this._log('  STABLE    ω < 0.5 rad/s, negligible oscillation');
    this._log('  WATCH     ω 0.5–2 rad/s or mild oscillation');
    this._log('  JITTER    ω 2–8 rad/s or oscillation > 5/s  ← needs fix');
    this._log('  CRITICAL  ω > 8 rad/s or oscillation > 15/s ← active instability');
    this._log('══════════════════════════════════════════════════════════════════');
  }

  /** Attach BONE_PD_GAINS so torque estimation is accurate. */
  public static setBonePDGains(gains: Record<string, { stiffness: number; damping: number }>): void {
    PhysicsDiagnostic._BONE_PD_GAINS = gains;
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _sample(): void {
    // Cast to any to access private fields — intentional for a diagnostic-only module
    const mgr = this.manager as unknown as Record<string, unknown>;
    const bodies = mgr['bodies'] as Map<string, { rigidBody: RAPIER.RigidBody }> | undefined;
    if (!bodies) return;

    const bindPoseQuats = mgr['bindPoseRelativeQuats'] as Map<string, { x: number; y: number; z: number; w: number }> | undefined;
    const capsuleBody = mgr['capsuleBody'] as RAPIER.RigidBody | undefined;

    if (capsuleBody && capsuleBody.isValid()) {
      const p = capsuleBody.translation();
      const lv = capsuleBody.linvel();
      const av = capsuleBody.angvel();
      this.capsuleSamples.push({
        frame: this.frameCount,
        y: p.y,
        linSpeed: Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z),
        linVelY: lv.y,
        angSpeed: Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z)
      });
    }

    bodies.forEach((bodyData, canonical) => {
      if (!bodyData.rigidBody || !bodyData.rigidBody.isValid()) return;

      const av = bodyData.rigidBody.angvel();
      const angularSpeed = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);

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

      // Oscillation: count axis sign reversals
      const sx = Math.sign(av.x), sy = Math.sign(av.y), sz = Math.sign(av.z);
      if (acc.prevAngVelSign.x !== 0 && sx !== 0 && sx !== acc.prevAngVelSign.x) acc.signChanges++;
      if (acc.prevAngVelSign.y !== 0 && sy !== 0 && sy !== acc.prevAngVelSign.y) acc.signChanges++;
      if (acc.prevAngVelSign.z !== 0 && sz !== 0 && sz !== acc.prevAngVelSign.z) acc.signChanges++;
      acc.prevAngVelSign = { x: sx, y: sy, z: sz };

      // Error angle vs bind pose
      let errorAngleDeg = 0;
      if (bindPoseQuats) {
        const bindQ = bindPoseQuats.get(canonical);
        if (bindQ) {
          const boneInfoMap = mgr['boneInfoMap'] as Map<string, any> | undefined;
          const trackedBones = mgr['trackedBones'] as Set<string> | undefined;
          const capsuleBody = mgr['capsuleBody'] as RAPIER.RigidBody | undefined;

          if (boneInfoMap && trackedBones && capsuleBody) {
            const boneObj = boneInfoMap.get(canonical)?.bone;
            // Basic parent lookup
            let pName: string | null = null;
            let curr = boneObj?.parent;
            while (curr && curr.type === 'Bone') {
              const cName = curr.name.toLowerCase().replace(/:/g, '');
              if (trackedBones.has(cName)) { pName = cName; break; }
              curr = curr.parent;
            }

            const parentBody = pName ? bodies.get(pName)?.rigidBody ?? capsuleBody : capsuleBody;
            if (parentBody) {
              const cRot = bodyData.rigidBody.rotation();
              const pRot = parentBody.rotation();
              const childQuat = new THREE.Quaternion(cRot.x, cRot.y, cRot.z, cRot.w);
              const parentQuat = new THREE.Quaternion(pRot.x, pRot.y, pRot.z, pRot.w);
              const currentRelQuat = parentQuat.invert().multiply(childQuat);

              const dot = Math.min(1, Math.abs(currentRelQuat.x * bindQ.x + currentRelQuat.y * bindQ.y + currentRelQuat.z * bindQ.z + currentRelQuat.w * bindQ.w));
              errorAngleDeg = (2 * Math.acos(dot) * 180) / Math.PI;
            }
          }
        }
      }

      // Torque estimate: Kd * ω (damping component dominates at high speed)
      const gains = PhysicsDiagnostic._BONE_PD_GAINS[canonical] ?? { stiffness: 100, damping: 10 };
      const estimatedTorqueMag = angularSpeed * gains.damping;
      const MAX_TORQUE = 15.0;
      const torqueClamped = estimatedTorqueMag > MAX_TORQUE;

      // Direction reversal detection
      const invSpeed = angularSpeed > 1e-4 ? 1 / angularSpeed : 0;
      const nx = av.x * invSpeed, ny = av.y * invSpeed, nz = av.z * invSpeed;
      const dot = nx * acc.prevTorqueDir.x + ny * acc.prevTorqueDir.y + nz * acc.prevTorqueDir.z;
      const isTorqueReversing = dot < -0.7;
      acc.prevTorqueDir = { x: nx, y: ny, z: nz };

      acc.samples.push({
        frame: this.frameCount,
        angularSpeed,
        angVelX: av.x,
        angVelY: av.y,
        angVelZ: av.z,
        torqueMag: estimatedTorqueMag,
        torqueClamped,
        errorAngleDeg,
        isTorqueReversing,
      });
    });
  }

  private _buildReport(): DiagnosticReport | null {
    if (this.frameCount === 0) return null;
    const ms = performance.now() - this.startTime;

    // --- CAPSULE SUMMARY ---
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
      // 3 axes → divide total sign changes by 3 for per-bone rate
      const oscillationsPerSec = (acc.signChanges / 3) / (ms / 1000);

      let verdict: BoneSummary['verdict'];
      if (avgAngularSpeed > 8 || oscillationsPerSec > 15) verdict = 'CRITICAL';
      else if (avgAngularSpeed > 2 || oscillationsPerSec > 5) verdict = 'JITTER';
      else if (avgAngularSpeed > 0.5 || oscillationsPerSec > 1) verdict = 'WATCH';
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
    a.download = `synthia_diag_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._log('Full report JSON auto-downloaded.');
  }
}

// ─── Global window handle ─────────────────────────────────────────────────────

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

/**
 * Install the diagnostic handle on `window.__SYNTHIA_DIAG__`.
 * Call this right after HumanoidMultiBodyManager is created.
 *
 * Example — in HumanoidPhysicsBinder.ts:
 *   import { installDiagnostic, PhysicsDiagnostic } from './PhysicsDiagnostic';
 *   import { BONE_PD_GAINS } from './HumanoidMultiBodyManager'; // or export it
 *
 *   PhysicsDiagnostic.setBonePDGains(BONE_PD_GAINS);
 *   installDiagnostic(this.multiBodyManager!);
 */
export function installDiagnostic(manager: HumanoidMultiBodyManager): void {
  const diag = new PhysicsDiagnostic(manager);
  window.__SYNTHIA_DIAG__ = {
    start: (frames) => diag.start(frames),
    stop: () => diag.stop(),
    report: () => diag.report(),
    _instance: diag,
  };
  console.log('[DIAG] Diagnostic ready. Commands:');
  console.log('[DIAG]   window.__SYNTHIA_DIAG__.start(300)  — sample 300 frames');
  console.log('[DIAG]   window.__SYNTHIA_DIAG__.stop()      — stop & export JSON');
  console.log('[DIAG]   window.__SYNTHIA_DIAG__.report()    — print live table');
}
