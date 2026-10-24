import { Box3, Group, MathUtils, type Object3D } from 'three';
import { z } from 'zod';
import { fitModelBounds, type Vec3 } from './model-fit';

const angle = z.number().finite().min(-180).max(180);
/** Degrees in XYZ order; size is relative to the largest safe cabinet fit. */
export const modelPlacementSchema = z.strictObject({
  rotation: z.tuple([angle, angle, angle]),
  size: z.number().finite().min(0.25).max(1),
});
export type ModelPlacement = z.infer<typeof modelPlacementSchema>;
export function defaultModelPlacement(): ModelPlacement { return { rotation: [0, 0, 0], size: 0.75 }; }

export function createPlacedModel(asset: Object3D, cell: Vec3, initial: ModelPlacement, maximumScale?: number) {
  const object = new Group();
  const orientation = new Group();
  let size: Vec3 = cell;
  orientation.add(asset); object.add(orientation);
  function setPlacement(input: ModelPlacement) {
    const placement = modelPlacementSchema.parse(input);
    const parent = object.parent;
    // Measure in cabinet-local space even while the parent is being inspected or animated.
    parent?.remove(object);
    try {
      object.position.set(0, 0, 0); object.scale.setScalar(1);
      const [x, y, z] = placement.rotation;
      orientation.rotation.set(MathUtils.degToRad(x), MathUtils.degToRad(y), MathUtils.degToRad(z));
      object.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(orientation, true);
      const fit = fitModelBounds({ min: [bounds.min.x, bounds.min.y, bounds.min.z], max: [bounds.max.x, bounds.max.y, bounds.max.z] }, cell, 0.9, maximumScale);
      object.scale.setScalar(fit.scale * placement.size);
      const fittedScale = fit.scale * placement.size;
      size = [(bounds.max.x - bounds.min.x) * fittedScale, (bounds.max.y - bounds.min.y) * fittedScale, (bounds.max.z - bounds.min.z) * fittedScale];
      const [offsetX, offsetY, offsetZ] = fit.offset;
      object.position.set(offsetX * placement.size, offsetY * placement.size, offsetZ * placement.size);
      object.updateMatrixWorld(true);
    } finally { parent?.add(object); }
  }
  setPlacement(initial);
  return { object, setPlacement, getSize: () => size };
}
