/**
 * The 10 skill rungs representing the agent's progression.
 */

export interface SkillRung {
  id: number;
  name: string;
  description: string;
  criteria: string;
}

export const SKILL_RUNGS: SkillRung[] = [
  { id: 0, name: 'Static Balance', description: 'Maintain upright posture without movement.', criteria: 'Balance > 10s' },
  { id: 1, name: 'Single Step', description: 'Shift weight and move one foot forward.', criteria: '1 Successful Step' },
  { id: 2, name: 'Linear Walk', description: 'Continuous forward locomotion.', criteria: 'Walk > 5m' },
  { id: 3, name: 'Directional Turning', description: 'Change walking direction while moving.', criteria: '90° Turn' },
  { id: 4, name: 'Obstacle Avoidance', description: 'Navigate around static objects.', criteria: '0 Collisions' },
  { id: 5, name: 'Dynamic Recovery', description: 'Recover from external pushes/disturbances.', criteria: '0 Falls' },
  { id: 6, name: 'Stair Ascent', description: 'Climb a series of steps.', criteria: '3 Steps Up' },
  { id: 7, name: 'Object Manipulation', description: 'Pick up and move an object.', criteria: 'Relocate Object' },
  { id: 8, name: 'Complex Navigation', description: 'Pathfinding in cluttered environments.', criteria: 'Reach Goal' },
  { id: 9, name: 'Full Autonomy', description: 'Execute multi-stage directives.', criteria: 'Dynamic Objective' },
];
