/**
 * Physics-related constants for the simulation.
 *
 * Contains collision group definitions, bitmask helpers, and the complete
 * anthropomorphic mass and inertia tensor matrix for Mixamo humanoid rigs.
 */

export const RAGDOLL_GROUP = 0x0001;
export const ENVIRONMENT_GROUP = 0x0002;

/**
 * Rapier collision groups use a 32-bit mask:
 * - High 16 bits: membership (what group this collider belongs to)
 * - Low 16 bits: filter (what groups it collides with)
 */
export const getCollisionMask = (membership: number, filter: number): number => {
  return (membership << 16) | filter;
};

// ── MUJOCO COLLISION CONSTANTS ─────────────────────────────────────────
// Bit 0 = Ragdoll
// Bit 1 = Environment
// NOTE: The live contype/conaffinity scheme here is limbs=2/1 and floor/environment=1/2 (bits 0 and 1).
// This is inverted from the original Phase 4 spec (which proposed ragdoll=1/2, env=2/3) but is
// internally consistent and actively used across the codebase.
// Any future additions/modifications must copy these actual live values, not the old spec.
export const RAGDOLL_CONTYPE = 1;      // Bit 0
export const RAGDOLL_CONAFFINITY = 2;   // Bit 1 (collides with environment)

export const ENVIRONMENT_CONTYPE = 2;  // Bit 1
export const ENVIRONMENT_CONAFFINITY = 3;// Bits 0+1 (collides with ragdoll and environment)

// ═══════════════════════════════════════════════════════════════════════════
// ANTHROPOMORPHIC BODY PHYSICS MATRIX
// ═══════════════════════════════════════════════════════════════════════════
//
// Mass values (kg) and diagonal principal inertia tensors (Ixx, Iyy, Izz in
// kg·m²) calibrated for a ~75 kg adult humanoid.  Each bone name is the
// canonical (lowercase, colon-stripped) Mixamo bone identifier used throughout
// the Synthia codebase.
//
// Inertia design philosophy:
//   - Iyy (twist along bone axis) ≈ Ixx/3 for long bones (arms, legs)
//     reflecting the skeletal reality that long cylinders rotate freely on
//     their primary axis but heavily resist transverse flexing.
//   - Proximal-to-distal mass stepping: each segment is 50-60% the mass of
//     its parent.  Forearm (1.4 kg) subordinate to upper arm (2.2 kg) means
//     reaction torques from forearm PD are absorbed by the larger inertia,
//     instantly killing "jackhammer" feedback loops.
//   - Spine segments distribute 27 kg total across 5 segments with a smooth
//     gradient (hips: 12 → spine: 6 → spine1: 5 → spine2: 4).
//   - Finger phalanges have micro-mass (0.008-0.02 kg) so fine-motor PD
//     updates don't drag the entire arm structure.
// ═══════════════════════════════════════════════════════════════════════════

export interface BonePhysicalProperties {
  mass: number;
  principalInertia: { x: number; y: number; z: number };
}

/**
 * Complete Mixamo humanoid physics matrix.  Every bone that appears in the
 * Synthia multi-body PD system has an entry here.
 *
 * NOTE ON NAMING: The codebase canonical names are used (colons stripped,
 * lowercase).  The user-provided table uses `mixamorigleftuparm`; the
 * actual Mixamo bone in the project's skeleton is `mixamorigleftarm`.
 * We write the correct canonical names.
 */
export const COMPLETE_MIXAMO_PHYSICS_MATRIX: Record<string, BonePhysicalProperties> = {
  // ── CORE AXIAL SKELETON ───────────────────────────────────────────────
  // These bones form the central pillar of the body and carry the heaviest
  // mass fractions.  Together they sum to ~32.5 kg.
  "mixamorighips": { mass: 12.0, principalInertia: { x: 0.450, y: 0.350, z: 0.400 } },
  "mixamorigspine": { mass: 6.0, principalInertia: { x: 0.200, y: 0.100, z: 0.180 } },
  "mixamorigspine1": { mass: 5.0, principalInertia: { x: 0.150, y: 0.080, z: 0.140 } },
  "mixamorigspine2": { mass: 4.0, principalInertia: { x: 0.120, y: 0.060, z: 0.110 } },
  "mixamorigneck": { mass: 1.2, principalInertia: { x: 0.015, y: 0.010, z: 0.015 } },
  "mixamorighead": { mass: 4.3, principalInertia: { x: 0.040, y: 0.035, z: 0.040 } },

  // ── LEFT UPPER LIMB ───────────────────────────────────────────────────
  // Proximal-to-distal: shoulder 1.5 → upper arm 2.2 → forearm 1.4 → hand 0.4
  // Note: the Mixamo bone is `mixamorigleftarm`, not `mixamorigleftuparm`.
  // The shoulder clavicle bones ARE `mixamorigleftshoulder` / `mixamorigrightshoulder`.
  "mixamorigleftshoulder": { mass: 1.5, principalInertia: { x: 0.020, y: 0.005, z: 0.020 } },
  "mixamorigleftarm": { mass: 2.2, principalInertia: { x: 0.030, y: 0.010, z: 0.030 } },
  "mixamorigleftforearm": { mass: 1.4, principalInertia: { x: 0.020, y: 0.008, z: 0.020 } },
  "mixamoriglefthand": { mass: 0.4, principalInertia: { x: 0.005, y: 0.002, z: 0.005 } },

  // ── RIGHT UPPER LIMB ──────────────────────────────────────────────────
  "mixamorigrightshoulder": { mass: 1.5, principalInertia: { x: 0.020, y: 0.005, z: 0.020 } },
  "mixamorigrightarm": { mass: 2.2, principalInertia: { x: 0.030, y: 0.010, z: 0.030 } },
  "mixamorigrightforearm": { mass: 1.4, principalInertia: { x: 0.020, y: 0.008, z: 0.020 } },
  "mixamorigrighthand": { mass: 0.4, principalInertia: { x: 0.005, y: 0.002, z: 0.005 } },

  // ── LEFT LOWER LIMB ───────────────────────────────────────────────────
  // Thighs (upleg) 8.5 kg × 2  →  15.5 kg total in both legs.
  // The massive thigh inertia (0.15, 0.05, 0.15) damps capsule root sway.
  "mixamorigleftupleg": { mass: 8.5, principalInertia: { x: 0.150, y: 0.050, z: 0.150 } },
  "mixamorigleftleg": { mass: 4.2, principalInertia: { x: 0.100, y: 0.030, z: 0.100 } },
  "mixamorigleftfoot": { mass: 1.1, principalInertia: { x: 0.010, y: 0.005, z: 0.010 } },

  // ── RIGHT LOWER LIMB ──────────────────────────────────────────────────
  "mixamorigrightupleg": { mass: 8.5, principalInertia: { x: 0.150, y: 0.050, z: 0.150 } },
  "mixamorigrightleg": { mass: 4.2, principalInertia: { x: 0.100, y: 0.030, z: 0.100 } },
  "mixamorigrightfoot": { mass: 1.1, principalInertia: { x: 0.010, y: 0.005, z: 0.010 } },

  // ══════════════════════════════════════════════════════════════════════
  // DEXTEROUS DIGITS — LEFT HAND
  // ══════════════════════════════════════════════════════════════════════
  // All finger bones follow the canonical pattern:
  //   mixamorig{left|right}hand{index|middle|ring|pinky}{1|2|3}
  // and
  //   mixamorig{left|right}handthumb{1|2|3}
  //
  // Micro-mass (0.008–0.02 kg) ensures fine-motor tracking does not drag
  // the hand/arm rigid-body subsystem.
  "mixamoriglefthandthumb1": { mass: 0.020, principalInertia: { x: 0.00010, y: 0.00005, z: 0.00010 } },
  "mixamoriglefthandthumb2": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamoriglefthandthumb3": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamoriglefthandindex1": { mass: 0.020, principalInertia: { x: 0.00010, y: 0.00005, z: 0.00010 } },
  "mixamoriglefthandindex2": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamoriglefthandindex3": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamoriglefthandmiddle1": { mass: 0.020, principalInertia: { x: 0.00010, y: 0.00005, z: 0.00010 } },
  "mixamoriglefthandmiddle2": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamoriglefthandmiddle3": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamoriglefthandring1": { mass: 0.020, principalInertia: { x: 0.00010, y: 0.00005, z: 0.00010 } },
  "mixamoriglefthandring2": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamoriglefthandring3": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamoriglefthandpinky1": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamoriglefthandpinky2": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamoriglefthandpinky3": { mass: 0.008, principalInertia: { x: 0.00002, y: 0.00001, z: 0.00002 } },

  // ══════════════════════════════════════════════════════════════════════
  // DEXTEROUS DIGITS — RIGHT HAND
  // ══════════════════════════════════════════════════════════════════════
  "mixamorigrighthandthumb1": { mass: 0.020, principalInertia: { x: 0.00010, y: 0.00005, z: 0.00010 } },
  "mixamorigrighthandthumb2": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamorigrighthandthumb3": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamorigrighthandindex1": { mass: 0.020, principalInertia: { x: 0.00010, y: 0.00005, z: 0.00010 } },
  "mixamorigrighthandindex2": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamorigrighthandindex3": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamorigrighthandmiddle1": { mass: 0.020, principalInertia: { x: 0.00010, y: 0.00005, z: 0.00010 } },
  "mixamorigrighthandmiddle2": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamorigrighthandmiddle3": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamorigrighthandring1": { mass: 0.020, principalInertia: { x: 0.00010, y: 0.00005, z: 0.00010 } },
  "mixamorigrighthandring2": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamorigrighthandring3": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamorigrighthandpinky1": { mass: 0.015, principalInertia: { x: 0.00007, y: 0.00003, z: 0.00007 } },
  "mixamorigrighthandpinky2": { mass: 0.010, principalInertia: { x: 0.00004, y: 0.00002, z: 0.00004 } },
  "mixamorigrighthandpinky3": { mass: 0.008, principalInertia: { x: 0.00002, y: 0.00001, z: 0.00002 } },
};

/**
 * Default physical properties for bones not found in the matrix
 * (e.g., toe bases, custom rig extensions).
 */
export const DEFAULT_BONE_PHYSICS: BonePhysicalProperties = {
  mass: 0.5,
  principalInertia: { x: 0.005, y: 0.002, z: 0.005 },
};

/**
 * Lookup helper: return the physical properties for a canonical bone name,
 * falling back to the sensible default.
 */
export function getBonePhysics(boneName: string): BonePhysicalProperties {
  const entry = COMPLETE_MIXAMO_PHYSICS_MATRIX[boneName];
  if (entry) return entry;
  // Warn once per missing bone (callers can filter duplicates)
  return DEFAULT_BONE_PHYSICS;
}
