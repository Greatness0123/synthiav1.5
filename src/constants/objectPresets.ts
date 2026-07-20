/**
 * Library of spawnable object presets with physics properties and UI icons.
 */

export interface ObjectPreset {
  id: string;
  name: string;
  category: 'Primitives' | 'Terrain' | 'Interactive';
  icon: string; // Phosphor icon name
  mass: number;
  friction: number;
  restitution: number;
}

export const OBJECT_PRESETS: ObjectPreset[] = [
  { id: 'cube', name: 'Cube', category: 'Primitives', icon: 'Cube', mass: 1, friction: 0.5, restitution: 0.2 },
  { id: 'sphere', name: 'Sphere', category: 'Primitives', icon: 'Circle', mass: 1, friction: 0.3, restitution: 0.8 },
  { id: 'cylinder', name: 'Cylinder', category: 'Primitives', icon: 'Cylinder', mass: 1, friction: 0.5, restitution: 0.2 },
  { id: 'wedge', name: 'Wedge', category: 'Primitives', icon: 'Triangle', mass: 1, friction: 0.5, restitution: 0.1 },

  { id: 'slope', name: 'Slope', category: 'Terrain', icon: 'ArrowFatLinesUp', mass: 0, friction: 0.8, restitution: 0.1 },
  { id: 'step', name: 'Step', category: 'Terrain', icon: 'Steps', mass: 0, friction: 0.8, restitution: 0.1 },
  { id: 'ramp', name: 'Ramp', category: 'Terrain', icon: 'TrendUp', mass: 0, friction: 0.8, restitution: 0.1 },

  { id: 'piano', name: 'Piano', category: 'Interactive', icon: 'MusicNotes', mass: 50, friction: 0.5, restitution: 0.1 },
  { id: 'ball_pit', name: 'Ball Pit', category: 'Interactive', icon: 'DotsNine', mass: 10, friction: 0.4, restitution: 0.5 },
  { id: 'swing', name: 'Swing', category: 'Interactive', icon: 'ArrowsClockwise', mass: 5, friction: 0.2, restitution: 0.1 },
];
