/**
 * Synthia Diagnostic Poses — Precision Rewrite V4
 *
 * COMPLETE POSE CATALOG with finger bones, timed chained motion sequences,
 * foot/ankle overrides, and fully detailed poses at every joint level.
 *
 * Axis Convention (verified against Mixamo model data):
 * ─────────────────────────────────────────────────────────────
 *  All bones use default Three.js XYZ Euler order.
 *  Values are [pitch, yaw, roll] = [X, Y, Z] in DEGREES.
 *
 *  ARMS (shoulder): X=Adduction, Y=Twist, Z=Forward Swing
 *    Right Arm: X>0 lowers to side, Z<0 swings forward, Z>0 swings backward.
 *    Left Arm:  X>0 lowers to side, Z>0 swings forward, Z<0 swings backward.
 *
 *  ELBOWS (Forearms): X>0 bends inward (flexion), X<0 breaks backward (clamped to 0).
 *  HIPS  (UpLegs):   X>0 kicks forward, X<0 kicks backward.
 *  KNEES (Legs):     X<0 bends knee backward (natural flexion).
 *  FEET  (Ankles):   X>0 toes up (dorsiflexion), X<0 toes down (plantarflexion).
 *
 *  FINGERS:
 *    Each phalanx is DOF=1 (X axis only). X>0 flexes, X=0 is extended.
 *    Terminal segments (2,3) require base segment (1) to be flexed (tendon synergy).
 *    Naming: mixamorig{left|right}hand{thumb|index|middle|ring|pinky}{1|2|3}
 *
 *  Head/Spine: X=Pitch, Y=Yaw, Z=Roll.
 *
 * Euler Order: All bones use default 'XYZ' order.
 *
 * Usage: paste individual sendPose() or sendSequence() calls into the browser console.
 *        Call sendPose("RESET") between different poses to return to bind pose.
 */

const DEG = Math.PI / 180;
function sendPose(name, jointOverrides, programSequence = []) {
  console.log(`[DIAGNOSTIC] Pose: "${name}"`);
  window.dispatchEvent(new CustomEvent('synthia:action', {
    detail: { jointOverrides, programSequence }
  }));
}
function sendSequence(name, frames, options = {}) {
  console.log(`[DIAGNOSTIC] Sequence: "${name}" (${frames.length} frames over ${frames[frames.length-1]?.timeOffsetMs || 0}ms)`);
  window.dispatchEvent(new CustomEvent('synthia:action', {
    detail: {
      jointOverrides: {}, 
      sequence: frames,
      activeGaitPhase: !!options.activeGaitPhase,
      programSequence: options.programSequence || [],
    }
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 0: RESET
// ═══════════════════════════════════════════════════════════════════════════════
sendPose("RESET: Arms-Down Upright Stance (uses restArmAngleDeg)", {}, ["upright_preset"]);

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 1: SINGLE AXIS ISOLATION
// ═══════════════════════════════════════════════════════════════════════════════

sendPose("Head: Pitch Forward", { 'mixamorighead': 30 * DEG });

sendPose("Spine: Pitch Forward", {
  'mixamorigspine': 14 * DEG,
  'mixamorigspine1': 10 * DEG,
  'mixamorigspine2': 5 * DEG,
});

sendPose("Right Arm: Lower to Side (X=70)", { 'mixamorigrightarm': [70 * DEG, 0, 0] });

sendPose("Right Arm: Swing Forward (Z=-90)", { 'mixamorigrightarm': [0, 0, -90 * DEG] });

sendPose("Right Elbow: 90° Flex", {
  'mixamorigrightarm': [70 * DEG, 0, 0],
  'mixamorigrightforearm': 90 * DEG
});

sendPose("Left Arm: Swing Forward (Z=90)", { 'mixamorigleftarm': [0, 0, 90 * DEG] });

sendPose("Left Elbow: 90° Flex", {
  'mixamorigleftarm': [70 * DEG, 0, 0],
  'mixamorigleftforearm': 90 * DEG
});

sendPose("Right Knee: 90° Bend", { 'mixamorigrightleg': -90 * DEG });

sendPose("Right Hip: Forward Kick (X=+45)", { 'mixamorigrightupleg': 45 * DEG });

sendPose("Right Foot: Plantarflexion (toe down)", { 'mixamorigrightfoot': -20 * DEG });

sendPose("Right Foot: Dorsiflexion (toe up)", { 'mixamorigrightfoot': 15 * DEG });

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 2: FINGER & HAND DETAIL POSES
// ═══════════════════════════════════════════════════════════════════════════════
// NOTE: Terminal finger segments (2,3) require base segment (1) to be flexed
// due to tendonSynergyLink constraint. Always set segment 1 first.

sendPose("RESET (before finger tests)", {}, ["upright_preset"]);

// Open Hand — all fingers fully extended (0°), wrist neutral
sendPose("Open Hand: Right", {
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandthumb1': 0, 'mixamorigrighthandthumb2': 0, 'mixamorigrighthandthumb3': 0,
  'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
  'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
  'mixamorigrighthandring1': 0, 'mixamorigrighthandring2': 0, 'mixamorigrighthandring3': 0,
  'mixamorigrighthandpinky1': 0, 'mixamorigrighthandpinky2': 0, 'mixamorigrighthandpinky3': 0,
  'mixamorigrightarm': [75 * DEG, 0, 0], // Arm at side
});

sendPose("Open Hand: Left", {
  'mixamoriglefthand': [0, 0, 0],
  'mixamoriglefthandthumb1': 0, 'mixamoriglefthandthumb2': 0, 'mixamoriglefthandthumb3': 0,
  'mixamoriglefthandindex1': 0, 'mixamoriglefthandindex2': 0, 'mixamoriglefthandindex3': 0,
  'mixamoriglefthandmiddle1': 0, 'mixamoriglefthandmiddle2': 0, 'mixamoriglefthandmiddle3': 0,
  'mixamoriglefthandring1': 0, 'mixamoriglefthandring2': 0, 'mixamoriglefthandring3': 0,
  'mixamoriglefthandpinky1': 0, 'mixamoriglefthandpinky2': 0, 'mixamoriglefthandpinky3': 0,
  'mixamorigleftarm': [75 * DEG, 0, 0],
});

// Closed Fist — all fingers flexed tightly
sendPose("Closed Fist: Right", {
  'mixamorigrighthand': [10 * DEG, 0, 0], // Slight wrist flex
  'mixamorigrighthandthumb1': 30 * DEG,
  'mixamorigrighthandthumb2': 45 * DEG,
  'mixamorigrighthandthumb3': 30 * DEG,
  'mixamorigrighthandindex1': 60 * DEG, 'mixamorigrighthandindex2': 80 * DEG, 'mixamorigrighthandindex3': 60 * DEG,
  'mixamorigrighthandmiddle1': 60 * DEG, 'mixamorigrighthandmiddle2': 80 * DEG, 'mixamorigrighthandmiddle3': 60 * DEG,
  'mixamorigrighthandring1': 60 * DEG, 'mixamorigrighthandring2': 80 * DEG, 'mixamorigrighthandring3': 60 * DEG,
  'mixamorigrighthandpinky1': 60 * DEG, 'mixamorigrighthandpinky2': 80 * DEG, 'mixamorigrighthandpinky3': 60 * DEG,
  'mixamorigrightarm': [75 * DEG, 0, 0],
});

sendPose("Closed Fist: Left", {
  'mixamoriglefthand': [10 * DEG, 0, 0],
  'mixamoriglefthandthumb1': 30 * DEG,
  'mixamoriglefthandthumb2': 45 * DEG,
  'mixamoriglefthandthumb3': 30 * DEG,
  'mixamoriglefthandindex1': 60 * DEG, 'mixamoriglefthandindex2': 80 * DEG, 'mixamoriglefthandindex3': 60 * DEG,
  'mixamoriglefthandmiddle1': 60 * DEG, 'mixamoriglefthandmiddle2': 80 * DEG, 'mixamoriglefthandmiddle3': 60 * DEG,
  'mixamoriglefthandring1': 60 * DEG, 'mixamoriglefthandring2': 80 * DEG, 'mixamoriglefthandring3': 60 * DEG,
  'mixamoriglefthandpinky1': 60 * DEG, 'mixamoriglefthandpinky2': 80 * DEG, 'mixamoriglefthandpinky3': 60 * DEG,
  'mixamorigleftarm': [75 * DEG, 0, 0],
});

// Pointing — index extended, all others flexed
sendPose("Point: Right Index", {
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
  'mixamorigrighthandthumb1': 0, 'mixamorigrighthandthumb2': 0, 'mixamorigrighthandthumb3': 0,
  'mixamorigrighthandmiddle1': 60 * DEG, 'mixamorigrighthandmiddle2': 80 * DEG, 'mixamorigrighthandmiddle3': 60 * DEG,
  'mixamorigrighthandring1': 60 * DEG, 'mixamorigrighthandring2': 80 * DEG, 'mixamorigrighthandring3': 60 * DEG,
  'mixamorigrighthandpinky1': 60 * DEG, 'mixamorigrighthandpinky2': 80 * DEG, 'mixamorigrighthandpinky3': 60 * DEG,
  'mixamorigrightarm': [60 * DEG, 0, -60 * DEG], // Arm forward + adducted
  'mixamorigrightforearm': 20 * DEG,
});

// Peace Sign — index + middle extended, ring + pinky flexed
sendPose("Peace Sign: Right", {
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
  'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
  'mixamorigrighthandthumb1': 20 * DEG, 'mixamorigrighthandthumb2': 30 * DEG, 'mixamorigrighthandthumb3': 20 * DEG,
  'mixamorigrighthandring1': 60 * DEG, 'mixamorigrighthandring2': 80 * DEG, 'mixamorigrighthandring3': 60 * DEG,
  'mixamorigrighthandpinky1': 60 * DEG, 'mixamorigrighthandpinky2': 80 * DEG, 'mixamorigrighthandpinky3': 60 * DEG,
  'mixamorigrightarm': [60 * DEG, 0, -50 * DEG],
  'mixamorigrightforearm': 10 * DEG,
});

// "OK" Sign — thumb + index form circle, others extended
sendPose("OK Sign: Right", {
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandthumb1': 40 * DEG, 'mixamorigrighthandthumb2': 60 * DEG, 'mixamorigrighthandthumb3': 40 * DEG,
  'mixamorigrighthandindex1': 30 * DEG, 'mixamorigrighthandindex2': 50 * DEG, 'mixamorigrighthandindex3': 40 * DEG,
  'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
  'mixamorigrighthandring1': 0, 'mixamorigrighthandring2': 0, 'mixamorigrighthandring3': 0,
  'mixamorigrighthandpinky1': 0, 'mixamorigrighthandpinky2': 0, 'mixamorigrighthandpinky3': 0,
  'mixamorigrightarm': [70 * DEG, 0, -30 * DEG],
  'mixamorigrightforearm': 30 * DEG,
});

// Thumbs Up
sendPose("Thumbs Up: Right", {
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandthumb1': 0, 'mixamorigrighthandthumb2': 0, 'mixamorigrighthandthumb3': 0,
  'mixamorigrighthandindex1': 60 * DEG, 'mixamorigrighthandindex2': 80 * DEG, 'mixamorigrighthandindex3': 60 * DEG,
  'mixamorigrighthandmiddle1': 60 * DEG, 'mixamorigrighthandmiddle2': 80 * DEG, 'mixamorigrighthandmiddle3': 60 * DEG,
  'mixamorigrighthandring1': 60 * DEG, 'mixamorigrighthandring2': 80 * DEG, 'mixamorigrighthandring3': 60 * DEG,
  'mixamorigrighthandpinky1': 60 * DEG, 'mixamorigrighthandpinky2': 80 * DEG, 'mixamorigrighthandpinky3': 60 * DEG,
  'mixamorigrightarm': [60 * DEG, 0, -30 * DEG],
  'mixamorigrightforearm': 20 * DEG,
});

// Fingers Half-Flexed (gradient thumb→pinky)
sendPose("Fingers Half-Flexed: Right", {
  'mixamorigrighthand': [5 * DEG, 0, 0],
  'mixamorigrighthandthumb1': 20 * DEG, 'mixamorigrighthandthumb2': 30 * DEG, 'mixamorigrighthandthumb3': 20 * DEG,
  'mixamorigrighthandindex1': 15 * DEG, 'mixamorigrighthandindex2': 20 * DEG, 'mixamorigrighthandindex3': 15 * DEG,
  'mixamorigrighthandmiddle1': 15 * DEG, 'mixamorigrighthandmiddle2': 20 * DEG, 'mixamorigrighthandmiddle3': 15 * DEG,
  'mixamorigrighthandring1': 10 * DEG, 'mixamorigrighthandring2': 15 * DEG, 'mixamorigrighthandring3': 10 * DEG,
  'mixamorigrighthandpinky1': 5 * DEG, 'mixamorigrighthandpinky2': 10 * DEG, 'mixamorigrighthandpinky3': 5 * DEG,
  'mixamorigrightarm': [75 * DEG, 0, 0],
});

sendPose("Fingers Half-Flexed: Left", {
  'mixamoriglefthand': [5 * DEG, 0, 0],
  'mixamoriglefthandthumb1': 20 * DEG, 'mixamoriglefthandthumb2': 30 * DEG, 'mixamoriglefthandthumb3': 20 * DEG,
  'mixamoriglefthandindex1': 15 * DEG, 'mixamoriglefthandindex2': 20 * DEG, 'mixamoriglefthandindex3': 15 * DEG,
  'mixamoriglefthandmiddle1': 15 * DEG, 'mixamoriglefthandmiddle2': 20 * DEG, 'mixamoriglefthandmiddle3': 15 * DEG,
  'mixamoriglefthandring1': 10 * DEG, 'mixamoriglefthandring2': 15 * DEG, 'mixamoriglefthandring3': 10 * DEG,
  'mixamoriglefthandpinky1': 5 * DEG, 'mixamoriglefthandpinky2': 10 * DEG, 'mixamoriglefthandpinky3': 5 * DEG,
  'mixamorigleftarm': [75 * DEG, 0, 0],
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: COMPOUND NATURAL POSES (with finger details)
// ═══════════════════════════════════════════════════════════════════════════════

sendPose("Natural Arms-Down Stance", {
  'mixamorigrightarm': [75 * DEG, 0, 0],
  'mixamorigleftarm': [75 * DEG, 0, 0],
  'mixamorigrighthand': [5 * DEG, 0, 0],
  'mixamorigrighthandindex1': 5 * DEG, 'mixamorigrighthandindex2': 5 * DEG,
  'mixamorigrighthandmiddle1': 5 * DEG, 'mixamorigrighthandmiddle2': 5 * DEG,
  'mixamorigrighthandring1': 5 * DEG, 'mixamorigrighthandring2': 5 * DEG,
  'mixamorigrighthandpinky1': 5 * DEG, 'mixamorigrighthandpinky2': 5 * DEG,
  'mixamoriglefthand': [5 * DEG, 0, 0],
  'mixamoriglefthandindex1': 5 * DEG, 'mixamoriglefthandindex2': 5 * DEG,
  'mixamoriglefthandmiddle1': 5 * DEG, 'mixamoriglefthandmiddle2': 5 * DEG,
  'mixamoriglefthandring1': 5 * DEG, 'mixamoriglefthandring2': 5 * DEG,
  'mixamoriglefthandpinky1': 5 * DEG, 'mixamoriglefthandpinky2': 5 * DEG,
});

sendPose("Arms Overhead", {
  'mixamorigrightarm': [-90 * DEG, 0, 0],
  'mixamorigleftarm': [-90 * DEG, 0, 0],
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
  'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
  'mixamorigrighthandring1': 0, 'mixamorigrighthandring2': 0, 'mixamorigrighthandring3': 0,
  'mixamorigrighthandpinky1': 0, 'mixamorigrighthandpinky2': 0, 'mixamorigrighthandpinky3': 0,
  'mixamoriglefthand': [0, 0, 0],
  'mixamoriglefthandindex1': 0, 'mixamoriglefthandindex2': 0, 'mixamoriglefthandindex3': 0,
  'mixamoriglefthandmiddle1': 0, 'mixamoriglefthandmiddle2': 0, 'mixamoriglefthandmiddle3': 0,
  'mixamoriglefthandring1': 0, 'mixamoriglefthandring2': 0, 'mixamoriglefthandring3': 0,
  'mixamoriglefthandpinky1': 0, 'mixamoriglefthandpinky2': 0, 'mixamoriglefthandpinky3': 0,
});

sendPose("Both Arms Reach Forward", {
  'mixamorigrightarm': [10 * DEG, 0, -80 * DEG],
  'mixamorigleftarm': [10 * DEG, 0, 80 * DEG],
  'mixamorigspine': 10 * DEG,
  'mixamorigrighthand': [10 * DEG, 0, 0],
  'mixamorigrighthandindex1': 10 * DEG, 'mixamorigrighthandindex2': 10 * DEG,
  'mixamorigrighthandmiddle1': 10 * DEG, 'mixamorigrighthandmiddle2': 10 * DEG,
  'mixamoriglefthand': [10 * DEG, 0, 0],
  'mixamoriglefthandindex1': 10 * DEG, 'mixamoriglefthandindex2': 10 * DEG,
  'mixamoriglefthandmiddle1': 10 * DEG, 'mixamoriglefthandmiddle2': 10 * DEG,
});

sendPose("Defensive Guard", {
  'mixamorigrightarm': [20 * DEG, 0, -60 * DEG],
  'mixamorigleftarm': [20 * DEG, 0, 60 * DEG],
  'mixamorigrightforearm': 100 * DEG,
  'mixamorigleftforearm':  100 * DEG,
  'mixamorigspine': 5 * DEG,
  'mixamorighead': 10 * DEG,
  'mixamorigrighthand': [15 * DEG, 0, 0],
  'mixamorigrighthandindex1': 70 * DEG, 'mixamorigrighthandindex2': 90 * DEG, 'mixamorigrighthandindex3': 70 * DEG,
  'mixamorigrighthandmiddle1': 70 * DEG, 'mixamorigrighthandmiddle2': 90 * DEG, 'mixamorigrighthandmiddle3': 70 * DEG,
  'mixamorigrighthandring1': 70 * DEG, 'mixamorigrighthandring2': 90 * DEG, 'mixamorigrighthandring3': 70 * DEG,
  'mixamorigrighthandpinky1': 70 * DEG, 'mixamorigrighthandpinky2': 90 * DEG, 'mixamorigrighthandpinky3': 70 * DEG,
  'mixamoriglefthand': [15 * DEG, 0, 0],
  'mixamoriglefthandindex1': 70 * DEG, 'mixamoriglefthandindex2': 90 * DEG, 'mixamoriglefthandindex3': 70 * DEG,
  'mixamoriglefthandmiddle1': 70 * DEG, 'mixamoriglefthandmiddle2': 90 * DEG, 'mixamoriglefthandmiddle3': 70 * DEG,
  'mixamoriglefthandring1': 70 * DEG, 'mixamoriglefthandring2': 90 * DEG, 'mixamoriglefthandring3': 70 * DEG,
  'mixamoriglefthandpinky1': 70 * DEG, 'mixamoriglefthandpinky2': 90 * DEG, 'mixamoriglefthandpinky3': 70 * DEG,
});

sendPose("Wave Right Hand", {
  'mixamorigrightarm': [-30 * DEG, 0, 0],
  'mixamorigrightforearm': 60 * DEG,
  'mixamorighead': [10 * DEG, -15 * DEG, 0],
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
  'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
  'mixamorigrighthandring1': 0, 'mixamorigrighthandring2': 0, 'mixamorigrighthandring3': 0,
  'mixamorigrighthandpinky1': 0, 'mixamorigrighthandpinky2': 0, 'mixamorigrighthandpinky3': 0,
});

sendPose("Crouch / Squat", {
  'mixamorigspine': 14 * DEG,
  'mixamorigspine1': 10 * DEG,
  'mixamorigrightupleg': [75 * DEG, 0, -10 * DEG],
  'mixamorigleftupleg':  [75 * DEG, 0,  10 * DEG],
  'mixamorigrightleg': -110 * DEG,
  'mixamorigleftleg':  -110 * DEG,
  'mixamorigrightarm': [50 * DEG, 0, -40 * DEG],
  'mixamorigleftarm': [50 * DEG, 0, 40 * DEG],
  'mixamorigrightforearm': 30 * DEG,
  'mixamorigleftforearm': 30 * DEG,
  'mixamorigrighthand': [15 * DEG, 0, 0],
  'mixamorigrighthandindex1': 20 * DEG, 'mixamorigrighthandindex2': 30 * DEG,
  'mixamorigrighthandmiddle1': 20 * DEG, 'mixamorigrighthandmiddle2': 30 * DEG,
  'mixamoriglefthand': [15 * DEG, 0, 0],
  'mixamoriglefthandindex1': 20 * DEG, 'mixamoriglefthandindex2': 30 * DEG,
  'mixamoriglefthandmiddle1': 20 * DEG, 'mixamoriglefthandmiddle2': 30 * DEG,
});

// Galileo Thinking Pose — with specific finger placement near chin
sendPose("Galileo Thinking Pose", {
  'mixamorighead': [15 * DEG, 5 * DEG, -10 * DEG],
  'mixamorigspine': 8 * DEG,
  'mixamorigspine1': 4 * DEG,
  'mixamorigrightarm': [15 * DEG, 0, -50 * DEG],
  'mixamorigrightforearm': 130 * DEG,
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandthumb1': 30 * DEG, 'mixamorigrighthandthumb2': 50 * DEG, 'mixamorigrighthandthumb3': 30 * DEG,
  'mixamorigrighthandindex1': 25 * DEG, 'mixamorigrighthandindex2': 40 * DEG, 'mixamorigrighthandindex3': 30 * DEG,
  'mixamorigrighthandmiddle1': 40 * DEG, 'mixamorigrighthandmiddle2': 60 * DEG, 'mixamorigrighthandmiddle3': 40 * DEG,
  'mixamorigrighthandring1': 50 * DEG, 'mixamorigrighthandring2': 70 * DEG, 'mixamorigrighthandring3': 50 * DEG,
  'mixamorigrighthandpinky1': 60 * DEG, 'mixamorigrighthandpinky2': 80 * DEG, 'mixamorigrighthandpinky3': 60 * DEG,
  'mixamorigleftarm': [65 * DEG, 0, 0],
  'mixamorigleftforearm': 10 * DEG,
  'mixamoriglefthand': [5 * DEG, 0, 0],
  'mixamoriglefthandindex1': 10 * DEG, 'mixamoriglefthandindex2': 15 * DEG,
  'mixamoriglefthandmiddle1': 10 * DEG, 'mixamoriglefthandmiddle2': 15 * DEG,
  'mixamoriglefthandring1': 10 * DEG, 'mixamoriglefthandring2': 15 * DEG,
  'mixamoriglefthandpinky1': 10 * DEG, 'mixamoriglefthandpinky2': 15 * DEG,
});

sendPose("Hands Forward, Fingers Extended", {
  'mixamorigrightarm': [15 * DEG, 0, -80 * DEG],
  'mixamorigleftarm': [15 * DEG, 0, 80 * DEG],
  'mixamorigrightforearm': 5 * DEG,
  'mixamorigleftforearm': 5 * DEG,
  'mixamorigspine': 5 * DEG,
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandthumb1': 15 * DEG, 'mixamorigrighthandthumb2': 20 * DEG, 'mixamorigrighthandthumb3': 10 * DEG,
  'mixamorigrighthandindex1': 20 * DEG, 'mixamorigrighthandindex2': 25 * DEG, 'mixamorigrighthandindex3': 15 * DEG,
  'mixamorigrighthandmiddle1': 15 * DEG, 'mixamorigrighthandmiddle2': 20 * DEG, 'mixamorigrighthandmiddle3': 10 * DEG,
  'mixamorigrighthandring1': 10 * DEG, 'mixamorigrighthandring2': 15 * DEG, 'mixamorigrighthandring3': 10 * DEG,
  'mixamorigrighthandpinky1': 5 * DEG, 'mixamorigrighthandpinky2': 10 * DEG, 'mixamorigrighthandpinky3': 5 * DEG,
  'mixamoriglefthand': [0, 0, 0],
  'mixamoriglefthandthumb1': 15 * DEG, 'mixamoriglefthandthumb2': 20 * DEG, 'mixamoriglefthandthumb3': 10 * DEG,
  'mixamoriglefthandindex1': 20 * DEG, 'mixamoriglefthandindex2': 25 * DEG, 'mixamoriglefthandindex3': 15 * DEG,
  'mixamoriglefthandmiddle1': 15 * DEG, 'mixamoriglefthandmiddle2': 20 * DEG, 'mixamoriglefthandmiddle3': 10 * DEG,
  'mixamoriglefthandring1': 10 * DEG, 'mixamoriglefthandring2': 15 * DEG, 'mixamoriglefthandring3': 10 * DEG,
  'mixamoriglefthandpinky1': 5 * DEG, 'mixamoriglefthandpinky2': 10 * DEG, 'mixamoriglefthandpinky3': 5 * DEG,
});

sendPose("Hands on Hips", {
  'mixamorigrightarm': [30 * DEG, 0, -30 * DEG],
  'mixamorigleftarm': [30 * DEG, 0, 30 * DEG],
  'mixamorigrightforearm': 80 * DEG,
  'mixamorigleftforearm': 80 * DEG,
  'mixamorigrighthand': [10 * DEG, 0, 0],
  'mixamorigrighthandindex1': 60 * DEG, 'mixamorigrighthandindex2': 50 * DEG, 'mixamorigrighthandindex3': 30 * DEG,
  'mixamorigrighthandmiddle1': 60 * DEG, 'mixamorigrighthandmiddle2': 50 * DEG, 'mixamorigrighthandmiddle3': 30 * DEG,
  'mixamorigrighthandring1': 60 * DEG, 'mixamorigrighthandring2': 50 * DEG, 'mixamorigrighthandring3': 30 * DEG,
  'mixamorigrighthandpinky1': 50 * DEG, 'mixamorigrighthandpinky2': 40 * DEG, 'mixamorigrighthandpinky3': 20 * DEG,
  'mixamoriglefthand': [10 * DEG, 0, 0],
  'mixamoriglefthandindex1': 60 * DEG, 'mixamoriglefthandindex2': 50 * DEG, 'mixamoriglefthandindex3': 30 * DEG,
  'mixamoriglefthandmiddle1': 60 * DEG, 'mixamoriglefthandmiddle2': 50 * DEG, 'mixamoriglefthandmiddle3': 30 * DEG,
  'mixamoriglefthandring1': 60 * DEG, 'mixamoriglefthandring2': 50 * DEG, 'mixamoriglefthandring3': 30 * DEG,
  'mixamoriglefthandpinky1': 50 * DEG, 'mixamoriglefthandpinky2': 40 * DEG, 'mixamoriglefthandpinky3': 20 * DEG,
});

sendPose("Arms Crossed", {
  'mixamorigrightarm': [15 * DEG, 0, -30 * DEG],
  'mixamorigleftarm': [15 * DEG, 0, 30 * DEG],
  'mixamorigrightforearm': 130 * DEG,
  'mixamorigleftforearm': 130 * DEG,
  'mixamorigrighthand': [5 * DEG, 0, 0],
  'mixamorigrighthandindex1': 30 * DEG, 'mixamorigrighthandindex2': 40 * DEG,
  'mixamorigrighthandmiddle1': 30 * DEG, 'mixamorigrighthandmiddle2': 40 * DEG,
  'mixamorigrighthandring1': 30 * DEG, 'mixamorigrighthandring2': 40 * DEG,
  'mixamorigrighthandpinky1': 30 * DEG, 'mixamorigrighthandpinky2': 40 * DEG,
  'mixamoriglefthand': [5 * DEG, 0, 0],
  'mixamoriglefthandindex1': 30 * DEG, 'mixamoriglefthandindex2': 40 * DEG,
  'mixamoriglefthandmiddle1': 30 * DEG, 'mixamoriglefthandmiddle2': 40 * DEG,
  'mixamoriglefthandring1': 30 * DEG, 'mixamoriglefthandring2': 40 * DEG,
  'mixamoriglefthandpinky1': 30 * DEG, 'mixamoriglefthandpinky2': 40 * DEG,
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 4: COMPLEX FULL-BODY ASYMMETRIC POSES (with fingers)
// ═══════════════════════════════════════════════════════════════════════════════

sendPose("Superhero Landing", {
  'mixamorigspine': 14 * DEG,
  'mixamorigspine1': 14 * DEG,
  'mixamorighead': -20 * DEG,
  'mixamorigrightarm': [40 * DEG, 0, -60 * DEG],
  'mixamorigrightforearm': 20 * DEG,
  'mixamorigleftarm': [10 * DEG, 0, -45 * DEG],
  'mixamorigrightupleg': [80 * DEG, 0, -10 * DEG],
  'mixamorigrightleg': -130 * DEG,
  'mixamorigleftupleg': [-10 * DEG, 0, 10 * DEG],
  'mixamorigleftleg': -30 * DEG,
  'mixamorigrighthand': [30 * DEG, 0, 0],
  'mixamorigrighthandindex1': 50 * DEG, 'mixamorigrighthandindex2': 60 * DEG, 'mixamorigrighthandindex3': 40 * DEG,
  'mixamorigrighthandmiddle1': 50 * DEG, 'mixamorigrighthandmiddle2': 60 * DEG, 'mixamorigrighthandmiddle3': 40 * DEG,
  'mixamorigrighthandring1': 50 * DEG, 'mixamorigrighthandring2': 60 * DEG, 'mixamorigrighthandring3': 40 * DEG,
  'mixamorigrighthandpinky1': 50 * DEG, 'mixamorigrighthandpinky2': 60 * DEG, 'mixamorigrighthandpinky3': 40 * DEG,
  'mixamoriglefthand': [30 * DEG, 0, 0],
  'mixamoriglefthandindex1': 50 * DEG, 'mixamoriglefthandindex2': 60 * DEG, 'mixamoriglefthandindex3': 40 * DEG,
  'mixamoriglefthandmiddle1': 50 * DEG, 'mixamoriglefthandmiddle2': 60 * DEG, 'mixamoriglefthandmiddle3': 40 * DEG,
  'mixamoriglefthandring1': 50 * DEG, 'mixamoriglefthandring2': 60 * DEG, 'mixamoriglefthandring3': 40 * DEG,
  'mixamoriglefthandpinky1': 50 * DEG, 'mixamoriglefthandpinky2': 60 * DEG, 'mixamoriglefthandpinky3': 40 * DEG,
});

sendPose("Sprint Start", {
  'mixamorigspine': 14 * DEG,
  'mixamorigspine1': 10 * DEG,
  'mixamorighead': -10 * DEG,
  'mixamorigrightarm': [0, 0, -60 * DEG],
  'mixamorigrightforearm': 80 * DEG,
  'mixamorigleftarm': [10 * DEG, 0, -60 * DEG],
  'mixamorigleftforearm': 30 * DEG,
  'mixamorigrightupleg': [50 * DEG, 0, 0],
  'mixamorigrightleg': -40 * DEG,
  'mixamorigleftupleg': [-20 * DEG, 0, 0],
  'mixamorigleftleg': -60 * DEG,
  'mixamorigrighthand': [15 * DEG, 0, 0],
  'mixamorigrighthandindex1': 70 * DEG, 'mixamorigrighthandindex2': 90 * DEG, 'mixamorigrighthandindex3': 70 * DEG,
  'mixamorigrighthandmiddle1': 70 * DEG, 'mixamorigrighthandmiddle2': 90 * DEG, 'mixamorigrighthandmiddle3': 70 * DEG,
  'mixamorigrighthandring1': 70 * DEG, 'mixamorigrighthandring2': 90 * DEG, 'mixamorigrighthandring3': 70 * DEG,
  'mixamorigrighthandpinky1': 70 * DEG, 'mixamorigrighthandpinky2': 90 * DEG, 'mixamorigrighthandpinky3': 70 * DEG,
  'mixamoriglefthand': [15 * DEG, 0, 0],
  'mixamoriglefthandindex1': 70 * DEG, 'mixamoriglefthandindex2': 90 * DEG, 'mixamoriglefthandindex3': 70 * DEG,
  'mixamoriglefthandmiddle1': 70 * DEG, 'mixamoriglefthandmiddle2': 90 * DEG, 'mixamoriglefthandmiddle3': 70 * DEG,
  'mixamoriglefthandring1': 70 * DEG, 'mixamoriglefthandring2': 90 * DEG, 'mixamoriglefthandring3': 70 * DEG,
  'mixamoriglefthandpinky1': 70 * DEG, 'mixamoriglefthandpinky2': 90 * DEG, 'mixamoriglefthandpinky3': 70 * DEG,
});

sendPose("Stumble", {
  'mixamorigspine': [-10 * DEG, 14 * DEG, 10 * DEG],
  'mixamorigspine1': [-5 * DEG, 10 * DEG, 5 * DEG],
  'mixamorighead': [20 * DEG, -20 * DEG, 0],
  'mixamorigrightarm': [-50 * DEG, 0, -30 * DEG],
  'mixamorigleftarm': [-30 * DEG, 0, -40 * DEG],
  'mixamorigrightforearm': 40 * DEG,
  'mixamorigleftforearm': 20 * DEG,
  'mixamorigleftupleg': [20 * DEG, 0, 5 * DEG],
  'mixamorigleftleg': -30 * DEG,
  'mixamorigrighthand': [-20 * DEG, 0, 10 * DEG],
  'mixamorigrighthandindex1': 10 * DEG, 'mixamorigrighthandindex2': 10 * DEG, 'mixamorigrighthandindex3': 5 * DEG,
  'mixamorigrighthandmiddle1': 10 * DEG, 'mixamorigrighthandmiddle2': 10 * DEG, 'mixamorigrighthandmiddle3': 5 * DEG,
  'mixamorigrighthandring1': 5 * DEG, 'mixamorigrighthandring2': 5 * DEG, 'mixamorigrighthandring3': 5 * DEG,
  'mixamorigrighthandpinky1': 5 * DEG, 'mixamorigrighthandpinky2': 5 * DEG, 'mixamorigrighthandpinky3': 5 * DEG,
  'mixamoriglefthand': [-20 * DEG, 0, -10 * DEG],
  'mixamoriglefthandindex1': 10 * DEG, 'mixamoriglefthandindex2': 10 * DEG, 'mixamoriglefthandindex3': 5 * DEG,
  'mixamoriglefthandmiddle1': 10 * DEG, 'mixamoriglefthandmiddle2': 10 * DEG, 'mixamoriglefthandmiddle3': 5 * DEG,
  'mixamoriglefthandring1': 5 * DEG, 'mixamoriglefthandring2': 5 * DEG, 'mixamoriglefthandring3': 5 * DEG,
  'mixamoriglefthandpinky1': 5 * DEG, 'mixamoriglefthandpinky2': 5 * DEG, 'mixamoriglefthandpinky3': 5 * DEG,
});

// Yoga: Tree Pose
sendPose("Yoga: Tree Pose", {
  'mixamorigspine': 5 * DEG,
  'mixamorigspine1': 0 * DEG,
  'mixamorigspine2': -5 * DEG,
  'mixamorighead': [5 * DEG, 0, 0],
  'mixamorigrightupleg': [0, 0, 0],
  'mixamorigrightleg': 0,
  'mixamorigleftupleg': [80 * DEG, 0, 45 * DEG],
  'mixamorigleftleg': -100 * DEG,
  'mixamorigrightarm': [-130 * DEG, 0, 0],
  'mixamorigleftarm': [-130 * DEG, 0, 0],
  'mixamorigrightforearm': 30 * DEG,
  'mixamorigleftforearm': 30 * DEG,
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandindex1': 30 * DEG, 'mixamorigrighthandindex2': 20 * DEG, 'mixamorigrighthandindex3': 10 * DEG,
  'mixamoriglefthand': [0, 0, 0],
  'mixamoriglefthandindex1': 30 * DEG, 'mixamoriglefthandindex2': 20 * DEG, 'mixamoriglefthandindex3': 10 * DEG,
});

// Boxing Punch (NEW)
sendPose("Boxing Punch: Right Cross", {
  'mixamorigrightarm': [-10 * DEG, 0, -80 * DEG],
  'mixamorigrightforearm': 30 * DEG,
  'mixamorigleftarm': [30 * DEG, 0, 50 * DEG],
  'mixamorigleftforearm': 100 * DEG,
  'mixamorigspine': [10 * DEG, -10 * DEG, 5 * DEG],
  'mixamorighead': [5 * DEG, -15 * DEG, 0],
  'mixamorigrightupleg': [15 * DEG, 0, -5 * DEG],
  'mixamorigleftupleg': [-5 * DEG, 0, 5 * DEG],
  'mixamorigrighthand': [15 * DEG, 0, 0],
  'mixamorigrighthandindex1': 70 * DEG, 'mixamorigrighthandindex2': 90 * DEG, 'mixamorigrighthandindex3': 70 * DEG,
  'mixamorigrighthandmiddle1': 70 * DEG, 'mixamorigrighthandmiddle2': 90 * DEG, 'mixamorigrighthandmiddle3': 70 * DEG,
  'mixamorigrighthandring1': 70 * DEG, 'mixamorigrighthandring2': 90 * DEG, 'mixamorigrighthandring3': 70 * DEG,
  'mixamorigrighthandpinky1': 70 * DEG, 'mixamorigrighthandpinky2': 90 * DEG, 'mixamorigrighthandpinky3': 70 * DEG,
  'mixamoriglefthand': [15 * DEG, 0, 0],
  'mixamoriglefthandindex1': 70 * DEG, 'mixamoriglefthandindex2': 90 * DEG, 'mixamoriglefthandindex3': 70 * DEG,
  'mixamoriglefthandmiddle1': 70 * DEG, 'mixamoriglefthandmiddle2': 90 * DEG, 'mixamoriglefthandmiddle3': 70 * DEG,
  'mixamoriglefthandring1': 70 * DEG, 'mixamoriglefthandring2': 90 * DEG, 'mixamoriglefthandring3': 70 * DEG,
  'mixamoriglefthandpinky1': 70 * DEG, 'mixamoriglefthandpinky2': 90 * DEG, 'mixamoriglefthandpinky3': 70 * DEG,
});

// Free-Fall (NEW) — tests airborne detection
sendPose("Free Fall", {
  'mixamorigspine': [-14 * DEG, 0, 0],
  'mixamorigspine1': [-14 * DEG, 0, 0],
  'mixamorighead': [30 * DEG, 0, 0],
  'mixamorigrightarm': [-80 * DEG, 0, -45 * DEG],
  'mixamorigrightforearm': 40 * DEG,
  'mixamorigleftarm': [-80 * DEG, 0, 45 * DEG],
  'mixamorigleftforearm': 40 * DEG,
  'mixamorigrightupleg': [20 * DEG, 0, -10 * DEG],
  'mixamorigrightleg': -20 * DEG,
  'mixamorigleftupleg': [20 * DEG, 0, 10 * DEG],
  'mixamorigleftleg': -20 * DEG,
  'mixamorigrighthand': [-15 * DEG, 0, 15 * DEG],
  'mixamorigrighthandindex1': 20 * DEG, 'mixamorigrighthandindex2': 30 * DEG, 'mixamorigrighthandindex3': 20 * DEG,
  'mixamorigrighthandmiddle1': 20 * DEG, 'mixamorigrighthandmiddle2': 30 * DEG, 'mixamorigrighthandmiddle3': 20 * DEG,
  'mixamoriglefthand': [-15 * DEG, 0, -15 * DEG],
  'mixamoriglefthandindex1': 20 * DEG, 'mixamoriglefthandindex2': 30 * DEG, 'mixamoriglefthandindex3': 20 * DEG,
  'mixamoriglefthandmiddle1': 20 * DEG, 'mixamoriglefthandmiddle2': 30 * DEG, 'mixamoriglefthandmiddle3': 20 * DEG,
});

// Tippy-Toes (NEW) — ankle plantarflexion + knees locked + arms up for balance
sendPose("Tippy Toes", {
  'mixamorigrightupleg': [0, 0, 0],
  'mixamorigleftupleg': [0, 0, 0],
  'mixamorigrightleg': 0,
  'mixamorigleftleg': 0,
  'mixamorigrightfoot': -30 * DEG,
  'mixamorigleftfoot': -30 * DEG,
  'mixamorigrightarm': [-60 * DEG, 0, -20 * DEG],
  'mixamorigleftarm': [-60 * DEG, 0, 20 * DEG],
  'mixamorigspine': 5 * DEG,
  'mixamorighead': [5 * DEG, 0, 0],
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
  'mixamoriglefthand': [0, 0, 0],
  'mixamoriglefthandindex1': 0, 'mixamoriglefthandindex2': 0, 'mixamoriglefthandindex3': 0,
});

// Sneezing (NEW) — fast forward pitch of head + spine curl
sendPose("Sneeze", {
  'mixamorighead': [45 * DEG, 0, 0],
  'mixamorigspine': [14 * DEG, 0, 0],
  'mixamorigspine1': [14 * DEG, 0, 0],
  'mixamorigrightarm': [40 * DEG, 0, -40 * DEG],
  'mixamorigrightforearm': 90 * DEG,
  'mixamorigleftarm': [40 * DEG, 0, 40 * DEG],
  'mixamorigleftforearm': 90 * DEG,
  'mixamorigrighthand': [0, 0, 0],
  'mixamorigrighthandindex1': 30 * DEG, 'mixamorigrighthandindex2': 40 * DEG, 'mixamorigrighthandindex3': 30 * DEG,
  'mixamorigrighthandmiddle1': 30 * DEG, 'mixamorigrighthandmiddle2': 40 * DEG, 'mixamorigrighthandmiddle3': 30 * DEG,
  'mixamorigrighthandring1': 30 * DEG, 'mixamorigrighthandring2': 40 * DEG, 'mixamorigrighthandring3': 30 * DEG,
  'mixamorigrighthandpinky1': 30 * DEG, 'mixamorigrighthandpinky2': 40 * DEG, 'mixamorigrighthandpinky3': 30 * DEG,
  'mixamoriglefthand': [0, 0, 0],
  'mixamoriglefthandindex1': 30 * DEG, 'mixamoriglefthandindex2': 40 * DEG, 'mixamoriglefthandindex3': 30 * DEG,
  'mixamoriglefthandmiddle1': 30 * DEG, 'mixamoriglefthandmiddle2': 40 * DEG, 'mixamoriglefthandmiddle3': 30 * DEG,
  'mixamoriglefthandring1': 30 * DEG, 'mixamoriglefthandring2': 40 * DEG, 'mixamoriglefthandring3': 30 * DEG,
  'mixamoriglefthandpinky1': 30 * DEG, 'mixamoriglefthandpinky2': 40 * DEG, 'mixamoriglefthandpinky3': 30 * DEG,
  'mixamorigrightupleg': [10 * DEG, 0, 0],
  'mixamorigleftupleg': [10 * DEG, 0, 0],
  'mixamorigrightleg': -15 * DEG,
  'mixamorigleftleg': -15 * DEG,
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 5: TIMED CHAINED MOTION SEQUENCES
// ═══════════════════════════════════════════════════════════════════════════════
// These use the sequence[] timeline format with timeOffsetMs for scheduled playback.
// The timeline stepper in HumanoidPhysicsBinder.syncVisuals() executes frames
// at the correct wall-clock offsets.

// Walking Cycle (4 phases, ~1000ms per stride — natural cadence)
// Includes foot/ankle overrides to prevent floor clipping:
//   - Toe-off (plantarflexion) at lift
//   - Dorsiflexion (toe up) during swing for ground clearance
//   - Foot flat at heel strike
// Uses activeGaitPhase to apply locomotionCap angle limits
sendSequence("Walk Cycle: 2 Steps", [
  // Frame 0: Neutral stance
  { timeOffsetMs: 0, overrides: {
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightleg': 0,
    'mixamorigleftleg': 0,
    'mixamorigrightfoot': 0,
    'mixamorigleftfoot': 0,
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm': [75 * DEG, 0, 0],
  }},
  // Frame 1 (250ms): Right leg lifts for forward step, left arm swings forward
  // Toe-off: right foot plantarflexes (toe down) for push-off
  // Left foot stays flat (stance)
  { timeOffsetMs: 250, overrides: {
    'mixamorigrightupleg': [25 * DEG, 0, 0],
    'mixamorigrightleg': -25 * DEG,
    'mixamorigrightfoot': -10 * DEG, // Toe-off: plantarflexion
    'mixamorigleftupleg': [-5 * DEG, 0, 0],
    'mixamorigleftleg': -5 * DEG,
    'mixamorigleftfoot': 0,          // Stance foot flat
    'mixamorigrightarm': [0, 0, -30 * DEG],
    'mixamorigleftarm': [0, 0, 30 * DEG],
    'mixamorigspine': 3 * DEG,
  }},
  // Frame 2 (500ms): Mid-stride — right leg swings through, foot dorsiflexes for clearance
  // Left leg trails behind, left foot still flat
  { timeOffsetMs: 500, overrides: {
    'mixamorigrightupleg': [5 * DEG, 0, 0],
    'mixamorigrightleg': -5 * DEG,
    'mixamorigrightfoot': 10 * DEG,  // Swing: dorsiflexion (toe up) for ground clearance
    'mixamorigleftupleg': [-15 * DEG, 0, 0],
    'mixamorigleftleg': -25 * DEG,
    'mixamorigleftfoot': -5 * DEG,   // Toe-off on trailing foot
    'mixamorigrightarm': [10 * DEG, 0, 0],
    'mixamorigleftarm': [10 * DEG, 0, 0],
    'mixamorigspine': 3 * DEG,
  }},
  // Frame 3 (750ms): Left leg steps forward, right arm swings forward
  // Right foot flat (now stance), left toes off
  { timeOffsetMs: 750, overrides: {
    'mixamorigrightupleg': [-10 * DEG, 0, 0],
    'mixamorigrightleg': -15 * DEG,
    'mixamorigrightfoot': 0,         // Stance: foot flat after heel strike
    'mixamorigleftupleg': [30 * DEG, 0, 0],
    'mixamorigleftleg': -30 * DEG,
    'mixamorigleftfoot': -10 * DEG,  // Toe-off on left
    'mixamorigrightarm': [0, 0, 30 * DEG],
    'mixamorigleftarm': [0, 0, -30 * DEG],
    'mixamorigspine': 3 * DEG,
  }},
  // Frame 4 (1000ms): Return to neutral (completes stride)
  { timeOffsetMs: 1000, overrides: {
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightleg': 0,
    'mixamorigleftleg': 0,
    'mixamorigrightfoot': 0,
    'mixamorigleftfoot': 0,
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm': [75 * DEG, 0, 0],
    'mixamorigspine': 0,
  }},
], { activeGaitPhase: true });

sendPose("RESET (after walk)", {}, ["upright_preset"]);

// Running Cycle (3 phases, ~400ms per stride, with airborne phase)
// Added foot overrides: toes pointed down during drive (push-off), dorsiflexed during airborne
sendSequence("Run Cycle: 2 Strides", [
  // Frame 0: Crouched start
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine': 14 * DEG,
    'mixamorigspine1': 10 * DEG,
    'mixamorigrightupleg': [45 * DEG, 0, 0],
    'mixamorigrightleg': -20 * DEG,
    'mixamorigrightfoot': -15 * DEG,
    'mixamorigleftupleg': [-15 * DEG, 0, 0],
    'mixamorigleftleg': -50 * DEG,
    'mixamorigleftfoot': -10 * DEG,
    'mixamorigrightarm': [0, 0, -50 * DEG],
    'mixamorigleftarm': [10 * DEG, 0, -30 * DEG],
    'mixamorighead': -10 * DEG,
  }},
  // Frame 1 (150ms): Drive phase — right leg pushes back, left leg drives forward
  { timeOffsetMs: 150, overrides: {
    'mixamorigspine': 14 * DEG,
    'mixamorigspine1': 14 * DEG,
    'mixamorigrightupleg': [-20 * DEG, 0, 0],
    'mixamorigrightleg': -30 * DEG,
    'mixamorigrightfoot': -20 * DEG, // Powerful toe push-off
    'mixamorigleftupleg': [60 * DEG, 0, 0],
    'mixamorigleftleg': -40 * DEG,
    'mixamorigleftfoot': -10 * DEG,
    'mixamorigrightarm': [-10 * DEG, 0, 20 * DEG],
    'mixamorigleftarm': [0, 0, -60 * DEG],
    'mixamorighead': -10 * DEG,
  }},
  // Frame 2 (400ms): Airborne — both feet off ground, legs tucked
  { timeOffsetMs: 400, overrides: {
    'mixamorigspine': 14 * DEG,
    'mixamorigspine1': 10 * DEG,
    'mixamorigrightupleg': [40 * DEG, 0, 0],
    'mixamorigrightleg': -40 * DEG,
    'mixamorigrightfoot': 10 * DEG,  // Dorsiflexion for ground clearance during airborne
    'mixamorigleftupleg': [30 * DEG, 0, 0],
    'mixamorigleftleg': -30 * DEG,
    'mixamorigleftfoot': 10 * DEG,   // Dorsiflexion for ground clearance
    'mixamorigrightarm': [10 * DEG, 0, -40 * DEG],
    'mixamorigleftarm': [10 * DEG, 0, 30 * DEG],
    'mixamorighead': -5 * DEG,
  }},
], { activeGaitPhase: true, programSequence: ['jump'] });

sendPose("RESET (after run)", {}, ["upright_preset"]);

// Run → Jump transition (running start leading to jump)
sendSequence("Run → Jump Transition", [
  // Frame 0: Running stance
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine': 14 * DEG,
    'mixamorigspine1': 10 * DEG,
    'mixamorigrightupleg': [30 * DEG, 0, 0],
    'mixamorigrightleg': -20 * DEG,
    'mixamorigrightfoot': -10 * DEG,
    'mixamorigleftupleg': [-10 * DEG, 0, 0],
    'mixamorigleftleg': -40 * DEG,
    'mixamorigleftfoot': -10 * DEG,
    'mixamorigrightarm': [0, 0, -40 * DEG],
    'mixamorigleftarm': [10 * DEG, 0, 30 * DEG],
    'mixamorighead': -5 * DEG,
  }},
  // Frame 1 (200ms): Gather — legs together, arms down
  { timeOffsetMs: 200, overrides: {
    'mixamorigspine': 10 * DEG,
    'mixamorigrightupleg': [10 * DEG, 0, 0],
    'mixamorigrightleg': -15 * DEG,
    'mixamorigrightfoot': 0,
    'mixamorigleftupleg': [10 * DEG, 0, 0],
    'mixamorigleftleg': -15 * DEG,
    'mixamorigleftfoot': 0,
    'mixamorigrightarm': [40 * DEG, 0, -20 * DEG],
    'mixamorigleftarm': [40 * DEG, 0, 20 * DEG],
  }},
  // Frame 2 (400ms): Jump — legs extend, arms swing up
  { timeOffsetMs: 400, overrides: {
    'mixamorigspine': 5 * DEG,
    'mixamorigspine1': 0,
    'mixamorigrightupleg': [-10 * DEG, 0, 0],
    'mixamorigrightleg': 0,
    'mixamorigrightfoot': -15 * DEG, // Pointed toes during jump
    'mixamorigleftupleg': [-10 * DEG, 0, 0],
    'mixamorigleftleg': 0,
    'mixamorigleftfoot': -15 * DEG,
    'mixamorigrightarm': [-60 * DEG, 0, -10 * DEG], // Arms up
    'mixamorigleftarm': [-60 * DEG, 0, 10 * DEG],
  }},
], { activeGaitPhase: true, programSequence: ['jump'] });

sendPose("RESET (after run→jump)", {}, ["upright_preset"]);

// Spin in Place (asymmetric foot stroking to generate rotational torque)
sendSequence("Spin: 360° Turn (Asymmetric Feet)", [
  // Frame 0: Stance
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine': 0,
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm': [75 * DEG, 0, 0],
  }},
  // Frame 1 (200ms): Right foot pushes back-left (generates CW torque)
  { timeOffsetMs: 200, overrides: {
    'mixamorigrightupleg': [-20 * DEG, 0, -10 * DEG],
    'mixamorigrightleg': -10 * DEG,
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigspine': [0, 10 * DEG, 0],
  }},
  // Frame 2 (400ms): Left foot pushes forward-right
  { timeOffsetMs: 400, overrides: {
    'mixamorigrightupleg': [10 * DEG, 0, 0],
    'mixamorigleftupleg': [-10 * DEG, 0, 10 * DEG],
    'mixamorigleftleg': -10 * DEG,
    'mixamorigspine': [0, 14 * DEG, 0],
  }},
  // Frame 3 (600ms): Right foot pushes again
  { timeOffsetMs: 600, overrides: {
    'mixamorigrightupleg': [-15 * DEG, 0, -10 * DEG],
    'mixamorigrightleg': -15 * DEG,
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigspine': [0, 14 * DEG, 0],
  }},
  // Frame 4 (800ms): Left foot pushes again
  { timeOffsetMs: 800, overrides: {
    'mixamorigrightupleg': [10 * DEG, 0, 0],
    'mixamorigleftupleg': [-15 * DEG, 0, 10 * DEG],
    'mixamorigleftleg': -15 * DEG,
    'mixamorigspine': [0, 14 * DEG, 5 * DEG],
  }},
  // Frame 5 (1000ms): Return to center
  { timeOffsetMs: 1000, overrides: {
    'mixamorigspine': [0, 0, 0],
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightleg': 0,
    'mixamorigleftleg': 0,
  }},
]);

sendPose("RESET (after spin)", {}, ["upright_preset"]);

// Squat → Stand transition
sendSequence("Squat → Stand", [
  // Frame 0: Deep squat
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine': 14 * DEG,
    'mixamorigspine1': 14 * DEG,
    'mixamorigrightupleg': [75 * DEG, 0, -10 * DEG],
    'mixamorigleftupleg': [75 * DEG, 0, 10 * DEG],
    'mixamorigrightleg': -120 * DEG,
    'mixamorigleftleg': -120 * DEG,
    'mixamorigrightarm': [50 * DEG, 0, -40 * DEG],
    'mixamorigleftarm': [50 * DEG, 0, 40 * DEG],
    'mixamorigrightforearm': 30 * DEG,
    'mixamorigleftforearm': 30 * DEG,
  }},
  // Frame 1 (300ms): Rise halfway
  { timeOffsetMs: 300, overrides: {
    'mixamorigspine': 10 * DEG,
    'mixamorigspine1': 5 * DEG,
    'mixamorigrightupleg': [40 * DEG, 0, -5 * DEG],
    'mixamorigleftupleg': [40 * DEG, 0, 5 * DEG],
    'mixamorigrightleg': -60 * DEG,
    'mixamorigleftleg': -60 * DEG,
    'mixamorigrightarm': [40 * DEG, 0, -20 * DEG],
    'mixamorigleftarm': [40 * DEG, 0, 20 * DEG],
  }},
  // Frame 2 (600ms): Stand upright
  { timeOffsetMs: 600, overrides: {
    'mixamorigspine': 0,
    'mixamorigspine1': 0,
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightleg': 0,
    'mixamorigleftleg': 0,
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm': [75 * DEG, 0, 0],
  }},
]);

sendPose("RESET (after squat)", {}, ["upright_preset"]);

// Side-step Left
sendSequence("Side-Step Left", [
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine': 0,
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm': [75 * DEG, 0, 0],
  }},
  { timeOffsetMs: 200, overrides: {
    'mixamorigleftupleg': [0, 0, 30 * DEG],
    'mixamorigrightupleg': [0, 0, -10 * DEG],
    'mixamorigrightarm': [75 * DEG, 0, -10 * DEG],
    'mixamorigleftarm': [75 * DEG, 0, 10 * DEG],
  }},
  // Frame 2 (400ms): Shift weight, bring right foot in
  { timeOffsetMs: 400, overrides: {
    'mixamorigleftupleg': [0, 0, 15 * DEG],
    'mixamorigrightupleg': [0, 0, 15 * DEG],
    'mixamorigspine': [0, 0, 5 * DEG],
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm': [75 * DEG, 0, 0],
  }},
  // Frame 3 (600ms): Stand
  { timeOffsetMs: 600, overrides: {
    'mixamorigspine': 0,
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
  }},
]);

sendPose("RESET (after sidestep)", {}, ["upright_preset"]);

// Side-step Right
sendSequence("Side-Step Right", [
  { timeOffsetMs: 0, overrides: {
    'mixamorigspine': 0,
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm': [75 * DEG, 0, 0],
  }},
  { timeOffsetMs: 200, overrides: {
    'mixamorigrightupleg': [0, 0, -30 * DEG],
    'mixamorigleftupleg': [0, 0, 10 * DEG],
    'mixamorigrightarm': [75 * DEG, 0, 10 * DEG],
    'mixamorigleftarm': [75 * DEG, 0, -10 * DEG],
  }},
  { timeOffsetMs: 400, overrides: {
    'mixamorigrightupleg': [0, 0, -15 * DEG],
    'mixamorigleftupleg': [0, 0, -15 * DEG],
    'mixamorigspine': [0, 0, -5 * DEG],
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigleftarm': [75 * DEG, 0, 0],
  }},
  { timeOffsetMs: 600, overrides: {
    'mixamorigspine': 0,
    'mixamorigrightupleg': [0, 0, 0],
    'mixamorigleftupleg': [0, 0, 0],
  }},
]);

// Piano Playing (sequential finger presses on a surface)
sendSequence("Piano: C-E-G-C Scale Run (Right Hand)", [
  // Frame 0: Hand above keys
  { timeOffsetMs: 0, overrides: {
    'mixamorigrightarm': [10 * DEG, 0, -60 * DEG],
    'mixamorigrightforearm': 80 * DEG,
    'mixamorigrighthand': [10 * DEG, 0, 0],
    'mixamorigrighthandthumb1': 10 * DEG, 'mixamorigrighthandthumb2': 10 * DEG, 'mixamorigrighthandthumb3': 5 * DEG,
    'mixamorigrighthandindex1': 10 * DEG, 'mixamorigrighthandindex2': 10 * DEG, 'mixamorigrighthandindex3': 5 * DEG,
    'mixamorigrighthandmiddle1': 10 * DEG, 'mixamorigrighthandmiddle2': 10 * DEG, 'mixamorigrighthandmiddle3': 5 * DEG,
    'mixamorigrighthandring1': 10 * DEG, 'mixamorigrighthandring2': 10 * DEG, 'mixamorigrighthandring3': 5 * DEG,
    'mixamorigrighthandpinky1': 10 * DEG, 'mixamorigrighthandpinky2': 10 * DEG, 'mixamorigrighthandpinky3': 5 * DEG,
  }},
  // Frame 1 (100ms): Thumb presses C
  { timeOffsetMs: 100, overrides: {
    'mixamorigrighthand': [15 * DEG, 0, 0],
    'mixamorigrighthandthumb1': 50 * DEG, 'mixamorigrighthandthumb2': 60 * DEG, 'mixamorigrighthandthumb3': 40 * DEG,
  }},
  // Frame 2 (200ms): Index presses E, thumb releases
  { timeOffsetMs: 200, overrides: {
    'mixamorigrighthand': [15 * DEG, 0, 0],
    'mixamorigrighthandthumb1': 10 * DEG, 'mixamorigrighthandthumb2': 10 * DEG, 'mixamorigrighthandthumb3': 5 * DEG,
    'mixamorigrighthandindex1': 50 * DEG, 'mixamorigrighthandindex2': 60 * DEG, 'mixamorigrighthandindex3': 40 * DEG,
  }},
  // Frame 3 (300ms): Middle presses G, index releases
  { timeOffsetMs: 300, overrides: {
    'mixamorigrighthand': [15 * DEG, 0, 0],
    'mixamorigrighthandindex1': 10 * DEG, 'mixamorigrighthandindex2': 10 * DEG, 'mixamorigrighthandindex3': 5 * DEG,
    'mixamorigrighthandmiddle1': 50 * DEG, 'mixamorigrighthandmiddle2': 60 * DEG, 'mixamorigrighthandmiddle3': 40 * DEG,
  }},
  // Frame 4 (400ms): Ring presses high C, middle releases
  { timeOffsetMs: 400, overrides: {
    'mixamorigrighthand': [15 * DEG, 0, 0],
    'mixamorigrighthandmiddle1': 10 * DEG, 'mixamorigrighthandmiddle2': 10 * DEG, 'mixamorigrighthandmiddle3': 5 * DEG,
    'mixamorigrighthandring1': 50 * DEG, 'mixamorigrighthandring2': 60 * DEG, 'mixamorigrighthandring3': 40 * DEG,
  }},
  // Frame 5 (500ms): Pinky presses highest C, ring releases
  { timeOffsetMs: 500, overrides: {
    'mixamorigrighthand': [15 * DEG, 0, 5 * DEG],
    'mixamorigrighthandring1': 10 * DEG, 'mixamorigrighthandring2': 10 * DEG, 'mixamorigrighthandring3': 5 * DEG,
    'mixamorigrighthandpinky1': 50 * DEG, 'mixamorigrighthandpinky2': 60 * DEG, 'mixamorigrighthandpinky3': 40 * DEG,
  }},
  // Frame 6 (600ms): Release
  { timeOffsetMs: 600, overrides: {
    'mixamorigrighthand': [10 * DEG, 0, 0],
    'mixamorigrighthandpinky1': 10 * DEG, 'mixamorigrighthandpinky2': 10 * DEG, 'mixamorigrighthandpinky3': 5 * DEG,
  }},
]);

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 6: FINGER WIGGLE TIMED SEQUENCES
// ═══════════════════════════════════════════════════════════════════════════════

// Consecutive finger wiggle: thumb → index → middle → ring → pinky
sendSequence("Finger Wiggle: Right Hand (Sequential)", [
  { timeOffsetMs: 0, overrides: {
    'mixamorigrightarm': [75 * DEG, 0, 0],
    'mixamorigrightforearm': 10 * DEG,
    'mixamorigrighthand': [10 * DEG, 0, 0],
    'mixamorigrighthandthumb1': 0, 'mixamorigrighthandthumb2': 0, 'mixamorigrighthandthumb3': 0,
    'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
    'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
    'mixamorigrighthandring1': 0, 'mixamorigrighthandring2': 0, 'mixamorigrighthandring3': 0,
    'mixamorigrighthandpinky1': 0, 'mixamorigrighthandpinky2': 0, 'mixamorigrighthandpinky3': 0,
  }},
  // Frame 1 (200ms): Thumb flexes
  { timeOffsetMs: 200, overrides: {
    'mixamorigrighthandthumb1': 60 * DEG, 'mixamorigrighthandthumb2': 70 * DEG, 'mixamorigrighthandthumb3': 50 * DEG,
  }},
  // Frame 2 (350ms): Thumb extends, index flexes
  { timeOffsetMs: 350, overrides: {
    'mixamorigrighthandthumb1': 0, 'mixamorigrighthandthumb2': 0, 'mixamorigrighthandthumb3': 0,
    'mixamorigrighthandindex1': 70 * DEG, 'mixamorigrighthandindex2': 80 * DEG, 'mixamorigrighthandindex3': 60 * DEG,
  }},
  // Frame 3 (500ms): Index extends, middle flexes
  { timeOffsetMs: 500, overrides: {
    'mixamorigrighthandindex1': 0, 'mixamorigrighthandindex2': 0, 'mixamorigrighthandindex3': 0,
    'mixamorigrighthandmiddle1': 70 * DEG, 'mixamorigrighthandmiddle2': 80 * DEG, 'mixamorigrighthandmiddle3': 60 * DEG,
  }},
  // Frame 4 (650ms): Middle extends, ring flexes
  { timeOffsetMs: 650, overrides: {
    'mixamorigrighthandmiddle1': 0, 'mixamorigrighthandmiddle2': 0, 'mixamorigrighthandmiddle3': 0,
    'mixamorigrighthandring1': 70 * DEG, 'mixamorigrighthandring2': 80 * DEG, 'mixamorigrighthandring3': 60 * DEG,
  }},
  // Frame 5 (800ms): Ring extends, pinky flexes
  { timeOffsetMs: 800, overrides: {
    'mixamorigrighthandring1': 0, 'mixamorigrighthandring2': 0, 'mixamorigrighthandring3': 0,
    'mixamorigrighthandpinky1': 70 * DEG, 'mixamorigrighthandpinky2': 80 * DEG, 'mixamorigrighthandpinky3': 60 * DEG,
  }},
  // Frame 6 (950ms): All relax
  { timeOffsetMs: 950, overrides: {
    'mixamorigrighthandpinky1': 0, 'mixamorigrighthandpinky2': 0, 'mixamorigrighthandpinky3': 0,
  }},
]);

sendPose("RESET (after finger wiggle)", {}, ["upright_preset"]);

// ═══════════════════════════════════════════════════════════════════════════════
// END OF DIAGNOSTIC POSES
// ═══════════════════════════════════════════════════════════════════════════════
// Ready for use. Copy individual sendPose() or sendSequence() calls
// and paste them into the browser console.
//
// Anatomy reference:
//   mixamorighead — [pitch, yaw, roll] — look around
//   mixamorigspine/spine1/spine2 — [pitch, yaw, roll] — torso
//   mixamorigrightarm/leftarm — [pitch, yaw, roll] — shoulder
//   mixamorigrightforearm/leftforearm — flex (scalar) — elbow
//   mixamorigrighthand/lefthand — [flex, dev, 0] — wrist
//   mixamorigrightupleg/leftupleg — [pitch, yaw, roll] — hip
//   mixamorigrightleg/leftleg — flex (scalar) — knee
//   mixamorigrightfoot/leftfoot — [flex, 0, 0] — ankle
//   mixamorigrighttoebase/lefttoebase — [flex, 0, 0] — toe
//   mixamorigright{thumb|index|middle|ring|pinky}{1|2|3} — flex (scalar) — fingers
