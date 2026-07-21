export interface JointLimit {
  dof: number;
  x: [number, number];
  y: [number, number];
  z: [number, number];
  allowance?: {
    locomotionCap?: number;
    requiresCervicalCoupling?: boolean;
    scapulohumeralRatio?: number;
    tendonSynergyLink?: boolean;
    dartThrowingOblique?: boolean;
  };
}

export interface ActionFrame {
  timeOffsetMs: number;
  overrides: Record<string, number | [number, number, number]>;
}

export type TimelineSequence = ActionFrame[];

export interface ValidateResult {
  appliedTimeline: TimelineSequence;
  rejections: string[];
  clampingNotes: string[];
  injections: string[];
}

export function clampAngle(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function isScalarPayload(payload: any): payload is number {
  return typeof payload === 'number' || (Array.isArray(payload) && payload.length === 1);
}

export function normalizeBoneKey(key: string): string {
  return key.toLowerCase().replace(/[:\s]/g, '');
}
