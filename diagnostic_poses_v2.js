/**
 * Synthia Diagnostic Poses V2 — Clean Console Script
 * Fully compatible with browser dev-tools console.
 * Documentation & Axis Guide: DIAGNOSTIC_POSES_GUIDE.md
 */

'use strict';

const DEG = Math.PI / 180;

function sendPose(name, jointOverrides = {}, programSequence = []) {
  console.log(`%c[DIAGNOSTIC] Pose: "${name}"`, 'color:#7ef; font-weight:bold');
  window.dispatchEvent(new CustomEvent('synthia:action', {
    detail: { jointOverrides, programSequence }
  }));
}

function sendSequence(name, frames, options = {}) {
  const totalMs = frames[frames.length - 1]?.timeOffsetMs ?? 0;
  console.log(`%c[DIAGNOSTIC] Sequence: "${name}" (${frames.length} frames / ${totalMs}ms)`, 'color:#fa7; font-weight:bold');
  window.dispatchEvent(new CustomEvent('synthia:action', {
    detail: {
      jointOverrides: {},
      sequence: frames,
      activeGaitPhase: !!options.activeGaitPhase,
      programSequence: options.programSequence || [],
    }
  }));
}

const FIST_RIGHT = {
  'mixamorigrighthandthumb1':  75 * DEG, 'mixamorigrighthandthumb2':  80 * DEG, 'mixamorigrighthandthumb3':  55 * DEG,
  'mixamorigrighthandindex1':  75 * DEG, 'mixamorigrighthandindex2':  90 * DEG, 'mixamorigrighthandindex3':  75 * DEG,
  'mixamorigrighthandmiddle1': 75 * DEG, 'mixamorigrighthandmiddle2': 90 * DEG, 'mixamorigrighthandmiddle3': 75 * DEG,
  'mixamorigrighthandring1':   75 * DEG, 'mixamorigrighthandring2':   90 * DEG, 'mixamorigrighthandring3':   75 * DEG,
  'mixamorigrighthandpinky1':  75 * DEG, 'mixamorigrighthandpinky2':  90 * DEG, 'mixamorigrighthandpinky3':  75 * DEG,
};

const FIST_LEFT = {
  'mixamoriglefthandthumb1':  75 * DEG, 'mixamoriglefthandthumb2':  80 * DEG, 'mixamoriglefthandthumb3':  55 * DEG,
  'mixamoriglefthandindex1':  75 * DEG, 'mixamoriglefthandindex2':  90 * DEG, 'mixamoriglefthandindex3':  75 * DEG,
  'mixamoriglefthandmiddle1': 75 * DEG, 'mixamoriglefthandmiddle2': 90 * DEG, 'mixamoriglefthandmiddle3': 75 * DEG,
  'mixamoriglefthandring1':   75 * DEG, 'mixamoriglefthandring2':   90 * DEG, 'mixamoriglefthandring3':   75 * DEG,
  'mixamoriglefthandpinky1':  75 * DEG, 'mixamoriglefthandpinky2':  90 * DEG, 'mixamoriglefthandpinky3':  75 * DEG,
};

const OPEN_RIGHT = {
  'mixamorigrighthandthumb1': 0, 'mixamorigrighthandthumb2': 0, 'mixamorigrighthandthumb3': 0,
  'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
  'mixamorigrighthandmiddle1':0, 'mixamorigrighthandmiddle2':0, 'mixamorigrighthandmiddle3':0,
  'mixamorigrighthandring1':  0, 'mixamorigrighthandring2':  0, 'mixamorigrighthandring3':  0,
  'mixamorigrighthandpinky1': 0, 'mixamorigrighthandpinky2': 0, 'mixamorigrighthandpinky3': 0,
};

const OPEN_LEFT = {
  'mixamoriglefthandthumb1': 0, 'mixamoriglefthandthumb2': 0, 'mixamoriglefthandthumb3': 0,
  'mixamoriglefthandindex1': 0, 'mixamoriglefthandindex2': 0, 'mixamoriglefthandindex3': 0,
  'mixamoriglefthandmiddle1':0, 'mixamoriglefthandmiddle2':0, 'mixamoriglefthandmiddle3':0,
  'mixamoriglefthandring1':  0, 'mixamoriglefthandring2':  0, 'mixamoriglefthandring3':  0,
  'mixamoriglefthandpinky1': 0, 'mixamoriglefthandpinky2': 0, 'mixamoriglefthandpinky3': 0,
};

const RELAXED_RIGHT = {
  'mixamorigrighthandthumb1':  15 * DEG, 'mixamorigrighthandthumb2':  20 * DEG, 'mixamorigrighthandthumb3':  10 * DEG,
  'mixamorigrighthandindex1':  15 * DEG, 'mixamorigrighthandindex2':  20 * DEG, 'mixamorigrighthandindex3':  10 * DEG,
  'mixamorigrighthandmiddle1': 15 * DEG, 'mixamorigrighthandmiddle2': 20 * DEG, 'mixamorigrighthandmiddle3': 10 * DEG,
  'mixamorigrighthandring1':   12 * DEG, 'mixamorigrighthandring2':   16 * DEG, 'mixamorigrighthandring3':    8 * DEG,
  'mixamorigrighthandpinky1':  10 * DEG, 'mixamorigrighthandpinky2':  14 * DEG, 'mixamorigrighthandpinky3':   6 * DEG,
};

const RELAXED_LEFT = {
  'mixamoriglefthandthumb1':  15 * DEG, 'mixamoriglefthandthumb2':  20 * DEG, 'mixamoriglefthandthumb3':  10 * DEG,
  'mixamoriglefthandindex1':  15 * DEG, 'mixamoriglefthandindex2':  20 * DEG, 'mixamoriglefthandindex3':  10 * DEG,
  'mixamoriglefthandmiddle1': 15 * DEG, 'mixamoriglefthandmiddle2': 20 * DEG, 'mixamoriglefthandmiddle3': 10 * DEG,
  'mixamoriglefthandring1':   12 * DEG, 'mixamoriglefthandring2':   16 * DEG, 'mixamoriglefthandring3':    8 * DEG,
  'mixamoriglefthandpinky1':  10 * DEG, 'mixamoriglefthandpinky2':  14 * DEG, 'mixamoriglefthandpinky3':   6 * DEG,
};

sendPose('RESET: Upright Stance', {}, ['upright_preset']);

sendPose('Head: Nod Forward (X=+30°)', { 'mixamorighead': [30 * DEG, 0, 0] });
sendPose('Head: Tilt Back (X=-20°)',   { 'mixamorighead': [-20 * DEG, 0, 0] });
sendPose('Head: Tilt Right (Y=-20°)',  { 'mixamorighead': [0, -20 * DEG, 0] });
sendPose('Head: Tilt Left (Y=+20°)',   { 'mixamorighead': [0, 20 * DEG, 0] });
sendPose('Head: Turn Right (Z=-35°)',  { 'mixamorighead': [0, 0, -35 * DEG] });
sendPose('Head: Turn Left (Z=+35°)',   { 'mixamorighead': [0, 0, 35 * DEG] });

sendPose('Spine: Forward Lean', {
  'mixamorigspine':  [14 * DEG, 0, 0],
  'mixamorigspine1': [14 * DEG, 0, 0],
  'mixamorigspine2': [10 * DEG, 0, 0],
});
sendPose('Spine: Tilt Right (Y=-15°)', {
  'mixamorigspine':  [0, -15 * DEG, 0],
  'mixamorigspine1': [0, -15 * DEG, 0],
});
sendPose('Spine: Tilt Left (Y=+15°)', {
  'mixamorigspine':  [0, 15 * DEG, 0],
  'mixamorigspine1': [0, 15 * DEG, 0],
});
sendPose('Spine: Twist Right (Z=-20°)', {
  'mixamorigspine':  [0, 0, -20 * DEG],
  'mixamorigspine1': [0, 0, -20 * DEG],
});
sendPose('Spine: Twist Left (Z=+20°)', {
  'mixamorigspine':  [0, 0, 20 * DEG],
  'mixamorigspine1': [0, 0, 20 * DEG],
});

sendPose('Right Arm: At Side (X=+75°)',      { 'mixamorigrightarm': [75 * DEG, 0, 0] });
sendPose('Right Arm: Overhead (X=-90°)',     { 'mixamorigrightarm': [-90 * DEG, 0, 0] });
sendPose('Right Arm: Swing Forward (Z=-90°)',{ 'mixamorigrightarm': [0, 0, -90 * DEG] });
sendPose('Right Arm: Swing Back (Z=+45°)',   { 'mixamorigrightarm': [0, 0, 45 * DEG] });

sendPose('Left Arm: Swing Forward (Z=+90°)', { 'mixamorigleftarm': [0, 0, 90 * DEG] });
sendPose('Left Arm: Overhead (X=-90°)',      { 'mixamorigleftarm': [-90 * DEG, 0, 0] });

sendPose('Right Elbow: 90° Flex',  { 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrightforearm': 90 * DEG });
sendPose('Right Elbow: 135° Flex', { 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrightforearm': 135 * DEG });
sendPose('Left Elbow: 90° Flex',   { 'mixamorigleftarm':  [75 * DEG, 0, 0], 'mixamorigleftforearm':  90 * DEG });

sendPose('Right Hip: Forward Kick (X=+45°)', { 'mixamorigrightupleg': [45 * DEG, 0, 0] });
sendPose('Right Hip: Backward Kick (X=-30°)',{ 'mixamorigrightupleg': [-30 * DEG, 0, 0] });
sendPose('Right Hip: Abduct Outward (Z=+30°)',{ 'mixamorigrightupleg': [0, 0, 30 * DEG] });

sendPose('Right Knee: 90° Bend (scalar=-90°)', { 'mixamorigrightleg': -90 * DEG });
sendPose('Right Knee: Full Bend (scalar=-130°)', { 'mixamorigrightupleg': [40 * DEG, 0, 0], 'mixamorigrightleg': -130 * DEG });

sendPose('Right Ankle: Dorsiflexion / Toes Up (X=+20°)',    { 'mixamorigrightfoot': [20 * DEG, 0, 0] });
sendPose('Right Ankle: Plantarflexion / Toes Down (X=-25°)',{ 'mixamorigrightfoot': [-25 * DEG, 0, 0] });
sendPose('Left Ankle: Dorsiflexion (X=+20°)',               { 'mixamorigleftfoot':  [20 * DEG, 0, 0] });
sendPose('Left Ankle: Plantarflexion (X=-25°)',              { 'mixamorigleftfoot':  [-25 * DEG, 0, 0] });

sendPose('Open Hand: Right',  { 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrighthand': [0, 0, 0], ...OPEN_RIGHT });
sendPose('Closed Fist: Right',{ 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrighthand': [5 * DEG, 0, 0], ...FIST_RIGHT });
sendPose('Open Hand: Left',   { 'mixamorigleftarm':  [75 * DEG, 0, 0], 'mixamoriglefthand':  [0, 0, 0], ...OPEN_LEFT });
sendPose('Closed Fist: Left', { 'mixamorigleftarm':  [75 * DEG, 0, 0], 'mixamoriglefthand':  [5 * DEG, 0, 0], ...FIST_LEFT });

sendPose('Both Fists: Guard Stance', {
  'mixamorigrightarm':     [20 * DEG, 0, -55 * DEG],
  'mixamorigleftarm':      [20 * DEG, 0,  55 * DEG],
  'mixamorigrightforearm': 100 * DEG,
  'mixamorigleftforearm':  100 * DEG,
  'mixamorigrighthand':    [5 * DEG, 0, 0],
  'mixamoriglefthand':     [5 * DEG, 0, 0],
  ...FIST_RIGHT,
  ...FIST_LEFT,
  'mixamorigspine':        [5 * DEG, 0, 0],
  'mixamorighead':         [5 * DEG, 0, 0],
});

sendPose('Point: Right Index Forward', {
  'mixamorigrightarm':     [10 * DEG, 0, -75 * DEG],
  'mixamorigrightforearm': 30 * DEG,
  'mixamorigrighthand':    [0, 0, 0],
  'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
  'mixamorigrighthandthumb1':  15 * DEG, 'mixamorigrighthandthumb2':  20 * DEG, 'mixamorigrighthandthumb3':  10 * DEG,
  'mixamorigrighthandmiddle1': 70 * DEG, 'mixamorigrighthandmiddle2': 85 * DEG, 'mixamorigrighthandmiddle3': 70 * DEG,
  'mixamorigrighthandring1':   70 * DEG, 'mixamorigrighthandring2':   85 * DEG, 'mixamorigrighthandring3':   70 * DEG,
  'mixamorigrighthandpinky1':  70 * DEG, 'mixamorigrighthandpinky2':  85 * DEG, 'mixamorigrighthandpinky3':  70 * DEG,
});

sendPose('Peace Sign: Right', {
  'mixamorigrightarm':     [10 * DEG, 0, -60 * DEG],
  'mixamorigrightforearm': 20 * DEG,
  'mixamorigrighthand':    [0, 0, 0],
  'mixamorigrighthandindex1':  0, 'mixamorigrighthandindex2':  0, 'mixamorigrighthandindex3':  0,
  'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
  'mixamorigrighthandthumb1':  25 * DEG, 'mixamorigrighthandthumb2':  35 * DEG, 'mixamorigrighthandthumb3':  20 * DEG,
  'mixamorigrighthandring1':   70 * DEG, 'mixamorigrighthandring2':   85 * DEG, 'mixamorigrighthandring3':   70 * DEG,
  'mixamorigrighthandpinky1':  70 * DEG, 'mixamorigrighthandpinky2':  85 * DEG, 'mixamorigrighthandpinky3':  70 * DEG,
});

sendPose('Thumbs Up: Right', {
  'mixamorigrightarm':     [60 * DEG, 0, -25 * DEG],
  'mixamorigrightforearm': 25 * DEG,
  'mixamorigrighthand':    [0, 0, 0],
  'mixamorigrighthandthumb1':  0, 'mixamorigrighthandthumb2':  0, 'mixamorigrighthandthumb3':  0,
  'mixamorigrighthandindex1':  75 * DEG, 'mixamorigrighthandindex2':  90 * DEG, 'mixamorigrighthandindex3':  75 * DEG,
  'mixamorigrighthandmiddle1': 75 * DEG, 'mixamorigrighthandmiddle2': 90 * DEG, 'mixamorigrighthandmiddle3': 75 * DEG,
  'mixamorigrighthandring1':   75 * DEG, 'mixamorigrighthandring2':   90 * DEG, 'mixamorigrighthandring3':   75 * DEG,
  'mixamorigrighthandpinky1':  75 * DEG, 'mixamorigrighthandpinky2':  90 * DEG, 'mixamorigrighthandpinky3':  75 * DEG,
});

sendPose('OK Sign: Right', {
  'mixamorigrightarm':     [65 * DEG, 0, -30 * DEG],
  'mixamorigrightforearm': 35 * DEG,
  'mixamorigrighthand':    [0, 0, 0],
  'mixamorigrighthandthumb1':  50 * DEG, 'mixamorigrighthandthumb2':  65 * DEG, 'mixamorigrighthandthumb3':  45 * DEG,
  'mixamorigrighthandindex1':  40 * DEG, 'mixamorigrighthandindex2':  55 * DEG, 'mixamorigrighthandindex3':  40 * DEG,
  'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
  'mixamorigrighthandring1':   0, 'mixamorigrighthandring2':   0, 'mixamorigrighthandring3':   0,
  'mixamorigrighthandpinky1':  0, 'mixamorigrighthandpinky2':  0, 'mixamorigrighthandpinky3':  0,
});

sendPose('Finger Isolation: Thumb Flex (70°)', { 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrightforearm': 20 * DEG, 'mixamorigrighthandthumb1': 70 * DEG, 'mixamorigrighthandthumb2': 85 * DEG, 'mixamorigrighthandthumb3': 60 * DEG });
sendPose('Finger Isolation: Index Flex (70°)', { 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrightforearm': 20 * DEG, 'mixamorigrighthandindex1': 70 * DEG, 'mixamorigrighthandindex2': 85 * DEG, 'mixamorigrighthandindex3': 60 * DEG });
sendPose('Finger Isolation: Middle Flex (70°)',{ 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrightforearm': 20 * DEG, 'mixamorigrighthandmiddle1': 70 * DEG, 'mixamorigrighthandmiddle2': 85 * DEG, 'mixamorigrighthandmiddle3': 60 * DEG });
sendPose('Finger Isolation: Ring Flex (70°)',  { 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrightforearm': 20 * DEG, 'mixamorigrighthandring1': 70 * DEG, 'mixamorigrighthandring2': 85 * DEG, 'mixamorigrighthandring3': 60 * DEG });
sendPose('Finger Isolation: Pinky Flex (70°)', { 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigrightforearm': 20 * DEG, 'mixamorigrighthandpinky1': 70 * DEG, 'mixamorigrighthandpinky2': 85 * DEG, 'mixamorigrighthandpinky3': 60 * DEG });

sendPose('T-Pose', { 'mixamorigrightarm': [0, 0, 0], 'mixamorigleftarm': [0, 0, 0], 'mixamorigrighthand': [0, 0, 0], 'mixamoriglefthand': [0, 0, 0], ...OPEN_RIGHT, ...OPEN_LEFT });
sendPose('Natural Arms-Down', { 'mixamorigrightarm': [75 * DEG, 0, 0], 'mixamorigleftarm': [75 * DEG, 0, 0], 'mixamorigrighthand': [5 * DEG, 0, 0], 'mixamoriglefthand': [5 * DEG, 0, 0], ...RELAXED_RIGHT, ...RELAXED_LEFT });
sendPose('Arms Overhead', { 'mixamorigrightarm': [-90 * DEG, 0, 0], 'mixamorigleftarm': [-90 * DEG, 0, 0], 'mixamorigrightforearm': 10 * DEG, 'mixamorigleftforearm': 10 * DEG, 'mixamorigrighthand': [0, 0, 0], 'mixamoriglefthand': [0, 0, 0], ...OPEN_RIGHT, ...OPEN_LEFT });
sendPose('Both Arms Reach Forward', { 'mixamorigrightarm': [10 * DEG, 0, -80 * DEG], 'mixamorigleftarm': [10 * DEG, 0, 80 * DEG], 'mixamorigrightforearm': 5 * DEG, 'mixamorigleftforearm': 5 * DEG, 'mixamorigspine': [8 * DEG, 0, 0], 'mixamorigrighthand': [10 * DEG, 0, 0], 'mixamoriglefthand': [10 * DEG, 0, 0], ...RELAXED_RIGHT, ...RELAXED_LEFT });

sendPose('Hands on Hips', {
  'mixamorigrightarm':     [30 * DEG, 0, -30 * DEG],
  'mixamorigleftarm':      [30 * DEG, 0,  30 * DEG],
  'mixamorigrightforearm': 75 * DEG,
  'mixamorigleftforearm':  75 * DEG,
  'mixamorigrighthand':    [10 * DEG, 0, 0],
  'mixamoriglefthand':     [10 * DEG, 0, 0],
  'mixamorigrighthandthumb1':  20 * DEG, 'mixamorigrighthandthumb2':  25 * DEG, 'mixamorigrighthandthumb3':  15 * DEG,
  'mixamorigrighthandindex1':  55 * DEG, 'mixamorigrighthandindex2':  60 * DEG, 'mixamorigrighthandindex3':  40 * DEG,
  'mixamorigrighthandmiddle1': 55 * DEG, 'mixamorigrighthandmiddle2': 60 * DEG, 'mixamorigrighthandmiddle3': 40 * DEG,
  'mixamorigrighthandring1':   55 * DEG, 'mixamorigrighthandring2':   60 * DEG, 'mixamorigrighthandring3':   40 * DEG,
  'mixamorigrighthandpinky1':  50 * DEG, 'mixamorigrighthandpinky2':  55 * DEG, 'mixamorigrighthandpinky3':  35 * DEG,
  'mixamoriglefthandthumb1':   20 * DEG, 'mixamoriglefthandthumb2':   25 * DEG, 'mixamoriglefthandthumb3':   15 * DEG,
  'mixamoriglefthandindex1':   55 * DEG, 'mixamoriglefthandindex2':   60 * DEG, 'mixamoriglefthandindex3':   40 * DEG,
  'mixamoriglefthandmiddle1':  55 * DEG, 'mixamoriglefthandmiddle2':  60 * DEG, 'mixamoriglefthandmiddle3':  40 * DEG,
  'mixamoriglefthandring1':    55 * DEG, 'mixamoriglefthandring2':    60 * DEG, 'mixamoriglefthandring3':    40 * DEG,
  'mixamoriglefthandpinky1':   50 * DEG, 'mixamoriglefthandpinky2':   55 * DEG, 'mixamoriglefthandpinky3':   35 * DEG,
});

sendPose('Arms Crossed', {
  'mixamorigrightarm':     [15 * DEG, 0, -30 * DEG],
  'mixamorigleftarm':      [15 * DEG, 0,  30 * DEG],
  'mixamorigrightforearm': 120 * DEG,
  'mixamorigleftforearm':  120 * DEG,
  'mixamorigrighthand':    [5 * DEG, 0, 0],
  'mixamoriglefthand':     [5 * DEG, 0, 0],
  'mixamorigrighthandthumb1':  15 * DEG, 'mixamorigrighthandthumb2':  20 * DEG, 'mixamorigrighthandthumb3':  10 * DEG,
  'mixamorigrighthandindex1':  35 * DEG, 'mixamorigrighthandindex2':  45 * DEG, 'mixamorigrighthandindex3':  30 * DEG,
  'mixamorigrighthandmiddle1': 35 * DEG, 'mixamorigrighthandmiddle2': 45 * DEG, 'mixamorigrighthandmiddle3': 30 * DEG,
  'mixamorigrighthandring1':   35 * DEG, 'mixamorigrighthandring2':   45 * DEG, 'mixamorigrighthandring3':   30 * DEG,
  'mixamorigrighthandpinky1':  35 * DEG, 'mixamorigrighthandpinky2':  45 * DEG, 'mixamorigrighthandpinky3':  30 * DEG,
  'mixamoriglefthandthumb1':   15 * DEG, 'mixamoriglefthandthumb2':   20 * DEG, 'mixamoriglefthandthumb3':   10 * DEG,
  'mixamoriglefthandindex1':   35 * DEG, 'mixamoriglefthandindex2':   45 * DEG, 'mixamoriglefthandindex3':   30 * DEG,
  'mixamoriglefthandmiddle1':  35 * DEG, 'mixamoriglefthandmiddle2':  45 * DEG, 'mixamoriglefthandmiddle3':  30 * DEG,
  'mixamoriglefthandring1':    35 * DEG, 'mixamoriglefthandring2':    45 * DEG, 'mixamoriglefthandring3':    30 * DEG,
  'mixamoriglefthandpinky1':   35 * DEG, 'mixamoriglefthandpinky2':   45 * DEG, 'mixamoriglefthandpinky3':   30 * DEG,
});

sendPose('Crouch / Deep Squat', {
  'mixamorigspine':  [14 * DEG, 0, 0],
  'mixamorigspine1': [10 * DEG, 0, 0],
  'mixamorigrightupleg': [75 * DEG, 0, -10 * DEG],
  'mixamorigleftupleg':  [75 * DEG, 0,  10 * DEG],
  'mixamorigrightleg':  -110 * DEG,
  'mixamorigleftleg':   -110 * DEG,
  'mixamorigrightfoot': [18 * DEG, 0, 0],
  'mixamorigleftfoot':  [18 * DEG, 0, 0],
  'mixamorigrightarm':  [50 * DEG, 0, -40 * DEG],
  'mixamorigleftarm':   [50 * DEG, 0,  40 * DEG],
  'mixamorigrightforearm': 30 * DEG,
  'mixamorigleftforearm':  30 * DEG,
  'mixamorigrighthand': [10 * DEG, 0, 0],
  'mixamoriglefthand':  [10 * DEG, 0, 0],
  ...RELAXED_RIGHT,
  ...RELAXED_LEFT,
});

sendPose('Galileo Thinking Pose', {
  'mixamorighead':   [10 * DEG, -10 * DEG, 5 * DEG],
  'mixamorigspine':  [8 * DEG, 0, 0],
  'mixamorigspine1': [4 * DEG, 0, 0],
  'mixamorigrightarm':     [15 * DEG, 0, -50 * DEG],
  'mixamorigrightforearm': 120 * DEG,
  'mixamorigrighthand':    [0, 0, 0],
  'mixamorigrighthandthumb1':  35 * DEG, 'mixamorigrighthandthumb2':  50 * DEG, 'mixamorigrighthandthumb3':  30 * DEG,
  'mixamorigrighthandindex1':  30 * DEG, 'mixamorigrighthandindex2':  40 * DEG, 'mixamorigrighthandindex3':  25 * DEG,
  'mixamorigrighthandmiddle1': 45 * DEG, 'mixamorigrighthandmiddle2': 60 * DEG, 'mixamorigrighthandmiddle3': 40 * DEG,
  'mixamorigrighthandring1':   55 * DEG, 'mixamorigrighthandring2':   70 * DEG, 'mixamorigrighthandring3':   50 * DEG,
  'mixamorigrighthandpinky1':  65 * DEG, 'mixamorigrighthandpinky2':  80 * DEG, 'mixamorigrighthandpinky3':  60 * DEG,
  'mixamorigleftarm':      [65 * DEG, 0, 0],
  'mixamorigleftforearm':   10 * DEG,
  'mixamoriglefthand':     [5 * DEG, 0, 0],
  ...RELAXED_LEFT,
});

sendPose('Boxing: Left Jab', {
  'mixamorigleftarm':      [-5 * DEG, 0, 80 * DEG],
  'mixamorigleftforearm':   10 * DEG,
  'mixamorigrightarm':      [25 * DEG, 0, 50 * DEG],
  'mixamorigrightforearm':  100 * DEG,
  'mixamorigspine':         [5 * DEG, 0, -10 * DEG],
  'mixamorighead':          [5 * DEG, 0, -10 * DEG],
  'mixamorigrightupleg':    [10 * DEG, 0, -5 * DEG],
  'mixamorigleftupleg':     [-5 * DEG, 0, 5 * DEG],
  'mixamorigrighthand':     [5 * DEG, 0, 0],
  'mixamoriglefthand':      [5 * DEG, 0, 0],
  ...FIST_RIGHT,
  ...FIST_LEFT,
});

sendPose('Boxing: Right Cross', {
  'mixamorigrightarm':     [-5 * DEG, 0, -80 * DEG],
  'mixamorigrightforearm':  15 * DEG,
  'mixamorigleftarm':       [25 * DEG, 0, 55 * DEG],
  'mixamorigleftforearm':   100 * DEG,
  'mixamorigspine':         [5 * DEG, 0, 10 * DEG],
  'mixamorighead':          [5 * DEG, 0, 10 * DEG],
  'mixamorigrightupleg':    [10 * DEG, 0, -5 * DEG],
  'mixamorigleftupleg':     [-5 * DEG, 0, 5 * DEG],
  'mixamorigrighthand':     [5 * DEG, 0, 0],
  'mixamoriglefthand':      [5 * DEG, 0, 0],
  ...FIST_RIGHT,
  ...FIST_LEFT,
});

sendPose('Superhero Landing', {
  'mixamorigspine':  [14 * DEG, 0, 0],
  'mixamorigspine1': [14 * DEG, 0, 0],
  'mixamorighead':   [-20 * DEG, 0, 0],
  'mixamorigrightarm':     [40 * DEG, 0, -60 * DEG],
  'mixamorigrightforearm':  20 * DEG,
  'mixamorigleftarm':       [10 * DEG, 0, -45 * DEG],
  'mixamorigleftforearm':   20 * DEG,
  'mixamorigrightupleg':   [80 * DEG, 0, -10 * DEG],
  'mixamorigrightleg':    -130 * DEG,
  'mixamorigleftupleg':    [-10 * DEG, 0, 10 * DEG],
  'mixamorigleftleg':     -30 * DEG,
  'mixamorigrighthand':    [20 * DEG, 0, 0],
  'mixamoriglefthand':     [20 * DEG, 0, 0],
  'mixamorigrighthandthumb1':  20 * DEG, 'mixamorigrighthandthumb2':  25 * DEG, 'mixamorigrighthandthumb3':  15 * DEG,
  'mixamorigrighthandindex1':  25 * DEG, 'mixamorigrighthandindex2':  30 * DEG, 'mixamorigrighthandindex3':  20 * DEG,
  'mixamorigrighthandmiddle1': 25 * DEG, 'mixamorigrighthandmiddle2': 30 * DEG, 'mixamorigrighthandmiddle3': 20 * DEG,
  'mixamorigrighthandring1':   25 * DEG, 'mixamorigrighthandring2':   30 * DEG, 'mixamorigrighthandring3':   20 * DEG,
  'mixamorigrighthandpinky1':  25 * DEG, 'mixamorigrighthandpinky2':  30 * DEG, 'mixamorigrighthandpinky3':  20 * DEG,
  'mixamoriglefthandthumb1':   20 * DEG, 'mixamoriglefthandthumb2':   25 * DEG, 'mixamoriglefthandthumb3':   15 * DEG,
  'mixamoriglefthandindex1':   25 * DEG, 'mixamoriglefthandindex2':   30 * DEG, 'mixamoriglefthandindex3':   20 * DEG,
  'mixamoriglefthandmiddle1':  25 * DEG, 'mixamoriglefthandmiddle2':  30 * DEG, 'mixamoriglefthandmiddle3':  20 * DEG,
  'mixamoriglefthandring1':    25 * DEG, 'mixamoriglefthandring2':    30 * DEG, 'mixamoriglefthandring3':    20 * DEG,
  'mixamoriglefthandpinky1':   25 * DEG, 'mixamoriglefthandpinky2':   30 * DEG, 'mixamoriglefthandpinky3':   20 * DEG,
});

sendPose('Sprint Start', {
  'mixamorigspine':  [14 * DEG, 0, 0],
  'mixamorigspine1': [10 * DEG, 0, 0],
  'mixamorighead':   [-10 * DEG, 0, 0],
  'mixamorigrightarm':     [0, 0, -55 * DEG],
  'mixamorigrightforearm':  75 * DEG,
  'mixamorigleftarm':       [10 * DEG, 0, 50 * DEG],
  'mixamorigleftforearm':   30 * DEG,
  'mixamorigrightupleg':   [50 * DEG, 0, 0],
  'mixamorigrightleg':    -40 * DEG,
  'mixamorigleftupleg':    [-20 * DEG, 0, 0],
  'mixamorigleftleg':     -60 * DEG,
  'mixamorigrighthand':    [10 * DEG, 0, 0],
  'mixamoriglefthand':     [10 * DEG, 0, 0],
  ...FIST_RIGHT,
  ...FIST_LEFT,
});

sendPose('Free Fall', {
  'mixamorigspine':  [-14 * DEG, 0, 0],
  'mixamorigspine1': [-10 * DEG, 0, 0],
  'mixamorighead':   [25 * DEG, 0, 0],
  'mixamorigrightarm':     [-75 * DEG, 0, -40 * DEG],
  'mixamorigrightforearm':  45 * DEG,
  'mixamorigleftarm':       [-75 * DEG, 0,  40 * DEG],
  'mixamorigleftforearm':   45 * DEG,
  'mixamorigrightupleg':   [20 * DEG, 0, -10 * DEG],
  'mixamorigrightleg':    -20 * DEG,
  'mixamorigleftupleg':    [20 * DEG, 0,  10 * DEG],
  'mixamorigleftleg':     -20 * DEG,
  'mixamorigrightfoot':   [-20 * DEG, 0, 0],
  'mixamorigleftfoot':    [-20 * DEG, 0, 0],
  'mixamorigrighthand':   [-10 * DEG, 0, 15 * DEG],
  'mixamoriglefthand':    [-10 * DEG, 0, -15 * DEG],
  'mixamorigrighthandthumb1':  20 * DEG, 'mixamorigrighthandthumb2':  25 * DEG, 'mixamorigrighthandthumb3':  15 * DEG,
  'mixamorigrighthandindex1':  20 * DEG, 'mixamorigrighthandindex2':  25 * DEG, 'mixamorigrighthandindex3':  15 * DEG,
  'mixamorigrighthandmiddle1': 20 * DEG, 'mixamorigrighthandmiddle2': 25 * DEG, 'mixamorigrighthandmiddle3': 15 * DEG,
  'mixamorigrighthandring1':   15 * DEG, 'mixamorigrighthandring2':   20 * DEG, 'mixamorigrighthandring3':   12 * DEG,
  'mixamorigrighthandpinky1':  15 * DEG, 'mixamorigrighthandpinky2':  20 * DEG, 'mixamorigrighthandpinky3':  12 * DEG,
  'mixamoriglefthandthumb1':   20 * DEG, 'mixamoriglefthandthumb2':   25 * DEG, 'mixamoriglefthandthumb3':   15 * DEG,
  'mixamoriglefthandindex1':   20 * DEG, 'mixamoriglefthandindex2':   25 * DEG, 'mixamoriglefthandindex3':   15 * DEG,
  'mixamoriglefthandmiddle1':  20 * DEG, 'mixamoriglefthandmiddle2':  25 * DEG, 'mixamoriglefthandmiddle3':  15 * DEG,
  'mixamoriglefthandring1':    15 * DEG, 'mixamoriglefthandring2':    20 * DEG, 'mixamoriglefthandring3':    12 * DEG,
  'mixamoriglefthandpinky1':   15 * DEG, 'mixamoriglefthandpinky2':   20 * DEG, 'mixamoriglefthandpinky3':   12 * DEG,
});

sendPose('Yoga: Tree Pose', {
  'mixamorigspine':  [5 * DEG, 0, 0],
  'mixamorighead':   [5 * DEG, 0, 0],
  'mixamorigrightupleg': [0, 0, 0],
  'mixamorigrightleg':    0,
  'mixamorigleftupleg':  [80 * DEG, 0, 45 * DEG],
  'mixamorigleftleg':   -100 * DEG,
  'mixamorigrightarm': [-130 * DEG, 0, 0],
  'mixamorigleftarm':  [-130 * DEG, 0, 0],
  'mixamorigrightforearm': 30 * DEG,
  'mixamorigleftforearm':  30 * DEG,
  'mixamorigrighthand': [0, 0, 0],
  'mixamoriglefthand':  [0, 0, 0],
  'mixamorigrighthandthumb1':  25 * DEG, 'mixamorigrighthandthumb2':  30 * DEG, 'mixamorigrighthandthumb3':  20 * DEG,
  'mixamorigrighthandindex1':  30 * DEG, 'mixamorigrighthandindex2':  25 * DEG, 'mixamorigrighthandindex3':  15 * DEG,
  'mixamorigrighthandmiddle1': 25 * DEG, 'mixamorigrighthandmiddle2': 20 * DEG, 'mixamorigrighthandmiddle3': 12 * DEG,
  'mixamorigrighthandring1':   20 * DEG, 'mixamorigrighthandring2':   18 * DEG, 'mixamorigrighthandring3':   10 * DEG,
  'mixamorigrighthandpinky1':  15 * DEG, 'mixamorigrighthandpinky2':  12 * DEG, 'mixamorigrighthandpinky3':   8 * DEG,
  'mixamoriglefthandthumb1':   25 * DEG, 'mixamoriglefthandthumb2':   30 * DEG, 'mixamoriglefthandthumb3':   20 * DEG,
  'mixamoriglefthandindex1':   30 * DEG, 'mixamoriglefthandindex2':   25 * DEG, 'mixamoriglefthandindex3':   15 * DEG,
  'mixamoriglefthandmiddle1':  25 * DEG, 'mixamoriglefthandmiddle2':  20 * DEG, 'mixamoriglefthandmiddle3':  12 * DEG,
  'mixamoriglefthandring1':    20 * DEG, 'mixamoriglefthandring2':    18 * DEG, 'mixamoriglefthandring3':    10 * DEG,
  'mixamoriglefthandpinky1':   15 * DEG, 'mixamoriglefthandpinky2':   12 * DEG, 'mixamoriglefthandpinky3':    8 * DEG,
});

sendPose('Tippy Toes', {
  'mixamorigrightupleg': [0, 0, 0],
  'mixamorigleftupleg':  [0, 0, 0],
  'mixamorigrightleg':   0,
  'mixamorigleftleg':    0,
  'mixamorigrightfoot': [-30 * DEG, 0, 0],
  'mixamorigleftfoot':  [-30 * DEG, 0, 0],
  'mixamorigrightarm':  [-55 * DEG, 0, -18 * DEG],
  'mixamorigleftarm':   [-55 * DEG, 0,  18 * DEG],
  'mixamorigspine':     [5 * DEG, 0, 0],
  'mixamorighead':      [5 * DEG, 0, 0],
  'mixamorigrighthand': [0, 0, 0],
  'mixamoriglefthand':  [0, 0, 0],
  ...OPEN_RIGHT,
  ...OPEN_LEFT,
});

sendPose('Stumble', {
  'mixamorigspine':  [-8 * DEG, -12 * DEG, -8 * DEG],
  'mixamorigspine1': [-4 * DEG,  -8 * DEG, -4 * DEG],
  'mixamorighead':   [18 * DEG,   18 * DEG, 0],
  'mixamorigrightarm':     [-50 * DEG, 0, -30 * DEG],
  'mixamorigleftarm':      [-30 * DEG, 0, -35 * DEG],
  'mixamorigrightforearm':  40 * DEG,
  'mixamorigleftforearm':   20 * DEG,
  'mixamorigleftupleg':     [20 * DEG, 0, 5 * DEG],
  'mixamorigleftleg':      -30 * DEG,
  'mixamorigrighthand': [-15 * DEG, 0, 10 * DEG],
  'mixamoriglefthand':  [-15 * DEG, 0, -10 * DEG],
  'mixamorigrighthandthumb1':  15 * DEG, 'mixamorigrighthandthumb2':  18 * DEG, 'mixamorigrighthandthumb3':  10 * DEG,
  'mixamorigrighthandindex1':  12 * DEG, 'mixamorigrighthandindex2':  15 * DEG, 'mixamorigrighthandindex3':   8 * DEG,
  'mixamorigrighthandmiddle1': 12 * DEG, 'mixamorigrighthandmiddle2': 15 * DEG, 'mixamorigrighthandmiddle3':  8 * DEG,
  'mixamorigrighthandring1':    8 * DEG, 'mixamorigrighthandring2':   10 * DEG, 'mixamorigrighthandring3':   6 * DEG,
  'mixamorigrighthandpinky1':   8 * DEG, 'mixamorigrighthandpinky2':  10 * DEG, 'mixamorigrighthandpinky3':  6 * DEG,
  'mixamoriglefthandthumb1':   15 * DEG, 'mixamoriglefthandthumb2':   18 * DEG, 'mixamoriglefthandthumb3':   10 * DEG,
  'mixamoriglefthandindex1':   12 * DEG, 'mixamoriglefthandindex2':   15 * DEG, 'mixamoriglefthandindex3':    8 * DEG,
  'mixamoriglefthandmiddle1':  12 * DEG, 'mixamoriglefthandmiddle2':  15 * DEG, 'mixamoriglefthandmiddle3':   8 * DEG,
  'mixamoriglefthandring1':     8 * DEG, 'mixamoriglefthandring2':    10 * DEG, 'mixamoriglefthandring3':    6 * DEG,
  'mixamoriglefthandpinky1':    8 * DEG, 'mixamoriglefthandpinky2':   10 * DEG, 'mixamoriglefthandpinky3':   6 * DEG,
});

sendPose('Sneeze', {
  'mixamorighead':  [45 * DEG, 0, 0],
  'mixamorigspine': [14 * DEG, 0, 0],
  'mixamorigspine1':[14 * DEG, 0, 0],
  'mixamorigrightarm':     [40 * DEG, 0, -40 * DEG],
  'mixamorigrightforearm':  90 * DEG,
  'mixamorigleftarm':       [40 * DEG, 0,  40 * DEG],
  'mixamorigleftforearm':   90 * DEG,
  'mixamorigrightupleg':   [10 * DEG, 0, 0],
  'mixamorigleftupleg':    [10 * DEG, 0, 0],
  'mixamorigrightleg':    -15 * DEG,
  'mixamorigleftleg':     -15 * DEG,
  'mixamorigrighthand':    [0, 0, 0],
  'mixamoriglefthand':     [0, 0, 0],
  'mixamorigrighthandthumb1':  30 * DEG, 'mixamorigrighthandthumb2':  40 * DEG, 'mixamorigrighthandthumb3':  25 * DEG,
  'mixamorigrighthandindex1':  30 * DEG, 'mixamorigrighthandindex2':  40 * DEG, 'mixamorigrighthandindex3':  25 * DEG,
  'mixamorigrighthandmiddle1': 30 * DEG, 'mixamorigrighthandmiddle2': 40 * DEG, 'mixamorigrighthandmiddle3': 25 * DEG,
  'mixamorigrighthandring1':   30 * DEG, 'mixamorigrighthandring2':   40 * DEG, 'mixamorigrighthandring3':   25 * DEG,
  'mixamorigrighthandpinky1':  30 * DEG, 'mixamorigrighthandpinky2':  40 * DEG, 'mixamorigrighthandpinky3':  25 * DEG,
  'mixamoriglefthandthumb1':   30 * DEG, 'mixamoriglefthandthumb2':   40 * DEG, 'mixamoriglefthandthumb3':   25 * DEG,
  'mixamoriglefthandindex1':   30 * DEG, 'mixamoriglefthandindex2':   40 * DEG, 'mixamoriglefthandindex3':   25 * DEG,
  'mixamoriglefthandmiddle1':  30 * DEG, 'mixamoriglefthandmiddle2':  40 * DEG, 'mixamoriglefthandmiddle3':  25 * DEG,
  'mixamoriglefthandring1':    30 * DEG, 'mixamoriglefthandring2':    40 * DEG, 'mixamoriglefthandring3':    25 * DEG,
  'mixamoriglefthandpinky1':   30 * DEG, 'mixamoriglefthandpinky2':   40 * DEG, 'mixamoriglefthandpinky3':   25 * DEG,
});

// Realistic gait — leg-driven, no root motion. Sign conventions (see guide):
//   hip +X = flex forward, -X = extend back; knee scalar - = bend;
//   foot/ankle -X = plantarflexion (toe-off push against the floor).
// Ground contact comes from the foot geoms (now authored flush with the
// floor), the GRF injector converts the friction force into capsule qvel.
sendSequence('Walk Forward: 3-Step Gait (GRF-driven)', [
  { timeOffsetMs: 0, overrides: {
    'mixamorigrightupleg': [0, 0, 0],   'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightleg': 0,             'mixamorigleftleg': 0,
    'mixamorigrightfoot': [0, 0, 0],   'mixamorigleftfoot': [0, 0, 0],
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm':  [75 * DEG, 0, 0],
    'mixamorigspine':    [5 * DEG, 0, 0],
  }},
  // Step 1 — left push-off + right swing
  { timeOffsetMs: 150, overrides: {
    'mixamorigleftupleg':  [-12 * DEG, 0, 0],  'mixamorigleftleg':  -18 * DEG,
    'mixamorigleftfoot':   [-18 * DEG, 0, 0],  // plantarflexion → push against floor
    'mixamorigrightupleg': [24 * DEG, 0, 0],   'mixamorigrightleg': -45 * DEG,
    'mixamorigrightfoot':  [6 * DEG, 0, 0],    // dorsiflex for clearance
    'mixamorigrightarm':   [10 * DEG, 0, 22 * DEG],  // arm back opposite leg
    'mixamorigleftarm':    [10 * DEG, 0, -22 * DEG],
    'mixamorigspine':      [5 * DEG, 0, 0],
  }},
  { timeOffsetMs: 300, overrides: {
    'mixamorigleftupleg':  [-16 * DEG, 0, 0],  'mixamorigleftleg':  -14 * DEG,
    'mixamorigleftfoot':   [-20 * DEG, 0, 0],  // strong toe-off
    'mixamorigrightupleg': [30 * DEG, 0, 0],   'mixamorigrightleg': -60 * DEG,
    'mixamorigrightfoot':  [4 * DEG, 0, 0],
    'mixamorigrightarm':   [10 * DEG, 0, 30 * DEG],
    'mixamorigleftarm':    [10 * DEG, 0, -30 * DEG],
    'mixamorigspine':      [5 * DEG, 0, 0],
  }},
  // Step 1 — right heel strike; step 2 — left swing starts
  { timeOffsetMs: 450, overrides: {
    'mixamorigleftupleg':  [24 * DEG, 0, 0],   'mixamorigleftleg':  -45 * DEG,
    'mixamorigleftfoot':   [6 * DEG, 0, 0],
    'mixamorigrightupleg': [10 * DEG, 0, 0],   'mixamorigrightleg': -12 * DEG,
    'mixamorigrightfoot':  [8 * DEG, 0, 0],    // heel strike / flat
    'mixamorigrightarm':   [10 * DEG, 0, -22 * DEG],
    'mixamorigleftarm':    [10 * DEG, 0, 22 * DEG],
    'mixamorigspine':      [5 * DEG, 0, 0],
  }},
  // Step 2 — right push-off + left mid-swing
  { timeOffsetMs: 600, overrides: {
    'mixamorigrightupleg': [-12 * DEG, 0, 0],  'mixamorigrightleg': -20 * DEG,
    'mixamorigrightfoot':  [-18 * DEG, 0, 0],
    'mixamorigleftupleg':  [30 * DEG, 0, 0],   'mixamorigleftleg':  -60 * DEG,
    'mixamorigleftfoot':   [4 * DEG, 0, 0],
    'mixamorigrightarm':   [10 * DEG, 0, 22 * DEG],
    'mixamorigleftarm':    [10 * DEG, 0, -22 * DEG],
    'mixamorigspine':      [5 * DEG, 0, 0],
  }},
  { timeOffsetMs: 750, overrides: {
    'mixamorigrightupleg': [-16 * DEG, 0, 0],  'mixamorigrightleg': -14 * DEG,
    'mixamorigrightfoot':  [-20 * DEG, 0, 0],
    'mixamorigleftupleg':  [24 * DEG, 0, 0],   'mixamorigleftleg':  -45 * DEG,
    'mixamorigleftfoot':   [6 * DEG, 0, 0],
    'mixamorigrightarm':   [10 * DEG, 0, 30 * DEG],
    'mixamorigleftarm':    [10 * DEG, 0, -30 * DEG],
    'mixamorigspine':      [5 * DEG, 0, 0],
  }},
  // Step 2 — left heel strike; step 3 — right swing starts
  { timeOffsetMs: 900, overrides: {
    'mixamorigleftupleg':  [10 * DEG, 0, 0],   'mixamorigleftleg':  -12 * DEG,
    'mixamorigleftfoot':   [8 * DEG, 0, 0],
    'mixamorigrightupleg': [24 * DEG, 0, 0],   'mixamorigrightleg': -45 * DEG,
    'mixamorigrightfoot':  [6 * DEG, 0, 0],
    'mixamorigrightarm':   [10 * DEG, 0, -22 * DEG],
    'mixamorigleftarm':    [10 * DEG, 0, 22 * DEG],
    'mixamorigspine':      [5 * DEG, 0, 0],
  }},
  // Step 3 push-off, then settle to a relaxed stance
  { timeOffsetMs: 1050, overrides: {
    'mixamorigrightupleg': [-12 * DEG, 0, 0],  'mixamorigrightleg': -20 * DEG,
    'mixamorigrightfoot':  [-18 * DEG, 0, 0],
    'mixamorigleftupleg':  [30 * DEG, 0, 0],   'mixamorigleftleg':  -60 * DEG,
    'mixamorigleftfoot':   [4 * DEG, 0, 0],
    'mixamorigrightarm':   [10 * DEG, 0, 22 * DEG],
    'mixamorigleftarm':    [10 * DEG, 0, -22 * DEG],
    'mixamorigspine':      [5 * DEG, 0, 0],
  }},
  { timeOffsetMs: 1350, overrides: {
    'mixamorigrightupleg': [0, 0, 0],   'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightleg': 0,             'mixamorigleftleg': 0,
    'mixamorigrightfoot': [0, 0, 0],   'mixamorigleftfoot': [0, 0, 0],
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm':  [75 * DEG, 0, 0],
    'mixamorigspine': 0,
  }},
], { activeGaitPhase: true });

sendSequence('Run Cycle: Full Stride + Airborne', [
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine':  [14 * DEG, 0, 0],
    'mixamorigspine1': [14 * DEG, 0, 0],
    'mixamorigrightupleg': [-20 * DEG, 0, 0],
    'mixamorigrightleg':   -30 * DEG,
    'mixamorigrightfoot':  [-20 * DEG, 0, 0],
    'mixamorigleftupleg':  [60 * DEG, 0, 0],
    'mixamorigleftleg':    -40 * DEG,
    'mixamorigleftfoot':   [-10 * DEG, 0, 0],
    'mixamorigrightarm': [-10 * DEG, 0, 20 * DEG],
    'mixamorigleftarm':   [0, 0, -60 * DEG],
    'mixamorighead': [-10 * DEG, 0, 0],
  }},
  { timeOffsetMs: 200, overrides: {
    'mixamorigspine':  [14 * DEG, 0, 0],
    'mixamorigspine1': [10 * DEG, 0, 0],
    'mixamorigrightupleg': [40 * DEG, 0, 0],
    'mixamorigrightleg':   -40 * DEG,
    'mixamorigrightfoot':  [10 * DEG, 0, 0],
    'mixamorigleftupleg':  [30 * DEG, 0, 0],
    'mixamorigleftleg':    -30 * DEG,
    'mixamorigleftfoot':   [10 * DEG, 0, 0],
    'mixamorigrightarm': [10 * DEG, 0, -40 * DEG],
    'mixamorigleftarm':  [10 * DEG, 0,  30 * DEG],
    'mixamorighead': [-5 * DEG, 0, 0],
  }},
  { timeOffsetMs: 400, overrides: {
    'mixamorigspine':  [14 * DEG, 0, 0],
    'mixamorigspine1': [14 * DEG, 0, 0],
    'mixamorigrightupleg': [60 * DEG, 0, 0],
    'mixamorigrightleg':   -40 * DEG,
    'mixamorigrightfoot':  [-10 * DEG, 0, 0],
    'mixamorigleftupleg':  [-20 * DEG, 0, 0],
    'mixamorigleftleg':    -30 * DEG,
    'mixamorigleftfoot':   [-20 * DEG, 0, 0],
    'mixamorigrightarm': [0, 0, -60 * DEG],
    'mixamorigleftarm':  [-10 * DEG, 0, 20 * DEG],
    'mixamorighead': [-10 * DEG, 0, 0],
  }},
], { activeGaitPhase: true, programSequence: ['jump'] });

sendSequence('Run → Jump Transition', [
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine': [14 * DEG, 0, 0], 'mixamorigspine1': [10 * DEG, 0, 0],
    'mixamorigrightupleg': [30 * DEG, 0, 0], 'mixamorigrightleg': -20 * DEG,
    'mixamorigrightfoot': [-10 * DEG, 0, 0],
    'mixamorigleftupleg':  [-10 * DEG, 0, 0], 'mixamorigleftleg': -40 * DEG,
    'mixamorigleftfoot':   [-10 * DEG, 0, 0],
    'mixamorigrightarm': [0, 0, -40 * DEG],
    'mixamorigleftarm':  [10 * DEG, 0, 30 * DEG],
    'mixamorighead': [-5 * DEG, 0, 0],
  }},
  { timeOffsetMs: 200, overrides: {
    'mixamorigspine': [10 * DEG, 0, 0],
    'mixamorigrightupleg': [10 * DEG, 0, 0], 'mixamorigrightleg': -15 * DEG,
    'mixamorigrightfoot': [0, 0, 0],
    'mixamorigleftupleg':  [10 * DEG, 0, 0], 'mixamorigleftleg': -15 * DEG,
    'mixamorigleftfoot':   [0, 0, 0],
    'mixamorigrightarm': [40 * DEG, 0, -20 * DEG],
    'mixamorigleftarm':  [40 * DEG, 0,  20 * DEG],
  }},
  { timeOffsetMs: 400, overrides: {
    'mixamorigspine': [5 * DEG, 0, 0], 'mixamorigspine1': 0,
    'mixamorigrightupleg': [-10 * DEG, 0, 0], 'mixamorigrightleg': 0,
    'mixamorigrightfoot': [-15 * DEG, 0, 0],
    'mixamorigleftupleg':  [-10 * DEG, 0, 0], 'mixamorigleftleg': 0,
    'mixamorigleftfoot':   [-15 * DEG, 0, 0],
    'mixamorigrightarm': [-60 * DEG, 0, -10 * DEG],
    'mixamorigleftarm':  [-60 * DEG, 0,  10 * DEG],
  }},
], { activeGaitPhase: true, programSequence: ['jump'] });

sendSequence('Squat → Stand', [
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine': [14 * DEG, 0, 0], 'mixamorigspine1': [14 * DEG, 0, 0],
    'mixamorigrightupleg': [75 * DEG, 0, -10 * DEG],
    'mixamorigleftupleg':  [75 * DEG, 0,  10 * DEG],
    'mixamorigrightleg': -120 * DEG,  'mixamorigleftleg': -120 * DEG,
    'mixamorigrightfoot': [18 * DEG, 0, 0], 'mixamorigleftfoot': [18 * DEG, 0, 0],
    'mixamorigrightarm': [50 * DEG, 0, -40 * DEG],
    'mixamorigleftarm':  [50 * DEG, 0,  40 * DEG],
    'mixamorigrightforearm': 30 * DEG, 'mixamorigleftforearm': 30 * DEG,
  }},
  { timeOffsetMs: 350, overrides: {
    'mixamorigspine': [10 * DEG, 0, 0], 'mixamorigspine1': [5 * DEG, 0, 0],
    'mixamorigrightupleg': [40 * DEG, 0, -5 * DEG],
    'mixamorigleftupleg':  [40 * DEG, 0,  5 * DEG],
    'mixamorigrightleg': -60 * DEG, 'mixamorigleftleg': -60 * DEG,
    'mixamorigrightfoot': [10 * DEG, 0, 0], 'mixamorigleftfoot': [10 * DEG, 0, 0],
    'mixamorigrightarm': [40 * DEG, 0, -20 * DEG],
    'mixamorigleftarm':  [40 * DEG, 0,  20 * DEG],
  }},
  { timeOffsetMs: 700, overrides: {
    'mixamorigspine': 0, 'mixamorigspine1': 0,
    'mixamorigrightupleg': [0, 0, 0], 'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightleg': 0,           'mixamorigleftleg': 0,
    'mixamorigrightfoot': [0, 0, 0], 'mixamorigleftfoot': [0, 0, 0],
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm':  [75 * DEG, 0, 0],
  }},
]);

sendSequence('Finger Wiggle: Right Hand Sequential', [
  { timeOffsetMs: 0, overrides: {
    'mixamorigrightarm':     [75 * DEG, 0, 0],
    'mixamorigrightforearm':  15 * DEG,
    'mixamorigrighthand':    [10 * DEG, 0, 0],
    'mixamorigrighthandthumb1':0, 'mixamorigrighthandthumb2':0, 'mixamorigrighthandthumb3':0,
    'mixamorigrighthandindex1':0, 'mixamorigrighthandindex2':0, 'mixamorigrighthandindex3':0,
    'mixamorigrighthandmiddle1':0,'mixamorigrighthandmiddle2':0,'mixamorigrighthandmiddle3':0,
    'mixamorigrighthandring1':  0,'mixamorigrighthandring2':  0,'mixamorigrighthandring3':  0,
    'mixamorigrighthandpinky1': 0,'mixamorigrighthandpinky2': 0,'mixamorigrighthandpinky3': 0,
  }},
  { timeOffsetMs: 200, overrides: {
    'mixamorigrighthandthumb1': 75 * DEG, 'mixamorigrighthandthumb2': 85 * DEG, 'mixamorigrighthandthumb3': 60 * DEG,
  }},
  { timeOffsetMs: 380, overrides: {
    'mixamorigrighthandthumb1': 0, 'mixamorigrighthandthumb2': 0, 'mixamorigrighthandthumb3': 0,
    'mixamorigrighthandindex1': 75 * DEG, 'mixamorigrighthandindex2': 85 * DEG, 'mixamorigrighthandindex3': 60 * DEG,
  }},
  { timeOffsetMs: 560, overrides: {
    'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
    'mixamorigrighthandmiddle1': 75 * DEG, 'mixamorigrighthandmiddle2': 85 * DEG, 'mixamorigrighthandmiddle3': 60 * DEG,
  }},
  { timeOffsetMs: 740, overrides: {
    'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
    'mixamorigrighthandring1': 75 * DEG, 'mixamorigrighthandring2': 85 * DEG, 'mixamorigrighthandring3': 60 * DEG,
  }},
  { timeOffsetMs: 920, overrides: {
    'mixamorigrighthandring1': 0, 'mixamorigrighthandring2': 0, 'mixamorigrighthandring3': 0,
    'mixamorigrighthandpinky1': 75 * DEG, 'mixamorigrighthandpinky2': 85 * DEG, 'mixamorigrighthandpinky3': 60 * DEG,
  }},
  { timeOffsetMs: 1100, overrides: {
    'mixamorigrighthandpinky1': 0, 'mixamorigrighthandpinky2': 0, 'mixamorigrighthandpinky3': 0,
  }},
]);

sendSequence('Piano: C-E-G-C Scale (Right Hand)', [
  { timeOffsetMs: 0, overrides: {
    'mixamorigrightarm':     [10 * DEG, 0, -60 * DEG],
    'mixamorigrightforearm':  80 * DEG,
    'mixamorigrighthand':    [10 * DEG, 0, 0],
    'mixamorigrighthandthumb1':  12 * DEG, 'mixamorigrighthandthumb2':  12 * DEG, 'mixamorigrighthandthumb3':  8 * DEG,
    'mixamorigrighthandindex1':  12 * DEG, 'mixamorigrighthandindex2':  12 * DEG, 'mixamorigrighthandindex3':  8 * DEG,
    'mixamorigrighthandmiddle1': 12 * DEG, 'mixamorigrighthandmiddle2': 12 * DEG, 'mixamorigrighthandmiddle3': 8 * DEG,
    'mixamorigrighthandring1':   12 * DEG, 'mixamorigrighthandring2':   12 * DEG, 'mixamorigrighthandring3':   8 * DEG,
    'mixamorigrighthandpinky1':  12 * DEG, 'mixamorigrighthandpinky2':  12 * DEG, 'mixamorigrighthandpinky3':  8 * DEG,
  }},
  { timeOffsetMs: 100, overrides: {
    'mixamorigrighthand':    [15 * DEG, 0, 0],
    'mixamorigrighthandthumb1': 55 * DEG, 'mixamorigrighthandthumb2': 65 * DEG, 'mixamorigrighthandthumb3': 45 * DEG,
  }},
  { timeOffsetMs: 220, overrides: {
    'mixamorigrighthandthumb1': 12 * DEG, 'mixamorigrighthandthumb2': 12 * DEG, 'mixamorigrighthandthumb3': 8 * DEG,
    'mixamorigrighthandindex1': 55 * DEG, 'mixamorigrighthandindex2': 65 * DEG, 'mixamorigrighthandindex3': 45 * DEG,
  }},
  { timeOffsetMs: 340, overrides: {
    'mixamorigrighthandindex1': 12 * DEG, 'mixamorigrighthandindex2': 12 * DEG, 'mixamorigrighthandindex3': 8 * DEG,
    'mixamorigrighthandmiddle1': 55 * DEG, 'mixamorigrighthandmiddle2': 65 * DEG, 'mixamorigrighthandmiddle3': 45 * DEG,
  }},
  { timeOffsetMs: 460, overrides: {
    'mixamorigrighthandmiddle1': 12 * DEG, 'mixamorigrighthandmiddle2': 12 * DEG, 'mixamorigrighthandmiddle3': 8 * DEG,
    'mixamorigrighthandring1': 55 * DEG, 'mixamorigrighthandring2': 65 * DEG, 'mixamorigrighthandring3': 45 * DEG,
  }},
  { timeOffsetMs: 580, overrides: {
    'mixamorigrighthandring1': 12 * DEG, 'mixamorigrighthandring2': 12 * DEG, 'mixamorigrighthandring3': 8 * DEG,
  }},
]);
