import {
  BackSide,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  type Material,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector2,
} from "three";
import { createPaperFiberBump } from "./reference-surface.ts";

const referenceCrops = {
  cassette: { x: 718, y: 269, width: 240, height: 146 },
  ticket: { x: 701, y: 579, width: 272, height: 146 },
} as const;

/** 正面使用用户参考图，侧面、背面与展托仅为示意，不代表精确复原。 */
export async function createReferenceModel(
  key: "cassette" | "ticket",
  signal: AbortSignal,
  anisotropy: number,
): Promise<Group> {
  const crop = referenceCrops[key];
  let bitmap: ImageBitmap | undefined;
  const textures = new Set<Texture>();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  function mesh(geometry: BufferGeometry, material: Material | Material[], parent: Group): Mesh {
    geometries.push(geometry);
    const value = new Mesh(geometry, material);
    parent.add(value);
    return value;
  }

  try {
    signal.throwIfAborted();
    const response = await fetch(new URL("./assets/reference-overview.png", import.meta.url), { signal });
    if (!response.ok) {
      throw new Error(`参考图读取失败：HTTP ${response.status}`);
    }
    const blob = await response.blob();
    signal.throwIfAborted();
    bitmap = await createImageBitmap(blob, crop.x, crop.y, crop.width, crop.height, {
      imageOrientation: "none",
    });
    signal.throwIfAborted();

    // A 2048px working surface preserves smooth sampling; it does not invent source detail.
    const faceCanvas = document.createElement('canvas');
    faceCanvas.width = 2048; faceCanvas.height = Math.round(2048 * crop.height / crop.width);
    const face = faceCanvas.getContext('2d');
    if (face === null) throw new Error('无法创建展品正面贴图');
    face.imageSmoothingEnabled = true; face.imageSmoothingQuality = 'high';
    face.filter = 'contrast(1.16) saturate(1.04)';
    face.drawImage(bitmap, 0, 0, faceCanvas.width, faceCanvas.height);
    bitmap.close(); bitmap = undefined;
    const texture = new CanvasTexture(faceCanvas);
    texture.name = `${key}-reference-front`;
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = anisotropy;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    textures.add(texture);
    const bump = key === "ticket" ? createPaperFiberBump() : undefined;
    if (bump !== undefined) textures.add(bump);

    // The reference already contains illumination. Re-lighting its lettering washes out ink.
    const front = new MeshBasicMaterial({ map: texture, toneMapped: false });
    front.onBeforeCompile = (shader) => {
      shader.uniforms.referenceTexel = { value: new Vector2(1 / crop.width, 1 / crop.height) };
      shader.fragmentShader = 'uniform vec2 referenceTexel;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        #ifdef USE_MAP
          vec3 nearbyInk = (
            texture2D(map, vMapUv + vec2(referenceTexel.x, 0.0)).rgb +
            texture2D(map, vMapUv - vec2(referenceTexel.x, 0.0)).rgb +
            texture2D(map, vMapUv + vec2(0.0, referenceTexel.y)).rgb +
            texture2D(map, vMapUv - vec2(0.0, referenceTexel.y)).rgb
          ) * 0.25;
          vec3 sharpInk = clamp(sampledDiffuseColor.rgb + 0.55 * (sampledDiffuseColor.rgb - nearbyInk), 0.0, 1.0);
          diffuseColor.rgb *= sharpInk / max(sampledDiffuseColor.rgb, vec3(0.0001));
        #endif
      `);
    };
    const side = key === "cassette"
      ? new MeshPhysicalMaterial({ color: 0x514b43, transparent: true, opacity: 0.72, roughness: 0.3, clearcoat: 0.4 })
      : new MeshStandardMaterial({ color: 0xbda77d, roughness: 0.94, side: DoubleSide });
    const back = new MeshStandardMaterial({
      color: key === "cassette" ? 0x4a3629 : 0xd5c09a,
      roughness: 0.95,
      ...(bump !== undefined ? { side: BackSide, bumpMap: bump, bumpScale: 0.00035 } : {}),
    });
    const standMaterial = new MeshStandardMaterial({ color: 0x211d19, roughness: 0.8, metalness: 0.06 });
    materials.push(front, side, back, standMaterial);

    const width = key === "cassette" ? 1.68 : 1.8;
    const height = (width * crop.height) / crop.width;
    const thickness = key === "cassette" ? 0.12 : 0.002;
    const leaning = new Group();
    leaning.rotation.x = -8 * Math.PI / 180;
    leaning.name = `${key}-leaning-eight-degrees`;
    const content = new Group();
    content.add(leaning);

    // 浅浮层沿用主正面的连续 UV，照片文字和卷轴图案不会被新色块替换。
    function referenceUv(geometry: BufferGeometry, centerX: number, centerY: number): void {
      const positions = geometry.getAttribute("position");
      const uv = geometry.getAttribute("uv");
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        uv.setXY(vertex, (positions.getX(vertex) + centerX) / width + 0.5, (positions.getY(vertex) + centerY) / height);
      }
    }

    if (key === "cassette") {
      const body = mesh(new BoxGeometry(width, height, thickness), [side, side, side, side, front, back], leaning);
      body.position.y = height / 2;
      for (const pixelX of [69, 169]) {
        const centerX = (pixelX / crop.width - 0.5) * width;
        const centerY = (1 - 70 / crop.height) * height;
        const geometry = new CircleGeometry(width * 21 / crop.width, 48);
        referenceUv(geometry, centerX, centerY);
        const reel = mesh(geometry, front, leaning);
        reel.position.set(centerX, centerY, thickness / 2 + 0.0008);
        reel.name = "reference-reel-shallow-relief";
      }
      const labelWidth = width * 204 / crop.width;
      const labelHeight = height * 30 / crop.height;
      const labelY = height * (1 - 32 / crop.height);
      const labelGeometry = new PlaneGeometry(labelWidth, labelHeight);
      referenceUv(labelGeometry, 0, labelY);
      mesh(labelGeometry, front, leaning).position.set(0, labelY, thickness / 2 + 0.0012);
    } else {
      const columns = 24;
      const rows = 16;
      const paper = new PlaneGeometry(width, height, columns, rows);
      const positions = paper.getAttribute("position");
      const uv = paper.getAttribute("uv");
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const u = uv.getX(vertex);
        const v = uv.getY(vertex);
        const topLeft = Math.max(0, 1 - Math.hypot(u, 1 - v) / 0.16);
        const topRight = Math.max(0, 1 - Math.hypot(1 - u, 1 - v) / 0.16);
        const bottomRight = Math.max(0, 1 - Math.hypot(1 - u, v) / 0.16);
        const bottomLeft = Math.max(0, 1 - Math.hypot(u, v) / 0.16);
        const curl = topLeft ** 2 * 0.006 - topRight ** 2 * 0.004 + bottomRight ** 2 * 0.005 - bottomLeft ** 2 * 0.003;
        // Follow the photographed paper silhouette; the crop's rectangular corners contain wood.
        const leftU = 0.055 * (1 - v) + 0.004 * v;
        const rightU = 0.997 * (1 - v) + 0.915 * v;
        const bottomV = 0.003 * (1 - u) + 0.103 * u;
        const topV = 0.918 * (1 - u) + 0.994 * u;
        const sourceU = leftU * (1 - u) + rightU * u;
        const sourceV = bottomV * (1 - v) + topV * v;
        positions.setXYZ(vertex, (sourceU - 0.5) * width, (sourceV - 0.5) * height, thickness / 2 + curl);
        uv.setXY(vertex, sourceU, sourceV);
      }
      paper.computeVertexNormals();
      const paperFront = mesh(paper, front, leaning);
      paperFront.position.y = height / 2;
      paperFront.name = "reference-paper-fiber-front-with-corner-curl";
      const reverse = paper.clone();
      const reversePositions = reverse.getAttribute("position");
      for (let vertex = 0; vertex < reversePositions.count; vertex += 1) reversePositions.setZ(vertex, reversePositions.getZ(vertex) - thickness);
      mesh(reverse, back, leaning).position.y = height / 2;
      const edgePositions: number[] = [];
      function edge(a: number, b: number): void {
        const ax = positions.getX(a), ay = positions.getY(a), az = positions.getZ(a);
        const bx = positions.getX(b), by = positions.getY(b), bz = positions.getZ(b);
        edgePositions.push(ax, ay, az, bx, by, bz, bx, by, bz - thickness, ax, ay, az, bx, by, bz - thickness, ax, ay, az - thickness);
      }
      for (let column = 0; column < columns; column += 1) {
        edge(column, column + 1);
        edge(rows * (columns + 1) + column, rows * (columns + 1) + column + 1);
      }
      for (let row = 0; row < rows; row += 1) {
        edge(row * (columns + 1), (row + 1) * (columns + 1));
        edge(row * (columns + 1) + columns, (row + 1) * (columns + 1) + columns);
      }
      const edgeGeometry = new BufferGeometry();
      edgeGeometry.setAttribute("position", new Float32BufferAttribute(edgePositions, 3));
      edgeGeometry.computeVertexNormals();
      mesh(edgeGeometry, side, leaning).position.y = height / 2;
    }

    // 托底顶面与后倾物体的底部后缘接触；后唇在物体后方，均不增加宽度目标。
    const standHeight = 0.018;
    const contactY = -Math.sin(8 * Math.PI / 180) * thickness / 2;
    const standDepth = key === "cassette" ? 0.16 : 0.035;
    const plinth = mesh(new BoxGeometry(width * (key === "ticket" ? 0.18 : 0.4), standHeight, standDepth), standMaterial, content);
    plinth.position.set(0, key === "ticket" ? 0.025 : contactY - standHeight / 2, key === "ticket" ? -0.035 : -standDepth / 4);
    plinth.name = "dark-micro-plinth-contact-base";
    const rearLip = mesh(new BoxGeometry(width * 0.25, 0.08, 0.018), standMaterial, leaning);
    rearLip.position.set(0, 0.04, -thickness / 2 - 0.009);
    rearLip.name = "dark-micro-plinth-rear-support";

    const bounds = new Box3().setFromObject(content, true);
    content.position.set(
      -(bounds.min.x + bounds.max.x) / 2,
      -bounds.min.y,
      -(bounds.min.z + bounds.max.z) / 2,
    );
    const model = new Group();
    model.name = `${key}-reference-front-slab`;
    model.userData.representation = "参考图正面贴图薄片，侧背面示意";
    model.add(content);
    signal.throwIfAborted();
    return model;
  } catch (error: unknown) {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    bitmap?.close();
    throw error;
  }
}
