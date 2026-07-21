import * as THREE from 'three';
import { MuJoCoPhysicsEngine } from './MuJoCoPhysicsEngine';
import { COMPLETE_MIXAMO_PHYSICS_MATRIX } from '../../constants/physics';
import SYNTHIA_RIG_CONSTRAINTS from '../../constants/rigConstraints';
import { getAnatomicalLimitForBone } from '../../constants/anatomicalLimits';

// Define BONE_JOINT_TYPE
type JointType = 'revolute' | 'spherical' | 'fixed';
const BONE_JOINT_TYPE: Record<string, JointType> = {
  'mixamorigspine': 'spherical',
  'mixamorigspine1': 'spherical',
  'mixamorigspine2': 'spherical',
  'mixamorigneck': 'spherical',
  'mixamorighead': 'spherical',
  'mixamorigleftshoulder': 'spherical',
  'mixamorigrightshoulder': 'spherical',
  'mixamorigleftarm': 'spherical',
  'mixamorigrightarm': 'spherical',
  'mixamorigleftforearm': 'revolute',
  'mixamorigrightforearm': 'revolute',
  'mixamoriglefthand': 'spherical',
  'mixamorigrighthand': 'spherical',
  'mixamorigleftupleg': 'spherical',
  'mixamorigrightupleg': 'spherical',
  'mixamorigleftleg': 'revolute',
  'mixamorigrightleg': 'revolute',
  'mixamorigleftfoot': 'spherical',
  'mixamorigrightfoot': 'spherical',
};

// Add fingers and thumbs
{
  const sides = ['left', 'right'];
  const fingers = ['index', 'middle', 'ring', 'pinky'];
  for (const side of sides) {
    for (const finger of fingers) {
      for (let seg = 1; seg <= 3; seg++) {
        BONE_JOINT_TYPE[`mixamorig${side}hand${finger}${seg}`] = 'spherical';
      }
    }
    for (let seg = 1; seg <= 3; seg++) {
      BONE_JOINT_TYPE[`mixamorig${side}handthumb${seg}`] = 'spherical';
    }
  }
}

const CAPSULE_ATTACH_BONES = new Set([
  'mixamorigspine', 'mixamorigleftupleg', 'mixamorigrightupleg',
]);

function getPhysicsParentName(bone: THREE.Bone, trackedBones: Set<string>): string | null {
  const canonical = bone.name.toLowerCase().replace(/:/g, '');
  if (CAPSULE_ATTACH_BONES.has(canonical)) return null;
  let parent: THREE.Object3D | null = bone.parent;
  while (parent) {
    if (parent instanceof THREE.Bone) {
      const parentCanonical = parent.name.toLowerCase().replace(/:/g, '');
      if (trackedBones.has(parentCanonical)) return parentCanonical;
    }
    parent = parent.parent;
  }
  return null;
}

function getMuJoCoBoneGains(boneName: string): { kp: number; kv: number } {
  const name = boneName.toLowerCase();

  if (name.includes('hand') && (name.includes('index') || name.includes('middle') || name.includes('ring') || name.includes('pinky') || name.includes('thumb'))) {
    return { kp: 5, kv: 1 };
  }
  if (name.includes('upleg') || name.includes('leg')) {
    return { kp: 400, kv: 80 };
  }
  if (name.includes('arm') || name.includes('forearm')) {
    return { kp: 200, kv: 40 };
  }
  if (name.includes('spine')) {
    return { kp: 300, kv: 60 };
  }
  if (name.includes('neck') || name.includes('head')) {
    return { kp: 150, kv: 30 };
  }
  return { kp: 150, kv: 30 };
}

function estimateBoneLength(
  boneName: string,
  boneInfo: { bone: THREE.Bone; worldPosition: THREE.Vector3 },
  allBones: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>
): number {
  const firstChild = boneInfo.bone.children.find((child): child is THREE.Bone => {
    if (!(child instanceof THREE.Bone)) return false;
    return allBones.has(child.name.toLowerCase().replace(/:/g, ''));
  });
  if (firstChild) {
    const childInfo = allBones.get(firstChild.name.toLowerCase().replace(/:/g, ''));
    if (childInfo) {
      const dx = childInfo.worldPosition.x - boneInfo.worldPosition.x;
      const dy = childInfo.worldPosition.y - boneInfo.worldPosition.y;
      const dz = childInfo.worldPosition.z - boneInfo.worldPosition.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  const heuristic: Record<string, number> = {
    'mixamorigspine': 0.25, 'mixamorigneck': 0.10, 'mixamorighead': 0.12,
    'mixamorigleftarm': 0.30, 'mixamorigrightarm': 0.30,
    'mixamorigleftforearm': 0.27, 'mixamorigrightforearm': 0.27,
    'mixamoriglefthand': 0.10, 'mixamorigrighthand': 0.10,
    'mixamorigleftupleg': 0.42, 'mixamorigrightupleg': 0.42,
    'mixamorigleftleg': 0.40, 'mixamorigrightleg': 0.40,
    'mixamorigleftfoot': 0.12, 'mixamorigrightfoot': 0.12,
  };
  return heuristic[boneName] ?? 0.15;
}

export function generateHumanoidMJCF(
  boneInfoMap: Map<string, { bone: THREE.Bone; worldPosition: THREE.Vector3 }>,
  _skeletonOrBones: any,
  capsuleCenterYOrPhysicsMatrix?: any,
  modelRootOrRigConstraints?: any,
  physicsMatrix?: any,
  rigConstraints?: any
): string {
  let capsuleCenterY = 0.9;
  let pMatrix = COMPLETE_MIXAMO_PHYSICS_MATRIX;
  let rConstraints = SYNTHIA_RIG_CONSTRAINTS;

  if (typeof capsuleCenterYOrPhysicsMatrix === 'number') {
    capsuleCenterY = capsuleCenterYOrPhysicsMatrix;
    if (physicsMatrix) pMatrix = physicsMatrix;
    if (rigConstraints) rConstraints = rigConstraints;
  } else {
    if (capsuleCenterYOrPhysicsMatrix) pMatrix = capsuleCenterYOrPhysicsMatrix;
    if (modelRootOrRigConstraints) rConstraints = modelRootOrRigConstraints;
  }

  // Set of tracked bone names
  const trackedBones = new Set<string>();
  for (const canonical of boneInfoMap.keys()) {
    if (BONE_JOINT_TYPE[canonical]) {
      trackedBones.add(canonical);
    }
  }

  const actuators: string[] = [];

  // Model root and Capsule properties
  // Find model root position
  let modelX = 0;
  let modelZ = 0;

  // Use mixamorighips position if available to center the root capsule
  const hipsInfo = boneInfoMap.get('mixamorighips');
  if (hipsInfo) {
    modelX = hipsInfo.worldPosition.x;
    modelZ = hipsInfo.worldPosition.z;
  }

  // Root capsule parameters matching Rapier values
  const modelHeight = 1.8;
  const capsuleRadius = 0.2;
  const capsuleHalfHeight = Math.max(0.1, (modelHeight / 2) - capsuleRadius);

  const capsulePosThree = { x: modelX, y: capsuleCenterY, z: modelZ };
  const capsulePosMj = MuJoCoPhysicsEngine.worldToMuJoCo(capsulePosThree);
  const capsuleQuatMj = [1, 0, 0, 0]; // Identity rotation w,x,y,z

  // Root capsule coordinates and orientation in MuJoCo space
  const rootCapsulePosStr = `${capsulePosMj[0]} ${capsulePosMj[1]} ${capsulePosMj[2]}`;
  const rootCapsuleQuatStr = `${capsuleQuatMj[0]} ${capsuleQuatMj[1]} ${capsuleQuatMj[2]} ${capsuleQuatMj[3]}`;

  // Helper to build recursive bodies
  const buildBodyTreeXML = (boneName: string, parentPos: [number, number, number], parentQuat: [number, number, number, number]): string => {
    const boneInfo = boneInfoMap.get(boneName);
    if (!boneInfo) return '';

    const bone = boneInfo.bone;

    // Get child absolute position/rotation in Three.js space
    const threePos = boneInfo.worldPosition.clone();
    const threeQuat = new THREE.Quaternion();
    bone.getWorldQuaternion(threeQuat);

    // Convert child absolute position/rotation to MuJoCo space
    const childPosMj = MuJoCoPhysicsEngine.worldToMuJoCo(threePos);
    const childQuatMj = MuJoCoPhysicsEngine.threeQuatToMuJoCo(threeQuat);

    // Using THREE to calculate relative pos and quat to parent in MuJoCo space
    const pChild = new THREE.Vector3(...childPosMj);
    const qChild = new THREE.Quaternion(childQuatMj[1], childQuatMj[2], childQuatMj[3], childQuatMj[0]);

    const pParent = new THREE.Vector3(...parentPos);
    const qParent = new THREE.Quaternion(parentQuat[1], parentQuat[2], parentQuat[3], parentQuat[0]);

    const pRel = pChild.clone().sub(pParent).applyQuaternion(qParent.clone().invert());
    const qRel = qParent.clone().invert().multiply(qChild);

    const posStr = `${pRel.x} ${pRel.y} ${pRel.z}`;
    const quatStr = `${qRel.w} ${qRel.x} ${qRel.y} ${qRel.z}`;

    // Get bone properties
    const phys = pMatrix[boneName] || { mass: 0.5, principalInertia: { x: 0.005, y: 0.002, z: 0.005 } };

    // Inertial principal moments mapped from Three local to MuJoCo local
    // (Three Y-axis mapped to MuJoCo Z-axis)
    const ixx = phys.principalInertia.x;
    const iyy = phys.principalInertia.z;
    const izz = phys.principalInertia.y;

    let geomXML = '';
    const isFoot = boneName.includes('foot');
    if (isFoot) {
      // Foot box dimensions swap Y and Z
      const FOOT_COLLIDER_HALF_WIDTH = 0.05;
      const FOOT_COLLIDER_HALF_HEIGHT = 0.01;
      const FOOT_COLLIDER_HALF_LENGTH = 0.11;
      // Local sole offset in Three is (0, -0.02, 0). Swapped to MuJoCo: (0, 0, 0.02)
      geomXML = `<geom name="${boneName}_geom" type="box" size="${FOOT_COLLIDER_HALF_WIDTH} ${FOOT_COLLIDER_HALF_LENGTH} ${FOOT_COLLIDER_HALF_HEIGHT}" pos="0 0 0.02" contype="2" conaffinity="1"/>`;
    } else {
      const boneLength = estimateBoneLength(boneName, boneInfo, boneInfoMap);
      const colRadius = 0.04;
      const colHalfHeight = Math.max(0.02, boneLength / 2 - colRadius);
      // Capsule aligned with Z-axis
      geomXML = `<geom name="${boneName}_geom" type="capsule" size="${colRadius} ${colHalfHeight}" pos="0 0 0" contype="2" conaffinity="1"/>`;
    }

    // Joint declarations
    let jointsXML = '';
    const jointType = BONE_JOINT_TYPE[boneName] || 'spherical';

    // Retrieve constraints and limits
    const constraint = rConstraints[boneName];
    const limits = getAnatomicalLimitForBone(boneName);

    const getSafeRangeStr = (min: number, max: number): string => {
      const sMin = isFinite(min) ? min : -3.14159;
      const sMax = isFinite(max) ? max : 3.14159;
      return `${sMin} ${sMax}`;
    };

    const gains = getMuJoCoBoneGains(boneName);
    const kp = gains.kp;
    const kv = gains.kv;

    if (jointType === 'revolute' || (constraint && constraint.dof === 1)) {
      // Single Hinge Joint (Pitch: axis 1 0 0)
      const min = constraint?.x?.[0] ?? limits?.min ?? -2.618;
      const max = constraint?.x?.[1] ?? limits?.max ?? 0;
      jointsXML = `<joint name="${boneName}_pitch" type="hinge" axis="1 0 0" range="${getSafeRangeStr(min, max)}" limited="true"/>`;
      actuators.push(`<position name="act_${boneName}_pitch" joint="${boneName}_pitch" kp="${kp}" kv="${kv}" ctrlrange="${getSafeRangeStr(min, max)}"/>`);
    } else if (constraint && constraint.dof === 2) {
      // 2-DOF Joint Decomposed into Pitch (1 0 0) and Roll (0 1 0)
      const minX = constraint.x[0], maxX = constraint.x[1];
      const minZ = constraint.z[0], maxZ = constraint.z[1];
      jointsXML = `
        <joint name="${boneName}_pitch" type="hinge" axis="1 0 0" range="${getSafeRangeStr(minX, maxX)}" limited="true"/>
        <joint name="${boneName}_roll" type="hinge" axis="0 1 0" range="${getSafeRangeStr(minZ, maxZ)}" limited="true"/>
      `;
      actuators.push(`<position name="act_${boneName}_pitch" joint="${boneName}_pitch" kp="${kp}" kv="${kv}" ctrlrange="${getSafeRangeStr(minX, maxX)}"/>`);
      actuators.push(`<position name="act_${boneName}_roll" joint="${boneName}_roll" kp="${kp}" kv="${kv}" ctrlrange="${getSafeRangeStr(minZ, maxZ)}"/>`);
    } else {
      // 3-DOF Joint Decomposed into Yaw (0 0 1) -> Pitch (1 0 0) -> Roll (0 1 0)
      const minX = constraint?.x?.[0] ?? limits?.min ?? -0.785;
      const maxX = constraint?.x?.[1] ?? limits?.max ?? 0.785;
      const minY = constraint?.y?.[0] ?? -0.785;
      const maxY = constraint?.y?.[1] ?? 0.785;
      const minZ = constraint?.z?.[0] ?? -0.785;
      const maxZ = constraint?.z?.[1] ?? 0.785;
      jointsXML = `
        <joint name="${boneName}_yaw" type="hinge" axis="0 0 1" range="${getSafeRangeStr(minY, maxY)}" limited="true"/>
        <joint name="${boneName}_pitch" type="hinge" axis="1 0 0" range="${getSafeRangeStr(minX, maxX)}" limited="true"/>
        <joint name="${boneName}_roll" type="hinge" axis="0 1 0" range="${getSafeRangeStr(minZ, maxZ)}" limited="true"/>
      `;
      actuators.push(`<position name="act_${boneName}_yaw" joint="${boneName}_yaw" kp="${kp}" kv="${kv}" ctrlrange="${getSafeRangeStr(minY, maxY)}"/>`);
      actuators.push(`<position name="act_${boneName}_pitch" joint="${boneName}_pitch" kp="${kp}" kv="${kv}" ctrlrange="${getSafeRangeStr(minX, maxX)}"/>`);
      actuators.push(`<position name="act_${boneName}_roll" joint="${boneName}_roll" kp="${kp}" kv="${kv}" ctrlrange="${getSafeRangeStr(minZ, maxZ)}"/>`);
    }

    // Recursively build children
    const childBones = Array.from(trackedBones).filter(b => getPhysicsParentName(boneInfoMap.get(b)!.bone, trackedBones) === boneName);
    const childrenXML = childBones.map(cb => buildBodyTreeXML(cb, childPosMj as [number, number, number], childQuatMj as [number, number, number, number])).join('\n');

    return `
      <body name="${boneName}" pos="${posStr}" quat="${quatStr}">
        <inertial pos="0 0 0" mass="${phys.mass}" diaginertia="${ixx} ${iyy} ${izz}"/>
        ${jointsXML}
        ${geomXML}
        ${childrenXML}
      </body>
    `.trim();
  };

  // Build the spine, left leg, and right leg branches under the root capsule
  const spineBranch = buildBodyTreeXML('mixamorigspine', capsulePosMj as [number, number, number], capsuleQuatMj as [number, number, number, number]);
  const leftLegBranch = buildBodyTreeXML('mixamorigleftupleg', capsulePosMj as [number, number, number], capsuleQuatMj as [number, number, number, number]);
  const rightLegBranch = buildBodyTreeXML('mixamorigrightupleg', capsulePosMj as [number, number, number], capsuleQuatMj as [number, number, number, number]);

  // Return the complete MJCF XML
  const xml = `
<mujoco model="synthia_humanoid">
  <compiler angle="radian" coordinate="local"/>
  <option gravity="0 0 -9.81" timestep="0.01667" iterations="100"/>
  <worldbody>
    <light directional="true" pos="0 0 5" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="100 100 0.1" rgba="0.8 0.9 0.8 1" contype="1" conaffinity="2"/>

    <body name="root_capsule" pos="${rootCapsulePosStr}" quat="${rootCapsuleQuatStr}">
      <freejoint name="root_freejoint"/>
      <geom name="root_capsule_geom" type="capsule" size="${capsuleRadius} ${capsuleHalfHeight}" pos="0 0 0" contype="2" conaffinity="1"/>
      <inertial pos="0 0 0" mass="70" diaginertia="10.0 10.0 10.0"/>

      ${spineBranch}
      ${leftLegBranch}
      ${rightLegBranch}
    </body>
  </worldbody>

  <actuator>
    ${actuators.join('\n    ')}
  </actuator>
</mujoco>
  `.trim();

  return xml;
}
