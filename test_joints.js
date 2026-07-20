/**
 * Synthia Joint Controllability Test — Diagnostic V3
 *
 * Three levels of testing to isolate exactly where the pipeline breaks:
 *   1. diag()              — check system state
 *   2. testDirectTorque()  — bypass everything, addTorque directly
 *   3. testDirectSetTargets() — bypass event system, inject into currentTargets
 *   4. testAllJoints()     — full event pipeline test
 *
 * USAGE: Paste into browser console while Synthia world is running.
 */

(function () {
  'use strict';

  const DEG = Math.PI / 180;
  const TEST_ANGLE = 30 * DEG;
  const MIN_MOVE = 2 * DEG;
  const FRAME_MS = 1000 / 60;

  const BONE_JOINT_TYPE = {
    'mixamorigspine':           'spherical',
    'mixamorigneck':            'spherical',
    'mixamorighead':            'spherical',
    'mixamorigleftarm':         'spherical',
    'mixamorigrightarm':        'spherical',
    'mixamorigleftforearm':     'revolute',
    'mixamorigrightforearm':    'revolute',
    'mixamoriglefthand':        'spherical',
    'mixamorigrighthand':       'spherical',
    'mixamorigleftupleg':       'spherical',
    'mixamorigrightupleg':      'spherical',
    'mixamorigleftleg':         'revolute',
    'mixamorigrightleg':        'revolute',
    'mixamorigleftfoot':        'spherical',
    'mixamorigrightfoot':       'spherical',
  };

  function getBinder() {
    const b = window.__SYNTHIA_HUMANOID_BINDER__;
    if (!b) throw new Error('__SYNTHIA_HUMANOID_BINDER__ not found');
    return b;
  }

  function getMBManager() {
    const b = getBinder();
    const mb = b.getMultiBodyManager();
    if (!mb) throw new Error('Multi-body manager is null');
    return mb;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function sendTarget(jointOverrides) {
    window.dispatchEvent(new CustomEvent('synthia:action', {
      detail: { jointOverrides, programSequence: [] }
    }));
  }

  function sendReset() {
    window.dispatchEvent(new CustomEvent('synthia:resetPose'));
  }

  function quatAngleDelta(q1, q2) {
    const dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
    return 2 * Math.acos(Math.min(1, Math.max(-1, Math.abs(dot))));
  }

  // ── 1. DIAGNOSTICS ──────────────────────────────────────────────────
  function diag() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Synthia Joint System Diagnostics');
    console.log('═══════════════════════════════════════════════════════════');

    const binder = getBinder();
    const d = binder.getDiagnostics();
    console.log('  Binder:', d);

    if (!d.mbActive) {
      console.error('  FAIL: Multi-body is NOT active');
      return;
    }

    const mb = getMBManager();
    console.log('  MB isActive:', mb.getIsActive());
    console.log('  MB bone count:', mb.getBoneCount());
    console.log('  MB motor count:', mb.getMotorController().getJointCount());

    const rbMap = mb.getRigidBodiesMap();
    console.log('  RB map size:', rbMap.size);
    console.log('  RB keys:', Array.from(rbMap.keys()).join(', '));

    const capsule = mb.getCapsuleBody();
    if (capsule?.isValid()) {
      const t = capsule.translation();
      const r = capsule.rotation();
      const av = capsule.angvel();
      console.log(`  Capsule: pos(${t.x.toFixed(3)},${t.y.toFixed(3)},${t.z.toFixed(3)}) rot(${r.x.toFixed(3)},${r.y.toFixed(3)},${r.z.toFixed(3)},${r.w.toFixed(3)}) angvel(${av.x.toFixed(3)},${av.y.toFixed(3)},${av.z.toFixed(3)})`);
    }

    for (const bone of Object.keys(BONE_JOINT_TYPE)) {
      const rb = rbMap.get(bone);
      if (rb?.isValid()) {
        const r = rb.rotation();
        const av = rb.angvel();
        console.log(`  ${bone}: rot(${r.x.toFixed(4)},${r.y.toFixed(4)},${r.z.toFixed(4)},${r.w.toFixed(4)}) angvel(${av.x.toFixed(4)},${av.y.toFixed(4)},${av.z.toFixed(4)}) dynamic=${rb.isDynamic()}`);
      } else {
        console.warn(`  ${bone}: NO RIGID BODY`);
      }
    }

    // Check currentTargets
    const ct = binder['currentTargets'];
    console.log('  currentTargets size:', ct?.size);
    if (ct) {
      for (const [k, v] of ct) console.log(`    ${k}:`, JSON.stringify(v));
    }

    console.log('  buildStep:', d.buildStep);
    console.log('═══════════════════════════════════════════════════════════');
  }

  // ── 2. DIRECT TORQUE (bypass everything) ─────────────────────────────
  async function testDirectTorque() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Level 1: Direct Torque Test (bypass ALL systems)');
    console.log('═══════════════════════════════════════════════════════════');

    sendReset();
    await sleep(500);

    const mb = getMBManager();
    const rb = mb.getRigidBodiesMap().get('mixamorigspine');
    if (!rb?.isValid()) { console.error('  Spine RB not found'); return; }

    const b0 = rb.rotation();
    console.log('  Before:', `(${b0.x.toFixed(4)},${b0.y.toFixed(4)},${b0.z.toFixed(4)},${b0.w.toFixed(4)})`);
    console.log('  isDynamic:', rb.isDynamic());

    // Apply strong torque for 60 frames (1 second)
    console.log('  Adding torque {x:100,y:0,z:0} for 60 frames...');
    for (let i = 0; i < 60; i++) {
      rb.addTorque({ x: 100, y: 0, z: 0 }, true);
      await sleep(FRAME_MS);
    }

    const b1 = rb.rotation();
    const delta = quatAngleDelta(b0, b1);
    console.log('  After:', `(${b1.x.toFixed(4)},${b1.y.toFixed(4)},${b1.z.toFixed(4)},${b1.w.toFixed(4)})`);
    console.log(`  Delta: ${(delta * 180 / Math.PI).toFixed(2)}°`);

    if (delta < MIN_MOVE) {
      console.error('  FAIL: Direct torque did NOT move the rigid body');
      console.error('  Possible causes: body not dynamic, world not stepping, body frozen');
    } else {
      console.log('  PASS: Direct torque moved the rigid body');
    }

    sendReset();
    console.log('═══════════════════════════════════════════════════════════');
  }

  // ── 3. DIRECT setTargets INJECTION ───────────────────────────────────
  async function testDirectSetTargets() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Level 2: Direct setTargets Test (bypass event system)');
    console.log('═══════════════════════════════════════════════════════════');

    sendReset();
    await sleep(500);

    const mb = getMBManager();
    const rb = mb.getRigidBodiesMap().get('mixamorigspine');
    if (!rb?.isValid()) { console.error('  Spine RB not found'); return; }

    const b0 = rb.rotation();
    console.log('  Before:', `(${b0.x.toFixed(4)},${b0.y.toFixed(4)},${b0.z.toFixed(4)},${b0.w.toFixed(4)})`);

    // Inject target directly into multi-body manager's setTargets
    const testTargets = new Map();
    testTargets.set('mixamorigspine', { x: TEST_ANGLE, y: 0, z: 0, isQuaternion: false });

    console.log('  Calling mb.setTargets() directly for 60 frames...');
    for (let i = 0; i < 60; i++) {
      mb.setTargets(testTargets);
      await sleep(FRAME_MS);
    }

    const b1 = rb.rotation();
    const delta = quatAngleDelta(b0, b1);
    console.log('  After:', `(${b1.x.toFixed(4)},${b1.y.toFixed(4)},${b1.z.toFixed(4)},${b1.w.toFixed(4)})`);
    console.log(`  Delta: ${(delta * 180 / Math.PI).toFixed(2)}°`);

    if (delta < MIN_MOVE) {
      console.error('  FAIL: setTargets did NOT produce movement');
      console.error('  Issue is in PD torque computation or application');
    } else {
      console.log('  PASS: setTargets moved the rigid body');
    }

    // Now test: does the PD torque hold? Stop applying, check if it drifts back
    console.log('  Stopping PD — checking if body holds position for 60 frames...');
    const b2 = rb.rotation();
    await sleep(60 * FRAME_MS);
    const b3 = rb.rotation();
    const drift = quatAngleDelta(b2, b3);
    console.log(`  Drift after stopping PD: ${(drift * 180 / Math.PI).toFixed(2)}°`);

    sendReset();
    console.log('═══════════════════════════════════════════════════════════');
  }

  // ── 4. EVENT PIPELINE TEST ──────────────────────────────────────────
  async function testAllJoints() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Level 3: Full Event Pipeline Test');
    console.log('═══════════════════════════════════════════════════════════');

    sendReset();
    await sleep(500);

    const mb = getMBManager();
    const rbMap = mb.getRigidBodiesMap();
    const results = [];

    for (const boneName of Object.keys(BONE_JOINT_TYPE)) {
      const rb = rbMap.get(boneName);
      if (!rb?.isValid()) {
        results.push({ bone: boneName, status: 'SKIP', reason: 'no RB' });
        continue;
      }

      const b0 = rb.rotation();

      const overrides = {};
      overrides[boneName] = TEST_ANGLE;
      sendTarget(overrides);

      await sleep(500);

      const b1 = rb.rotation();
      const delta = quatAngleDelta(b0, b1);
      const passed = delta >= MIN_MOVE;
      results.push({
        bone: boneName,
        type: BONE_JOINT_TYPE[boneName],
        delta_deg: (delta * 180 / Math.PI).toFixed(1),
        status: passed ? 'PASS' : 'FAIL',
      });

      const icon = passed ? '✓' : '✗';
      console.log(`${icon} ${boneName} (${BONE_JOINT_TYPE[boneName]}): ${results[results.length-1].delta_deg}°`);

      // Reset between joints
      sendReset();
      await sleep(300);
    }

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const skipped = results.filter(r => r.status === 'SKIP').length;
    console.log(`\n  RESULTS: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);

    sendReset();
    return results;
  }

  window.diag = diag;
  window.testDirectTorque = testDirectTorque;
  window.testDirectSetTargets = testDirectSetTargets;
  window.testAllJoints = testAllJoints;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Synthia Joint Test V3 Loaded');
  console.log('');
  console.log('  Run in order to isolate the issue:');
  console.log('  1. diag()                — check system state');
  console.log('  2. testDirectTorque()    — can Rapier move bones at all?');
  console.log('  3. testDirectSetTargets() — does PD compute correctly?');
  console.log('  4. testAllJoints()       — does the full event pipeline work?');
  console.log('═══════════════════════════════════════════════════════════');
})();
