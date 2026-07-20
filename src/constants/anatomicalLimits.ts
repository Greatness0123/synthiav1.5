/**
 * Anatomically correct joint range-of-motion limits (radians).
 * Used for humanoid bone motor targets and ragdoll Rapier joints.
 */

export interface AnatomicalLimit {
  min: number;
  max: number;
}

const DEG = Math.PI / 180;

/** Resolve anatomical limits for a canonical bone name (lowercase, no colons). */
export function getAnatomicalLimitForBone(boneName: string): AnatomicalLimit | null {
  const n = boneName.toLowerCase().replace(/:/g, '');

  // KNEE: 0° to -150° flexion only
  if (n.includes('knee') || (n.includes('leg') && !n.includes('upleg') && !n.includes('foreleg'))) {
    return { min: -150 * DEG, max: 0 };
  }

  // ELBOW / forearm: flexion only 0° to +145°
  if (n.includes('elbow') || n.includes('forearm')) {
    return { min: 0, max: 145 * DEG };
  }

  // Fingers / toes: flexion only 0° to +100°
  if (
    n.includes('thumb') || n.includes('index') || n.includes('middle') ||
    n.includes('ring') || n.includes('pinky') || n.includes('toe')
  ) {
    return { min: 0, max: 100 * DEG };
  }

  // WRIST / hand: ±80° flexion, ±20° deviation — use primary flex axis limit
  if (n.includes('wrist') || (n.includes('hand') && !n.includes('shoulder'))) {
    return { min: -80 * DEG, max: 80 * DEG };
  }

  // ANKLE / foot
  if (n.includes('ankle') || n.includes('foot')) {
    return { min: -45 * DEG, max: 45 * DEG };
  }

  // NECK / cervical
  if (n.includes('neck') || n.includes('cervical')) {
    return { min: -60 * DEG, max: 60 * DEG };
  }

  // HEAD on neck
  if (n.includes('head') && !n.includes('shoulder')) {
    return { min: -45 * DEG, max: 45 * DEG };
  }

  // SPINE segments: ±30° per segment to support expressive diagnostic poses
  if (
    n.includes('spine') || n.includes('lumbar') || n.includes('thoracic') ||
    n.includes('chest') || n.includes('hips')
  ) {
    return { min: -30 * DEG, max: 30 * DEG };
  }

  // SHOULDER / upper arm (Mixamo names them mixamorigRightArm / LeftArm)
  if (n.includes('shoulder') || n.includes('upperarm') || n.includes('uparm') || (n.includes('arm') && !n.includes('forearm'))) {
    return { min: -180 * DEG, max: 180 * DEG };
  }

  // HIP / up leg
  if (n.includes('upleg') || n.includes('hip')) {
    return { min: -120 * DEG, max: 120 * DEG };
  }

  return null;
}

export function clampToAnatomicalLimit(boneName: string, angle: number): number {
  const limits = getAnatomicalLimitForBone(boneName);
  if (!limits) return angle;
  return Math.max(limits.min, Math.min(limits.max, angle));
}

export function isWithinAnatomicalLimit(boneName: string, angle: number): boolean {
  const limits = getAnatomicalLimitForBone(boneName);
  if (!limits) return true;
  return angle >= limits.min && angle <= limits.max;
}

/** Map ragdoll JointConfig name to Rapier joint limits for revolute (1 DOF) joints. */
export function getRagdollJointLimits(configName: string, dof: number): AnatomicalLimit | null {
  if (dof === 1) {
    return getAnatomicalLimitForBone(configName);
  }
  if (dof === 2) {
    // Ankle-like: primary axis ±45°
    if (configName.includes('ankle') || configName.includes('wrist')) {
      return { min: -45 * DEG, max: 45 * DEG };
    }
  }
  if (dof === 3) {
    // Spherical joints: use swing limit as ±120° on primary axis
    if (configName.includes('hip') || configName.includes('shoulder')) {
      return { min: -120 * DEG, max: 120 * DEG };
    }
    if (configName.includes('spine') || configName.includes('neck') || configName.includes('head') || configName.includes('pelvis')) {
      return { min: -15 * DEG, max: 15 * DEG };
    }
  }
  return null;
}

export const MAX_LINEAR_VELOCITY = 8.0;
export const MAX_ANGULAR_VELOCITY = 6.0;
export const WORLD_BOUNDARY_RADIUS = 50;
