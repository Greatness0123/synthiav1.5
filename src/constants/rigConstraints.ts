import { JointLimit } from '../types/joint';

// Radian constants provided directly per specification
export const SYNTHIA_RIG_CONSTRAINTS: Record<string, JointLimit> = (() => {
  const map: Record<string, JointLimit> = {};

  // ZONE 1: SPINE, NECK, TORSO
  map['mixamorighips'] = { dof: 6, x: [-Infinity, Infinity], y: [-Infinity, Infinity], z: [-Infinity, Infinity] };
  map['mixamorigspine'] = { dof: 3, x: [-0.26, 0.52], y: [-0.524, 0.524], z: [-0.524, 0.524], allowance: { locomotionCap: 1.0 } };
  map['mixamorigspine1'] = { dof: 3, x: [-0.524, 0.524], y: [-0.524, 0.524], z: [-0.524, 0.524] };
  map['mixamorigspine2'] = { dof: 3, x: [-0.524, 0.524], y: [-0.524, 0.524], z: [-0.524, 0.524] };
  map['mixamorigneck'] = { dof: 3, x: [-1.047, 1.047], y: [-1.047, 1.047], z: [-1.047, 1.047], allowance: { requiresCervicalCoupling: true } };
  map['mixamorighead'] = { dof: 3, x: [-0.785, 0.785], y: [-0.785, 0.785], z: [-0.785, 0.785] };

  // ZONE 2: ARMS AND SHOULDERS
  map['mixamorigleftshoulder'] = { dof: 3, x: [-0.261, 0.261], y: [-0.261, 0.261], z: [-0.261, 0.261] };
  map['mixamorigrightshoulder'] = { dof: 3, x: [-0.261, 0.261], y: [-0.261, 0.261], z: [-0.261, 0.261] };
  // FIX 7: Tighten arm X-axis adduction limits to prevent chest clipping.
  // Left arm: bring hand to right shoulder (60° adduction) but not beyond midline.
  // Right arm: mirror.
  map['mixamorigleftarm'] = { dof: 3, x: [-2.356, 1.047], y: [-1.57, 1.57], z: [-1.57, 1.57], allowance: { scapulohumeralRatio: 2.0 } };
  map['mixamorigrightarm'] = { dof: 3, x: [-1.047, 2.356], y: [-1.57, 1.57], z: [-1.57, 1.57], allowance: { scapulohumeralRatio: 2.0 } };
  map['mixamorigleftforearm'] = { dof: 1, x: [0.0, 2.531], y: [0.0, 0.0], z: [0.0, 0.0] };
  map['mixamorigrightforearm'] = { dof: 1, x: [0.0, 2.531], y: [0.0, 0.0], z: [0.0, 0.0] };

  // ZONE 3: WRISTS AND DIGITS
  map['mixamoriglefthand'] = { dof: 2, x: [-1.396, 1.396], y: [0.0, 0.0], z: [-0.349, 0.349], allowance: { dartThrowingOblique: true } };
  map['mixamorigrighthand'] = { dof: 2, x: [-1.396, 1.396], y: [0.0, 0.0], z: [-0.349, 0.349], allowance: { dartThrowingOblique: true } };

  // Fingers & Thumbs base pattern
  // NOTE: Mixamo models name finger bones with a "Hand" segment in the path,
  // e.g. mixamorigRightHandIndex1, mixamorigRightHandThumb1, etc.
  const fingers = ['index', 'middle', 'ring', 'pinky'];
  const sides = ['left', 'right'];
  for (const side of sides) {
    for (const finger of fingers) {
      for (let seg = 1; seg <= 3; seg++) {
      const name = `mixamorig${side}hand${finger}${seg}`;
        const isTerminalSynergy = seg === 2 || seg === 3;
        map[name] = {
          dof: 1,
          x: [0.0, 1.745],
          y: [0.0, 0.0],
          z: [0.0, 0.0],
          allowance: isTerminalSynergy ? { tendonSynergyLink: true } : undefined,
        } as JointLimit;
      }
    }

    // Thumb segments
    for (let seg = 1; seg <= 3; seg++) {
      const name = `mixamorig${side}handthumb${seg}`;
      const isTerminalSynergy = seg === 2 || seg === 3;
      map[name] = {
        dof: 1,
        x: [0.0, 1.745],
        y: [0.0, 0.0],
        z: [0.0, 0.0],
        allowance: isTerminalSynergy ? { tendonSynergyLink: true } : undefined,
      } as JointLimit;
    }
  }

  // ZONE 4: LEGS AND LOWER EXTREMITIES
  map['mixamorigleftupleg'] = { dof: 3, x: [-2.094, 2.094], y: [-2.094, 2.094], z: [-2.094, 2.094], allowance: { locomotionCap: 0.78 } };
  map['mixamorigrightupleg'] = { dof: 3, x: [-2.094, 2.094], y: [-2.094, 2.094], z: [-2.094, 2.094], allowance: { locomotionCap: 0.78 } };
  map['mixamorigleftleg'] = { dof: 1, x: [-2.618, 0.0], y: [0.0, 0.0], z: [0.0, 0.0], allowance: { locomotionCap: 0.80 } };
  map['mixamorigrightleg'] = { dof: 1, x: [-2.618, 0.0], y: [0.0, 0.0], z: [0.0, 0.0], allowance: { locomotionCap: 0.80 } };
  map['mixamorigleftfoot'] = { dof: 2, x: [-0.785, 0.785], y: [0.0, 0.0], z: [-0.785, 0.785] };
  map['mixamorigrightfoot'] = { dof: 2, x: [-0.785, 0.785], y: [0.0, 0.0], z: [-0.785, 0.785] };
  map['mixamoriglefttoebase'] = { dof: 1, x: [-1.745, 0.0], y: [0.0, 0.0], z: [0.0, 0.0] };
  map['mixamorigrighttoebase'] = { dof: 1, x: [-1.745, 0.0], y: [0.0, 0.0], z: [0.0, 0.0] };

  return map;
})();

export default SYNTHIA_RIG_CONSTRAINTS;
