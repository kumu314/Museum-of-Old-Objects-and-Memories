export type Vec3 = readonly [number, number, number];

export function fitModelBounds(
  bounds: { min: Vec3; max: Vec3 },
  cellSize: Vec3,
  widthOccupancy = 0.9,
  maximumScale?: number,
): { scale: number; offset: Vec3 } {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const modelSize: Vec3 = [maxX - minX, maxY - minY, maxZ - minZ];

  if (
    !bounds.min.every(Number.isFinite) ||
    !bounds.max.every(Number.isFinite) ||
    !modelSize.every((size) => Number.isFinite(size) && size > 0) ||
    !cellSize.every((size) => Number.isFinite(size) && size > 0)
  ) {
    throw new RangeError("模型包围盒和柜格必须具有有限且大于零的尺寸");
  }

  if (!Number.isFinite(widthOccupancy) || widthOccupancy <= 0 || widthOccupancy > 0.9) {
    throw new RangeError("陈列宽度占比必须有限、大于零且不超过 0.9");
  }

  if (maximumScale !== undefined && (!Number.isFinite(maximumScale) || maximumScale <= 0)) {
    throw new RangeError("模型统一展示比例必须有限且大于零");
  }

  const scale = Math.min(
    maximumScale ?? Infinity,
    widthOccupancy * (cellSize[0] / modelSize[0]),
    0.9 * (cellSize[1] / modelSize[1]),
    0.9 * (cellSize[2] / modelSize[2]),
  );

  return {
    scale,
    offset: [
      (-(minX + maxX) * scale) / 2,
      -minY * scale,
      (-(minZ + maxZ) * scale) / 2,
    ],
  };
}
