import { ObjectPreset } from '../../constants/objectPresets';
import { MainModule, MjModel, MjData } from '@mujoco/mujoco';

export interface ContactPair {
  geom1Id: number;
  geom2Id: number;
  name1: string;
  name2: string;
  dist: number;
  position: [number, number, number];
  contactNormal: [number, number, number];
  force: number;
}

export class CollisionAdapter {
  /**
   * Helper to map Rapier preset shape properties to MuJoCo XML geoms
   */
  public static objectPresetToMJCFGeom(preset: ObjectPreset): { geomType: string; size: string } {
    switch (preset.id) {
      case 'sphere':
        return { geomType: 'sphere', size: '0.5' };
      case 'cylinder':
        return { geomType: 'cylinder', size: '0.5 0.5' };
      case 'wedge':
      case 'slope':
      case 'ramp':
        // Rotated box represented as wedge/slope/ramp
        return { geomType: 'box', size: '0.5 0.5 0.5' };
      case 'cube':
      default:
        return { geomType: 'box', size: '0.5 0.5 0.5' };
    }
  }

  /**
   * Reads the MuJoCo contact array and parses active contact pairs.
   */
  public static getCollisionPairs(
    module: MainModule,
    model: MjModel,
    data: MjData
  ): ContactPair[] {
    const pairs: ContactPair[] = [];
    const ncon = data.ncon;
    if (ncon <= 0) return pairs;

    // Use a DoubleBuffer of size 6 to store the 6D contact force/torque
    const forceBuffer = new module.DoubleBuffer(6);

    for (let i = 0; i < ncon; i++) {
      try {
        const contact = data.contact.get(i);
        if (!contact) continue;

        const geom1 = contact.geom1;
        const geom2 = contact.geom2;
        const dist = contact.dist;

        // Retrieve contact force using the official C-API function mj_contactForce
        module.mj_contactForce(model, data, i, forceBuffer);

        const forceView = forceBuffer.GetView();
        const normalForce = forceView[0];
        const frictionForce1 = forceView[1];
        const frictionForce2 = forceView[2];
        const forceMagnitude = Math.sqrt(
          normalForce * normalForce +
          frictionForce1 * frictionForce1 +
          frictionForce2 * frictionForce2
        );

        const name1 = module.mj_id2name(model, module.mjtObj.mjOBJ_GEOM.value, geom1) || `geom_${geom1}`;
        const name2 = module.mj_id2name(model, module.mjtObj.mjOBJ_GEOM.value, geom2) || `geom_${geom2}`;

        const frame = contact.frame;
        const contactNormal: [number, number, number] = [frame.get(0), frame.get(1), frame.get(2)];
        const contactPos: [number, number, number] = [contact.pos.get(0), contact.pos.get(1), contact.pos.get(2)];

        pairs.push({
          geom1Id: geom1,
          geom2Id: geom2,
          name1,
          name2,
          dist,
          position: contactPos,
          contactNormal,
          force: forceMagnitude,
        });
      } catch (err) {
        // safe recovery on contact index error
      }
    }

    forceBuffer.delete();
    return pairs;
  }

  /**
   * Check if a specific geom ID is currently in contact with anything in the simulation.
   */
  public static isGeomInContact(data: MjData, geomId: number): boolean {
    const ncon = data.ncon;
    for (let i = 0; i < ncon; i++) {
      const contact = data.contact.get(i);
      if (contact && (contact.geom1 === geomId || contact.geom2 === geomId)) {
        return true;
      }
    }
    return false;
  }
}
