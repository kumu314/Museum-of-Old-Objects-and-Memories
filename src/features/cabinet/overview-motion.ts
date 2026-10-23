import type { InspectionState } from '../viewer/inspection-controller.ts';

export function overviewOffset(x: number, y: number, phase: InspectionState['phase'], reducedMotion: boolean): readonly [number, number] {
  if (phase !== 'overview' || reducedMotion) return [0, 0];
  return [Math.max(-1, Math.min(1, x)) * 0.03, Math.max(-1, Math.min(1, y)) * 0.03];
}
