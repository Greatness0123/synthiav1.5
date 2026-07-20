/**
 * Synthia Physics Stability Stress Test
 *
 * Stimulates joints with sinusoidal oscillation, rapid direction changes,
 * and multi-joint coordination to verify the ragdoll remains stable under
 * sustained dynamic loading.
 *
 * USAGE: Paste into browser console while Synthia world is running.
 *
 * COMMANDS:
 *   stabilityRun()        — run full stability test suite (~30s)
 *   stabilityOscillate()  — continuous sinusoidal joint oscillation
 *   stabilityWave()       — wave motion across all joints
 *   stabilitySquat()      — repeated squat-stand cycle
 *   stabilityFlail()      — rapid random joint perturbations
 *   stabilityStop()       — stop any running test and reset
 */

(function () {
  'use strict';

  const DEG = Math.PI / 180;
  const FRAME_MS = 1000 / 60;

  // ── Joint definitions with anatomical ranges ──────────────────────────
  const JOINTS = {
    mixamorigspine:        { type: 'spherical', range: 30 * DEG,  axis: 'x' },
    mixamorigneck:         { type: 'spherical', range: 40 * DEG,  axis: 'x' },
    mixamorighead:         { type: 'spherical', range: 30 * DEG,  axis: 'x' },
    mixamorigleftarm:      { type: 'spherical', range: 60 * DEG,  axis: 'z' },
    mixamorigrightarm:     { type: 'spherical', range: 60 * DEG,  axis: 'z' },
    mixamorigleftforearm:  { type: 'revolute',  range: 120 * DEG, axis: 'x' },
    mixamorigrightforearm: { type: 'revolute',  range: 120 * DEG, axis: 'x' },
    mixamoriglefthand:     { type: 'spherical', range: 40 * DEG,  axis: 'x' },
    mixamorigrighthand:    { type: 'spherical', range: 40 * DEG,  axis: 'x' },
    mixamorigleftupleg:    { type: 'spherical', range: 60 * DEG,  axis: 'x' },
    mixamorigrightupleg:   { type: 'spherical', range: 60 * DEG,  axis: 'x' },
    mixamorigleftleg:      { type: 'revolute',  range: 120 * DEG, axis: 'x' },
    mixamorigrightleg:     { type: 'revolute',  range: 120 * DEG, axis: 'x' },
    mixamorigleftfoot:     { type: 'spherical', range: 30 * DEG,  axis: 'x' },
    mixamorigrightfoot:    { type: 'spherical', range: 30 * DEG,  axis: 'x' },
  };

  let _activeInterval = null;
  let _activeTimeouts = [];
  let _testRunning = false;

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

  function stopAll() {
    if (_activeInterval !== null) {
      clearInterval(_activeInterval);
      _activeInterval = null;
    }
    for (const t of _activeTimeouts) clearTimeout(t);
    _activeTimeouts = [];
    _testRunning = false;
  }

  function sendTargets(overrides) {
    window.dispatchEvent(new CustomEvent('synthia:action', {
      detail: { jointOverrides: overrides, programSequence: [] }
    }));
  }

  function sendReset() {
    window.dispatchEvent(new CustomEvent('synthia:resetPose'));
  }

  function quatAngleDelta(q1, q2) {
    const dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
    return 2 * Math.acos(Math.min(1, Math.max(-1, Math.abs(dot))));
  }

  function getBoneAngVel(boneName) {
    const rb = getMBManager().getRigidBodiesMap().get(boneName);
    if (!rb || !rb.isValid()) return null;
    const av = rb.angvel();
    return Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);
  }

  function getBoneRotation(boneName) {
    const rb = getMBManager().getRigidBodiesMap().get(boneName);
    if (!rb || !rb.isValid()) return null;
    return rb.rotation();
  }

  function getCapsulePos() {
    const capsule = getMBManager().getCapsuleBody();
    if (!capsule || !capsule.isValid()) return null;
    return capsule.translation();
  }

  function getCapsuleAngleVel() {
    const capsule = getMBManager().getCapsuleBody();
    if (!capsule || !capsule.isValid()) return null;
    const av = capsule.angvel();
    return Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);
  }

  // ── Metric collector ───────────────────────────────────────────────────

  function createMetrics() {
    return {
      maxAngVel: 0,
      maxCapsuleAngVel: 0,
      maxDeltaFromRest: 0,
      sampleCount: 0,
      jitterSamples: [],
      prevRotations: new Map(),
    };
  }

  function sampleMetrics(metrics) {
    metrics.sampleCount++;

    // Per-bone angular velocity
    for (const name of Object.keys(JOINTS)) {
      const av = getBoneAngVel(name);
      if (av !== null && av > metrics.maxAngVel) {
        metrics.maxAngVel = av;
      }
    }

    // Capsule angular velocity
    const cav = getCapsuleAngleVel();
    if (cav !== null && cav > metrics.maxCapsuleAngVel) {
      metrics.maxCapsuleAngVel = cav;
    }

    // Jitter detection: frame-to-frame rotation delta
    for (const name of Object.keys(JOINTS)) {
      const rot = getBoneRotation(name);
      if (!rot) continue;
      const prev = metrics.prevRotations.get(name);
      if (prev) {
        const delta = quatAngleDelta(prev, rot);
        metrics.jitterSamples.push(delta);
      }
      metrics.prevRotations.set(name, { x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    }
  }

  function reportMetrics(metrics, label) {
    const jitterSorted = [...metrics.jitterSamples].sort((a, b) => a - b);
    const p50 = jitterSorted[Math.floor(jitterSorted.length * 0.5)] || 0;
    const p95 = jitterSorted[Math.floor(jitterSorted.length * 0.95)] || 0;
    const p99 = jitterSorted[Math.floor(jitterSorted.length * 0.99)] || 0;
    const maxJitter = jitterSorted[jitterSorted.length - 1] || 0;

    console.log(`  ┌─ ${label} ─────────────────────────────────────`);
    console.log(`  │ Samples: ${metrics.sampleCount}`);
    console.log(`  │ Max bone angvel: ${metrics.maxAngVel.toFixed(2)} rad/s`);
    console.log(`  │ Max capsule angvel: ${metrics.maxCapsuleAngVel.toFixed(2)} rad/s`);
    console.log(`  │ Frame-to-frame jitter (rad):`);
    console.log(`  │   p50=${p50.toFixed(5)}  p95=${p95.toFixed(5)}  p99=${p99.toFixed(5)}  max=${maxJitter.toFixed(5)}`);
    console.log(`  │ Jitter max °/frame: ${(maxJitter * 180 / Math.PI).toFixed(3)}°`);

    // Stability verdict
    const unstable = maxJitter > 5 * DEG || metrics.maxAngVel > 50;
    console.log(`  │ Verdict: ${unstable ? '⚠ UNSTABLE' : '✓ STABLE'}`);
    console.log(`  └──────────────────────────────────────────────────`);
    return !unstable;
  }

  // ── Test 1: Single-joint sinusoidal oscillation ────────────────────────

  async function testSingleJointOscillation() {
    console.log('\n═══ Test 1: Single-Joint Sinusoidal Oscillation ═══');

    for (const [boneName, def] of Object.entries(JOINTS)) {
      sendReset();
      await sleep(400);

      const metrics = createMetrics();
      const amplitude = def.range * 0.7;
      const freq = 2.0; // Hz
      const duration = 2000; // ms
      const startTime = Date.now();

      await new Promise(resolve => {
        _activeInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          if (elapsed >= duration) {
            clearInterval(_activeInterval);
            _activeInterval = null;
            resolve();
            return;
          }
          const t = elapsed / 1000;
          const angle = amplitude * Math.sin(2 * Math.PI * freq * t);
          const overrides = {};
          overrides[boneName] = { x: def.axis === 'x' ? angle : 0, y: def.axis === 'y' ? angle : 0, z: def.axis === 'z' ? angle : 0 };
          sendTargets(overrides);
          sampleMetrics(metrics);
        }, FRAME_MS);
      });

      const stable = reportMetrics(metrics, `Single osc: ${boneName}`);
      if (!stable) {
        console.warn(`  ⚠ ${boneName} showed instability during oscillation`);
      }
    }
  }

  // ── Test 2: Bilateral arm wave (both arms simultaneously) ─────────────

  async function testBilateralWave() {
    console.log('\n═══ Test 2: Bilateral Arm Wave ═══');
    sendReset();
    await sleep(400);

    const metrics = createMetrics();
    const amplitude = 45 * DEG;
    const freq = 1.5;
    const duration = 3000;
    const startTime = Date.now();

    await new Promise(resolve => {
      _activeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) {
          clearInterval(_activeInterval);
          _activeInterval = null;
          resolve();
          return;
        }
        const t = elapsed / 1000;
        const angle = amplitude * Math.sin(2 * Math.PI * freq * t);
        sendTargets({
          mixamorigleftarm:  { x: 0, y: 0, z: angle },
          mixamorigrightarm: { x: 0, y: 0, z: -angle },
          mixamorigleftforearm:  { x: angle * 0.5 },
          mixamorigrightforearm: { x: -angle * 0.5 },
        });
        sampleMetrics(metrics);
      }, FRAME_MS);
    });

    reportMetrics(metrics, 'Bilateral arm wave');
  }

  // ── Test 3: Squat cycle (both legs + spine) ───────────────────────────

  async function testSquatCycle() {
    console.log('\n═══ Test 3: Squat Cycle ═══');
    sendReset();
    await sleep(400);

    const metrics = createMetrics();
    const freq = 0.8;
    const duration = 3000;
    const startTime = Date.now();

    await new Promise(resolve => {
      _activeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) {
          clearInterval(_activeInterval);
          _activeInterval = null;
          resolve();
          return;
        }
        const t = elapsed / 1000;
        const squat = Math.sin(2 * Math.PI * freq * t);
        sendTargets({
          mixamorigleftupleg:   { x: squat * -60 * DEG },
          mixamorigrightupleg:  { x: squat * -60 * DEG },
          mixamorigleftleg:     { x: squat * 80 * DEG },
          mixamorigrightleg:    { x: squat * 80 * DEG },
          mixamorigspine:       { x: squat * -15 * DEG },
          mixamorigleftfoot:    { x: squat * 20 * DEG },
          mixamorigrightfoot:   { x: squat * 20 * DEG },
        });
        sampleMetrics(metrics);
      }, FRAME_MS);
    });

    reportMetrics(metrics, 'Squat cycle');
  }

  // ── Test 4: Rapid direction reversal (impulse test) ───────────────────

  async function testRapidReversal() {
    console.log('\n═══ Test 4: Rapid Direction Reversal ═══');
    sendReset();
    await sleep(400);

    const metrics = createMetrics();
    const amplitude = 40 * DEG;
    const reversals = 10;
    const holdMs = 150;

    for (let i = 0; i < reversals; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      sendTargets({
        mixamorigleftarm:   { x: sign * amplitude, y: sign * amplitude * 0.5 },
        mixamorigrightarm:  { x: -sign * amplitude, y: -sign * amplitude * 0.5 },
        mixamorigleftleg:   { x: sign * amplitude },
        mixamorigrightleg:  { x: -sign * amplitude },
        mixamorigspine:     { z: sign * amplitude * 0.3 },
      });
      await sleep(holdMs);
      sampleMetrics(metrics);
    }

    reportMetrics(metrics, 'Rapid reversal');
  }

  // ── Test 5: Full-body wave (propagating sine) ─────────────────────────

  async function testFullBodyWave() {
    console.log('\n═══ Test 5: Full-Body Propagating Wave ═══');
    sendReset();
    await sleep(400);

    const metrics = createMetrics();
    const waveBones = [
      'mixamorigleftfoot', 'mixamorigleftleg', 'mixamorigleftupleg',
      'mixamorigspine',
      'mixamorigrightupleg', 'mixamorigrightleg', 'mixamorigrightfoot',
      'mixamorigleftarm', 'mixamorigleftforearm',
      'mixamorigrightarm', 'mixamorigrightforearm',
      'mixamorigneck', 'mixamorighead',
    ];

    const freq = 1.2;
    const duration = 3000;
    const startTime = Date.now();

    await new Promise(resolve => {
      _activeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) {
          clearInterval(_activeInterval);
          _activeInterval = null;
          resolve();
          return;
        }
        const t = elapsed / 1000;
        const overrides = {};
        waveBones.forEach((bone, i) => {
          const phase = (i / waveBones.length) * 2 * Math.PI;
          const angle = 30 * DEG * Math.sin(2 * Math.PI * freq * t + phase);
          overrides[bone] = { x: angle };
        });
        sendTargets(overrides);
        sampleMetrics(metrics);
      }, FRAME_MS);
    });

    reportMetrics(metrics, 'Full-body wave');
  }

  // ── Test 6: Endurance hold (sustained pose for 5s) ────────────────────

  async function testEnduranceHold() {
    console.log('\n═══ Test 6: Endurance Hold (5s sustained pose) ═══');
    sendReset();
    await sleep(400);

    // Set a challenging pose: one arm up, one leg forward, leaning
    sendTargets({
      mixamorigleftarm:    { x: -90 * DEG, y: 0, z: 0 },
      mixamorigrightarm:   { x: 0, y: 0, z: -60 * DEG },
      mixamorigleftupleg:  { x: -45 * DEG },
      mixamorigrightleg:   { x: 30 * DEG },
      mixamorigspine:      { x: 10 * DEG, z: -10 * DEG },
      mixamorigneck:       { x: -15 * DEG },
    });

    const metrics = createMetrics();
    const duration = 5000;
    const startTime = Date.now();

    await new Promise(resolve => {
      _activeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) {
          clearInterval(_activeInterval);
          _activeInterval = null;
          resolve();
          return;
        }
        // Keep sending the same target to maintain the pose
        sendTargets({
          mixamorigleftarm:    { x: -90 * DEG, y: 0, z: 0 },
          mixamorigrightarm:   { x: 0, y: 0, z: -60 * DEG },
          mixamorigleftupleg:  { x: -45 * DEG },
          mixamorigrightleg:   { x: 30 * DEG },
          mixamorigspine:      { x: 10 * DEG, z: -10 * DEG },
          mixamorigneck:       { x: -15 * DEG },
        });
        sampleMetrics(metrics);

        // Track drift from initial capsule position
        const pos = getCapsulePos();
        if (pos && metrics.sampleCount === 1) {
          metrics._initPos = { x: pos.x, y: pos.y, z: pos.z };
        }
        if (pos && metrics._initPos) {
          const drift = Math.sqrt(
            (pos.x - metrics._initPos.x) ** 2 +
            (pos.y - metrics._initPos.y) ** 2 +
            (pos.z - metrics._initPos.z) ** 2
          );
          if (drift > metrics.maxDeltaFromRest) metrics.maxDeltaFromRest = drift;
        }
      }, FRAME_MS);
    });

    const stable = reportMetrics(metrics, 'Endurance hold');
    console.log(`  │ Capsule drift: ${(metrics.maxDeltaFromRest * 100).toFixed(1)} cm`);
  }

  // ── Test 7: Chaos mode (all joints random) ────────────────────────────

  async function testChaos() {
    console.log('\n═══ Test 7: Chaos Mode (random perturbations) ═══');
    sendReset();
    await sleep(400);

    const metrics = createMetrics();
    const duration = 3000;
    const startTime = Date.now();

    await new Promise(resolve => {
      _activeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) {
          clearInterval(_activeInterval);
          _activeInterval = null;
          resolve();
          return;
        }
        const overrides = {};
        for (const [boneName, def] of Object.entries(JOINTS)) {
          // Random angle within 50% of range, changing every frame
          const angle = (Math.random() - 0.5) * 2 * def.range * 0.5;
          overrides[boneName] = { x: angle, y: angle * 0.3, z: angle * 0.2 };
        }
        sendTargets(overrides);
        sampleMetrics(metrics);
      }, FRAME_MS);
    });

    reportMetrics(metrics, 'Chaos mode');
  }

  // ── Full suite runner ──────────────────────────────────────────────────

  async function stabilityRun() {
    if (_testRunning) {
      console.warn('Test already running. Call stabilityStop() first.');
      return;
    }
    _testRunning = true;

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   Synthia Physics Stability Stress Test                  ║');
    console.log('║   7 tests, ~30 seconds total                            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    const startTime = Date.now();
    let passed = 0;
    let failed = 0;

    const tests = [
      testSingleJointOscillation,
      testBilateralWave,
      testSquatCycle,
      testRapidReversal,
      testFullBodyWave,
      testEnduranceHold,
      testChaos,
    ];

    for (const test of tests) {
      if (!_testRunning) break;
      try {
        await test();
        passed++;
      } catch (e) {
        console.error(`  ✗ Test failed: ${e.message}`);
        failed++;
      }
      await sleep(300);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║   RESULTS: ${passed} passed, ${failed} failed (${elapsed}s)`);
    console.log(`╚═══════════════════════════════════════════════════════════╝`);

    sendReset();
    _testRunning = false;
  }

  // ── Continuous oscillation (manual control) ────────────────────────────

  function stabilityOscillate(boneName, axis, amplitude, freq) {
    stabilityStop();
    boneName = boneName || 'mixamorigleftarm';
    axis = axis || 'z';
    amplitude = (amplitude || 45) * DEG;
    freq = freq || 2.0;

    console.log(`[OSC] ${boneName} axis=${axis} amp=${(amplitude / DEG).toFixed(0)}° freq=${freq}Hz`);

    _activeInterval = setInterval(() => {
      const t = Date.now() / 1000;
      const angle = amplitude * Math.sin(2 * Math.PI * freq * t);
      const overrides = {};
      overrides[boneName] = { [axis]: angle };
      sendTargets(overrides);
    }, FRAME_MS);
  }

  // ── Wave motion (manual control) ───────────────────────────────────────

  function stabilityWave(freq) {
    stabilityStop();
    freq = freq || 1.0;

    const bones = Object.keys(JOINTS);
    console.log(`[WAVE] ${bones.length} joints, freq=${freq}Hz`);

    _activeInterval = setInterval(() => {
      const t = Date.now() / 1000;
      const overrides = {};
      bones.forEach((bone, i) => {
        const phase = (i / bones.length) * 2 * Math.PI;
        const angle = JOINTS[bone].range * 0.5 * Math.sin(2 * Math.PI * freq * t + phase);
        overrides[bone] = { x: angle };
      });
      sendTargets(overrides);
    }, FRAME_MS);
  }

  // ── Squat cycle (manual control) ───────────────────────────────────────

  function stabilitySquat(freq) {
    stabilityStop();
    freq = freq || 0.8;

    console.log(`[SQUAT] freq=${freq}Hz`);

    _activeInterval = setInterval(() => {
      const t = Date.now() / 1000;
      const squat = Math.sin(2 * Math.PI * freq * t);
      sendTargets({
        mixamorigleftupleg:   { x: squat * -60 * DEG },
        mixamorigrightupleg:  { x: squat * -60 * DEG },
        mixamorigleftleg:     { x: squat * 80 * DEG },
        mixamorigrightleg:    { x: squat * 80 * DEG },
        mixamorigspine:       { x: squat * -15 * DEG },
        mixamorigleftfoot:    { x: squat * 20 * DEG },
        mixamorigrightfoot:   { x: squat * 20 * DEG },
      });
    }, FRAME_MS);
  }

  // ── Chaos flail (manual control) ───────────────────────────────────────

  function stabilityFlail() {
    stabilityStop();
    console.log('[FLAIL] Random perturbations active');

    _activeInterval = setInterval(() => {
      const overrides = {};
      for (const [boneName, def] of Object.entries(JOINTS)) {
        const angle = (Math.random() - 0.5) * 2 * def.range * 0.5;
        overrides[boneName] = { x: angle, y: angle * 0.3, z: angle * 0.2 };
      }
      sendTargets(overrides);
    }, FRAME_MS);
  }

  // ── Stop ───────────────────────────────────────────────────────────────

  function stabilityStop() {
    stopAll();
    sendReset();
    console.log('[STOP] Reset to rest pose.');
  }

  // ── Expose to window ───────────────────────────────────────────────────

  window.stabilityRun = stabilityRun;
  window.stabilityOscillate = stabilityOscillate;
  window.stabilityWave = stabilityWave;
  window.stabilitySquat = stabilitySquat;
  window.stabilityFlail = stabilityFlail;
  window.stabilityStop = stabilityStop;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Synthia Stability Test Loaded');
  console.log('');
  console.log('  Automated suite:');
  console.log('    stabilityRun()              — full 7-test suite (~30s)');
  console.log('');
  console.log('  Manual continuous:');
  console.log('    stabilityOscillate(bone,axis,amp,freq)');
  console.log('    stabilityWave(freq)');
  console.log('    stabilitySquat(freq)');
  console.log('    stabilityFlail()');
  console.log('    stabilityStop()');
  console.log('═══════════════════════════════════════════════════════════');
})();
