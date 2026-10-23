import { DataTexture, LinearFilter, RedFormat, RepeatWrapping } from "three";

function heightTexture(name: string, data: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RedFormat);
  texture.name = name;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** 程序化微小高度变化，仅影响受光，不从照片亮度推断法线。 */
export function createPlasticScratchBump(): DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const noise = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      data[y * size + x] = 126 + (noise % 5);
    }
  }
  for (let scratch = 0; scratch < 22; scratch += 1) {
    const startX = (scratch * 67 + 31) % size;
    const startY = (scratch * 43 + 17) % size;
    const length = 25 + (scratch * 13) % 70;
    for (let step = 0; step < length; step += 1) {
      const x = (startX + step) % size;
      const y = (startY + Math.floor(step * 0.07)) % size;
      data[y * size + x] = 143;
    }
  }
  return heightTexture("reference-plastic-micro-scratches", data, size);
}

export function createPaperFiberBump(): DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const noise = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const fibers = Math.sin(x * 0.42 + y * 0.13) * 4 + Math.sin(y * 1.7 + x * 0.12) * 3;
      data[y * size + x] = Math.round(128 + (noise % 13) - 6 + fibers);
    }
  }
  return heightTexture("reference-paper-fibers", data, size);
}
