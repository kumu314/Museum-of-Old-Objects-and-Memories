import assert from "node:assert/strict";
import test from "node:test";
import { fitModelBounds, type Vec3 } from "./model-fit.ts";
import { CELL_SIZE, MODEL_UNITS_PER_METRE } from "./cabinet-layout.ts";

test("三件米制模型使用同一比例，保留实物相对尺寸与底部落点", () => {
  const sizes: Vec3[] = [[0.14734, 0.077568, 0.088838], [0.1004, 0.0638, 0.012], [0.094, 0.065, 0.012]];
  for (const [x, y, z] of sizes) {
    const result = fitModelBounds({ min: [-x / 2, 0, -z / 2], max: [x / 2, y, z / 2] }, CELL_SIZE, 0.9, MODEL_UNITS_PER_METRE);
    assert.equal(result.scale, MODEL_UNITS_PER_METRE);
    assert.ok(result.offset.every(value => value === 0));
    [x, y, z].forEach((size, axis) => { const limit = CELL_SIZE[axis]; assert.ok(limit !== undefined && size * result.scale <= limit * .9); });
  }
});

test("统一展示比例不能使大模型越过格位上限", () => {
  assert.equal(fitModelBounds({ min: [0, 0, 0], max: [1, 1, 1] }, [2, 2, 2], .9, 14.18).scale, 1.8);
  for (const invalid of [0, -1, Infinity, NaN]) assert.throws(() => fitModelBounds({ min: [0, 0, 0], max: [1, 1, 1] }, [2, 2, 2], .9, invalid), RangeError);
});

test("按宽、高、深中最受限的轴等比缩放", () => {
  const cases: { max: Vec3; scale: number }[] = [
    { max: [4, 1, 1], scale: 0.45 },
    { max: [1, 4, 1], scale: 0.45 },
    { max: [1, 1, 4], scale: 0.45 },
  ];

  for (const { max, scale } of cases) {
    assert.equal(fitModelBounds({ min: [0, 0, 0], max }, [2, 2, 2]).scale, scale);
  }
});

test("不同柜格三轴尺寸分别约束模型", () => {
  const bounds = { min: [0, 0, 0], max: [2, 4, 8] } satisfies {
    min: Vec3;
    max: Vec3;
  };

  assert.equal(fitModelBounds(bounds, [1, 8, 16]).scale, 0.45);
  assert.equal(fitModelBounds(bounds, [4, 2, 16]).scale, 0.45);
  assert.equal(fitModelBounds(bounds, [4, 8, 4]).scale, 0.45);
});

test("缩放后把偏移包围盒的底部中心移到原点", () => {
  const bounds = { min: [2, -3, -6], max: [6, 5, -2] } satisfies {
    min: Vec3;
    max: Vec3;
  };
  const { scale, offset } = fitModelBounds(bounds, [8, 8, 8]);

  assert.equal(scale, 0.9);
  assert.deepEqual(offset, [-3.6, 2.7, 3.6]);
  assert.equal(((bounds.min[0] + bounds.max[0]) * scale) / 2 + offset[0], 0);
  assert.equal(bounds.min[1] * scale + offset[1], 0);
  assert.equal(((bounds.min[2] + bounds.max[2]) * scale) / 2 + offset[2], 0);
});

test("模型三轴占用均不超过柜格的 90%", () => {
  const { scale } = fitModelBounds({ min: [-1, -2, -3], max: [1, 2, 3] }, [4, 5, 6]);

  assert.equal(6 * scale, 6 * 0.9);
  assert.ok(2 * scale <= 4 * 0.9);
  assert.ok(4 * scale <= 5 * 0.9);
});

test("可按陈列宽度占比缩小，仍保持底部中心归零", () => {
  for (const widthOccupancy of [0.53, 0.6]) {
    const { scale, offset } = fitModelBounds(
      { min: [2, -1, -4], max: [4, 1, -2] },
      [10, 10, 10],
      widthOccupancy,
    );

    assert.equal(2 * scale, 10 * widthOccupancy);
    assert.equal(3 * scale + offset[0], 0);
    assert.equal(-scale + offset[1], 0);
    assert.equal(-3 * scale + offset[2], 0);
    assert.ok(2 * scale <= 10 * 0.9);
  }
});

test("指定陈列宽度后，高度和深度仍分别限制到柜格的 90%", () => {
  const cases: { modelSize: Vec3; cellSize: Vec3 }[] = [
    { modelSize: [2, 8, 1], cellSize: [5, 4, 5] },
    { modelSize: [2, 1, 8], cellSize: [5, 5, 4] },
  ];

  for (const { modelSize, cellSize } of cases) {
    const { scale } = fitModelBounds({ min: [0, 0, 0], max: modelSize }, cellSize, 0.6);

    assert.equal(scale, 0.45);
    assert.ok(modelSize[0] * scale <= cellSize[0] * 0.6);
    assert.ok(modelSize[1] * scale <= cellSize[1] * 0.9);
    assert.ok(modelSize[2] * scale <= cellSize[2] * 0.9);
  }
});

test("拒绝非有限、非正数或超过 90% 的陈列宽度占比", () => {
  for (const widthOccupancy of [0, -0.1, 0.900001, 1, NaN, Infinity, -Infinity]) {
    assert.throws(
      () => fitModelBounds({ min: [0, 0, 0], max: [1, 1, 1] }, [1, 1, 1], widthOccupancy),
      RangeError,
    );
  }
});

test("拒绝每个轴的退化或反向包围盒", () => {
  const invalidBounds: { min: Vec3; max: Vec3 }[] = [
    { min: [0, 0, 0], max: [0, 1, 1] },
    { min: [0, 0, 0], max: [1, 0, 1] },
    { min: [0, 0, 0], max: [1, 1, 0] },
    { min: [0, 0, 0], max: [-1, 1, 1] },
    { min: [0, 0, 0], max: [1, -1, 1] },
    { min: [0, 0, 0], max: [1, 1, -1] },
  ];

  for (const bounds of invalidBounds) {
    assert.throws(() => fitModelBounds(bounds, [1, 1, 1]), RangeError);
  }
});

test("拒绝非有限包围盒坐标和溢出的模型尺寸", () => {
  const invalidBounds: { min: Vec3; max: Vec3 }[] = [
    { min: [NaN, 0, 0], max: [1, 1, 1] },
    { min: [0, -Infinity, 0], max: [1, 1, 1] },
    { min: [0, 0, 0], max: [1, 1, Infinity] },
    { min: [-Number.MAX_VALUE, 0, 0], max: [Number.MAX_VALUE, 1, 1] },
  ];

  for (const bounds of invalidBounds) {
    assert.throws(() => fitModelBounds(bounds, [1, 1, 1]), RangeError);
  }
});

test("拒绝每个轴的零、负数及非有限柜格尺寸", () => {
  for (const invalidSize of [0, -1, NaN, Infinity, -Infinity]) {
    const cellSizes: Vec3[] = [
      [invalidSize, 1, 1],
      [1, invalidSize, 1],
      [1, 1, invalidSize],
    ];

    for (const cellSize of cellSizes) {
      assert.throws(
        () => fitModelBounds({ min: [0, 0, 0], max: [1, 1, 1] }, cellSize),
        RangeError,
      );
    }
  }
});
