export const CABINET_WIDTH = 11.0;

// Internal usable dimensions; the frame and its moulding sit outside this volume.
export const CELL_SIZE: readonly [number, number, number] = [3.35, 2.4, 1.4];

// All trusted GLBs are metre-based. One shared scale preserves their real relative size.
// Keeps the existing camera size while respecting the cell's 10% depth clearance.
export const MODEL_UNITS_PER_METRE = 14.18;

export function slotRestPosition(slot: number): readonly [number, number, number] {
  if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
    throw new RangeError('柜格必须为 0 至 5');
  }
  return [((slot % 3) - 1) * 3.6, slot < 3 ? 0.23 : -2.65, 0.03];
}

// A shallow rear rise exposes the upper shelf at the near-level overview camera.
export function slotFloorSlope(slot: number): number { return slot < 3 ? 0.18 : 0; }
export function slotFloorHeight(slot: number, z: number): number {
  const [, y, restZ] = slotRestPosition(slot);
  return y - (z - restZ) * slotFloorSlope(slot);
}
