/**
 * Synthia Deep Physics Diagnostics
 *
 * Samples physics state every frame for 5 seconds and outputs a structured
 * dump showing exactly what's happening with the capsule, bones, PD controllers,
 * balance controller, and collision state.
 *
 * USAGE: Paste into browser console while Synthia world is running.
 *
 * COMMANDS:
 *   diagRun()       — run 5-second diagnostic, print full report
 *   diagSnapshot()  — single-frame physics state dump
 *   diagTrack()     — continuous tracking (prints every 30 frames)
 *   diagStop()      — stop continuous tracking
 */

(function () {
  'use strict';

  const DEG = Math.PI / 180;
  const FRAME_MS = 1000 / 60;
  const DURATION_MS = 5000;

  let _intervalId = null;
  let _activeTimeouts = [];

  // ── Utilities ──────────────────────────────────────────────────────────

  function getBinder() {
    const b = window.__SYNTHIA_HUMANOID_BINDER__;
    if (!b) throw new Error('__SYNTHIA_HUMANOID_BINDER__ not found');
    return b;
  }

  function getMBManager() {
    const mb = getBinder().getMultiBodyManager();
    if (!mb) throw new Error('Multi-body manager is null');
    return mb;
  }

  function sleep(ms) {
    return new Promise(resolve => {
      const t = setTimeout(resolve, ms);
      _activeTimeouts.push(t);
    });
  }

  function quatAngleDelta(q1, q2) {
    const dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
    return 2 * Math.acos(Math.min(1, Math.max(-1, Math.abs(dot))));
  }

  function vecMag(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  function sendReset() {
    window.dispatchEvent(new CustomEvent('synthia:resetPose'));
  }

  // ── BONE_JOINT_TYPE (must match HumanoidMultiBodyManager) ──────────────

  const BONE_NAMES = [
    'mixamorigspine', 'mixamorigneck', 'mixamorighead',
    'mixamorigleftarm', 'mixamorigrightarm',
    'mixamorigleftforearm', 'mixamorigrightforearm',
    'mixamoriglefthand', 'mixamorigrighthand',
    'mixamorigleftupleg', 'mixamorigrightupleg',
    'mixamorigleftleg', 'mixamorigrightleg',
    'mixamorigleftfoot', 'mixamorigrightfoot',
  ];

  const JOINT_TYPES = {
    mixamorigspine: 'spherical', mixamorigneck: 'spherical', mixamorighead: 'spherical',
    mixamorigleftarm: 'spherical', mixamorigrightarm: 'spherical',
    mixamorigleftforearm: 'revolute', mixamorigrightforearm: 'revolute',
    mixamoriglefthand: 'spherical', mixamorigrighthand: 'spherical',
    mixamorigleftupleg: 'spherical', mixamorigrightupleg: 'spherical',
    mixamorigleftleg: 'revolute', mixamorigrightleg: 'revolute',
    mixamorigleftfoot: 'spherical', mixamorigrightfoot: 'spherical',
  };

  // ── Frame sampler ──────────────────────────────────────────────────────

  function sampleFrame() {
    const binder = getBinder();
    const mb = getMBManager();
    const rbMap = mb.getRigidBodiesMap();
    const capsule = mb.getCapsuleBody();

    const frame = {
      timestamp: Date.now(),
      capsule: null,
      balance: null,
      bones: [],
      softStart: null,
    };

    // ── Capsule state ──
    if (capsule && capsule.isValid()) {
      const t = capsule.translation();
      const v = capsule.linvel();
      const av = capsule.angvel();
      const r = capsule.rotation();

      // Check ground collision
      let collisionCount = 0;
      try {
        const world = mb.getWorld ? mb.getWorld() : null;
        if (world) {
          const collider = mb.getCapsuleCollider ? mb.getCapsuleCollider() : null;
          if (collider && collider.isValid()) {
            const contacts = world.contactPairsWith(collider);
            collisionCount = Array.isArray(contacts) ? contacts.length : 0;
          }
        }
      } catch (e) { /* ignore */ }

      // Compute mass and inertia
      let mass = 0;
      try { mass = capsule.mass(); } catch (e) { /* ignore */ }

      frame.capsule = {
        pos: { x: t.x, y: t.y, z: t.z },
        vel: { x: v.x, y: v.y, z: v.z },
        angVel: { x: av.x, y: av.y, z: av.z },
        rot: { x: r.x, y: r.y, z: r.z, w: r.w },
        mass: mass,
        collisions: collisionCount,
        isDynamic: capsule.isDynamic(),
      };
    }

    // ── Balance controller state ──
    try {
      // Access private fields via binder diagnostics
      const diag = binder.getDiagnostics ? binder.getDiagnostics() : {};
      frame.balance = {
        mbActive: diag.mbActive || false,
        buildStep: diag.buildStep || 'unknown',
      };
    } catch (e) {
      frame.balance = { error: e.message };
    }

    // ── Soft-start state ──
    try {
      // Try to access via binder internal state
      const ct = binder['currentTargets'];
      frame.softStart = {
        currentTargetsSize: ct ? ct.size : 0,
      };
    } catch (e) {
      frame.softStart = { error: e.message };
    }

    // ── Per-bone state ──
    for (const boneName of BONE_NAMES) {
      const rb = rbMap.get(boneName);
      if (!rb || !rb.isValid()) {
        frame.bones.push({ name: boneName, status: 'NO_RB' });
        continue;
      }

      const t = rb.translation();
      const v = rb.linvel();
      const av = rb.angvel();
      const r = rb.rotation();

      // Joint type
      const jointType = JOINT_TYPES[boneName] || 'spherical';

      // Angular velocity magnitude
      const angVelMag = vecMag(av);

      // Linear velocity magnitude
      const linVelMag = vecMag(v);

      frame.bones.push({
        name: boneName,
        type: jointType,
        pos: { x: t.x, y: t.y, z: t.z },
        vel: { x: v.x, y: v.y, z: v.z },
        linVelMag: linVelMag,
        angVel: { x: av.x, y: av.y, z: av.z },
        angVelMag: angVelMag,
        rot: { x: r.x, y: r.y, z: r.z, w: r.w },
        isDynamic: rb.isDynamic(),
      });
    }

    return frame;
  }

  // ── Report printer ─────────────────────────────────────────────────────

  function printFrameReport(frame, frameNum) {
    const c = frame.capsule;
    const b = frame.balance;

    if (c) {
      console.log(`  Capsule: Y=${c.pos.y.toFixed(4)}  velY=${c.vel.y.toFixed(4)}  ` +
        `angVel=${vecMag(c.angVel).toFixed(3)} r/s  mass=${c.mass.toFixed(1)}kg  ` +
        `collisions=${c.collisions}  dynamic=${c.isDynamic}`);
    } else {
      console.log('  Capsule: NOT FOUND');
    }

    if (b) {
      console.log(`  Balance: mbActive=${b.mbActive}  buildStep=${b.buildStep}`);
    }

    // Per-bone table
    console.log('  ┌─────────────────────────┬──────┬───────────────┬──────────┬──────────┬──────────┐');
    console.log('  │ Bone                    │ Type │ Pos(y)        │ AngVel   │ LinVel   │ Dynamic  │');
    console.log('  ├─────────────────────────┼──────┼───────────────┼──────────┼──────────┼──────────┤');

    for (const bone of frame.bones) {
      if (bone.status === 'NO_RB') {
        console.log(`  │ ${bone.name.padEnd(23)} │ ---- │ NO RIGID BODY │          │          │          │`);
        continue;
      }
      const y = bone.pos.y.toFixed(3);
      const av = bone.angVelMag.toFixed(3);
      const lv = bone.linVelMag.toFixed(3);
      const dyn = bone.isDynamic ? 'Y' : 'N';
      console.log(`  │ ${bone.name.padEnd(23)} │ ${bone.type.substring(0, 4).padEnd(4)} │ ${y.padStart(13)} │ ${(av + ' r/s').padStart(8)} │ ${(lv + ' m/s').padStart(8)} │ ${dyn.padStart(8)} │`);
    }

    console.log('  └─────────────────────────┴──────┴───────────────┴──────────┴──────────┴──────────┘');
  }

  // ── Full 5-second run ──────────────────────────────────────────────────

  async function diagRun() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   Synthia Deep Physics Diagnostics                       ║');
    console.log('║   5 seconds @ 60fps = 300 frames                         ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    sendReset();
    await sleep(500);

    const frames = [];
    const startTime = Date.now();
    let frameCount = 0;

    await new Promise(resolve => {
      _intervalId = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= DURATION_MS) {
          clearInterval(_intervalId);
          _intervalId = null;
          resolve();
          return;
        }

        const frame = sampleFrame();
        frames.push(frame);
        frameCount++;

        // Print first 3 frames and last frame
        if (frameCount <= 3 || elapsed >= DURATION_MS - 100) {
          console.log(`\n── Frame ${frameCount} (${(elapsed / 1000).toFixed(1)}s) ──`);
          printFrameReport(frame, frameCount);
        }
      }, FRAME_MS);
    });

    // ── Summary analysis ──
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║   ANALYSIS SUMMARY                                       ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    // Capsule Y振幅
    const capsuleYs = frames.map(f => f.capsule?.pos.y).filter(y => y !== undefined && y !== null);
    if (capsuleYs.length > 0) {
      const minY = Math.min(...capsuleYs);
      const maxY = Math.max(...capsuleYs);
      const amp = maxY - minY;
      console.log(`  Capsule Y range: ${minY.toFixed(4)} - ${maxY.toFixed(4)} (振幅 ${(amp * 100).toFixed(1)} cm)`);
      console.log(`  Capsule Y start: ${capsuleYs[0].toFixed(4)}  end: ${capsuleYs[capsuleYs.length - 1].toFixed(4)}`);
    }

    // Capsule Y velocity振幅
    const capsuleVels = frames.map(f => f.capsule?.vel.y).filter(v => v !== undefined && v !== null);
    if (capsuleVels.length > 0) {
      const maxVel = Math.max(...capsuleVels.map(Math.abs));
      console.log(`  Capsule max |velY|: ${maxVel.toFixed(4)} m/s`);
    }

    // Capsule angular velocity
    const capsuleAngVels = frames.map(f => f.capsule ? vecMag(f.capsule.angVel) : 0);
    if (capsuleAngVels.length > 0) {
      const maxCAV = Math.max(...capsuleAngVels);
      console.log(`  Capsule max angVel: ${maxCAV.toFixed(3)} r/s`);
    }

    // Per-bone oscillation analysis
    console.log('\n  Per-bone angular velocity stats:');
    for (const boneName of BONE_NAMES) {
      const boneAngVels = frames.map(f => {
        const bone = f.bones.find(b => b.name === boneName);
        return bone && bone.angVelMag !== undefined ? bone.angVelMag : 0;
      });

      const maxAV = Math.max(...boneAngVels);
      const avgAV = boneAngVels.reduce((a, b) => a + b, 0) / boneAngVels.length;

      if (maxAV > 0.01) {
        const marker = maxAV > 10 ? ' ⚠ HIGH' : maxAV > 2 ? ' ~moderate' : '';
        console.log(`    ${boneName}: max=${maxAV.toFixed(3)} avg=${avgAV.toFixed(3)} r/s${marker}`);
      }
    }

    // Per-bone linear velocity (ground penetration check)
    console.log('\n  Per-bone max linear velocity (penetration indicator):');
    for (const boneName of BONE_NAMES) {
      const boneLVels = frames.map(f => {
        const bone = f.bones.find(b => b.name === boneName);
        return bone && bone.linVelMag !== undefined ? bone.linVelMag : 0;
      });

      const maxLV = Math.max(...boneLVels);
      if (maxLV > 0.1) {
        console.log(`    ${boneName}: max=${maxLV.toFixed(3)} m/s ⚠`);
      }
    }

    // Ground contact check
    const groundContacts = frames.filter(f => f.capsule && f.capsule.collisions > 0).length;
    console.log(`\n  Ground contact: ${groundContacts}/${frames.length} frames (${(groundContacts / frames.length * 100).toFixed(0)}%)`);

    // Dynamic body check
    const nonDynamic = frames.flatMap(f => f.bones.filter(b => b.status !== 'NO_RB' && !b.isDynamic));
    if (nonDynamic.length > 0) {
      console.log(`  ⚠ Non-dynamic bones found: ${[...new Set(nonDynamic.map(b => b.name))].join(', ')}`);
    }

    // Stability verdict
    const maxBoneAV = Math.max(...frames.flatMap(f => f.bones.map(b => b.angVelMag || 0)));
    const capsuleAmp = capsuleYs.length > 0 ? Math.max(...capsuleYs) - Math.min(...capsuleYs) : 0;
    const minCapsuleY = capsuleYs.length > 0 ? Math.min(...capsuleYs) : Infinity;

    // Structural failure: capsule dropped below standing height
    const capsuleBelowStanding = minCapsuleY < 0.7;

    // Hierarchical inversion: head folded below spine (skeletal collapse)
    const hierarchicalInversion = frames.some(f => {
      const head = f.bones.find(b => b.name === 'mixamorighead');
      const spine = f.bones.find(b => b.name === 'mixamorigspine');
      if (!head || !spine) return false;
      return head.pos.y < spine.pos.y;
    });

    const unstable = maxBoneAV > 20 || capsuleAmp > 0.1 || capsuleBelowStanding || hierarchicalInversion;
    console.log(`\n  Verdict: ${unstable ? '⚠ UNSTABLE' : '✓ STABLE'}`);
    if (unstable) {
      if (maxBoneAV > 20) console.log(`    Reason: bone angVel ${maxBoneAV.toFixed(1)} r/s exceeds 20 r/s threshold`);
      if (capsuleAmp > 0.1) console.log(`    Reason: capsule Y振幅 ${(capsuleAmp * 100).toFixed(1)} cm exceeds 10cm threshold`);
      if (capsuleBelowStanding) console.log(`    Reason: capsule Y dropped to ${minCapsuleY.toFixed(3)}m (below 0.7m standing threshold)`);
      if (hierarchicalInversion) console.log(`    Reason: skeletal hierarchy inversion detected (head below spine)`);
    }

    console.log('═══════════════════════════════════════════════════════════');

    sendReset();
    return frames;
  }

  // ── Single snapshot ────────────────────────────────────────────────────

  function diagSnapshot() {
    console.log('═══ Single Frame Snapshot ═══');
    const frame = sampleFrame();
    printFrameReport(frame, 0);
    return frame;
  }

  // ── Continuous tracking ────────────────────────────────────────────────

  let _trackFrameCount = 0;

  function diagTrack() {
    diagStop();
    _trackFrameCount = 0;
    console.log('[DIAG] Continuous tracking started. diagStop() to stop.');

    _intervalId = setInterval(() => {
      _trackFrameCount++;
      if (_trackFrameCount % 30 === 0) {
        const frame = sampleFrame();
        const c = frame.capsule;
        if (c) {
          console.log(`[DIAG] Frame ${_trackFrameCount}: Capsule Y=${c.pos.y.toFixed(4)} velY=${c.vel.y.toFixed(4)} collisions=${c.collisions}`);
        }
      }
    }, FRAME_MS);
  }

  function diagStop() {
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
    for (const t of _activeTimeouts) clearTimeout(t);
    _activeTimeouts = [];
    console.log('[DIAG] Stopped.');
  }

  // ── Expose to window ───────────────────────────────────────────────────

  window.diagRun = diagRun;
  window.diagSnapshot = diagSnapshot;
  window.diagTrack = diagTrack;
  window.diagStop = diagStop;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Synthia Deep Diagnostics Loaded');
  console.log('');
  console.log('  diagRun()       — 5-second full diagnostic dump');
  console.log('  diagSnapshot()  — single-frame physics state');
  console.log('  diagTrack()     — continuous tracking (every 30 frames)');
  console.log('  diagStop()      — stop tracking');
  console.log('═══════════════════════════════════════════════════════════');
})();
