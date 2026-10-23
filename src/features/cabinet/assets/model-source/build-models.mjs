// Offline asset authoring. node build-models.mjs /path/to/node_modules/three /path/to/textures
// Geometry is authored in millimetres, then exported in metres with a bottom-centre origin.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const threePath = resolve(process.argv[2]);
const texturePath = resolve(process.argv[3]);
const T = await import(pathToFileURL(resolve(threePath, 'build/three.module.js')));
const { GLTFExporter } = await import(pathToFileURL(resolve(threePath, 'examples/jsm/exporters/GLTFExporter.js')));
const { mergeGeometries, mergeVertices } = await import(pathToFileURL(resolve(threePath, 'examples/jsm/utils/BufferGeometryUtils.js')));
const output = fileURLToPath(new URL('../', import.meta.url));

// GLTFExporter only needs FileReader for geometry buffers here. Source textures are embedded below.
globalThis.FileReader = class {
  async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
  async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onloadend?.(); }
};

function material(name, color, roughness, metalness = 0) {
  const value = new T.MeshStandardMaterial({ color, roughness, metalness });
  value.name = name;
  return value;
}
function mesh(parent, name, geometry, mat, x = 0, y = 0, z = 0) {
  const node = new T.Mesh(geometry, mat);
  node.name = name; node.position.set(x, y, z); parent.add(node);
  return node;
}
function roundedPath(x, y, w, h, r, Path = T.Shape) {
  const p = new Path();
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); p.closePath();
  return p;
}
function circleHole(shape, x, y, radius) {
  const hole = new T.Path(); hole.absarc(x, y, radius, 0, Math.PI * 2, true); shape.holes.push(hole);
}
function extrusion(shape, depth, bevel = .22) {
  return new T.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: bevel > 0,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
}
function ring(outer, inner, depth) {
  const shape = new T.Shape(); shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  circleHole(shape, 0, 0, inner); return extrusion(shape, depth, .08);
}
function box(parent, name, size, mat, position) {
  return mesh(parent, name, new T.BoxGeometry(...size), mat, ...position);
}
function uvInBounds(geometry, x, y, w, h, reverse = false) {
  const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, reverse ? 1 - (p.getX(i) - x) / w : (p.getX(i) - x) / w, (p.getY(i) - y) / h);
}

function cassette() {
  const root = new T.Group(); root.name = 'cassette-complete-demo';
  const shell = new T.MeshPhysicalMaterial({ color: '#544d40', roughness: .27, metalness: .06, clearcoat: .8, clearcoatRoughness: .18 });
  shell.name = 'smoked-brown-polycarbonate';
  const edge = material('polished-shell-edges', '#736859', .28, .25);
  const seam = material('case-join-and-recesses', '#151410', .52);
  const hub = material('ivory-reel-hubs', '#c7bca1', .36, .03);
  const tape = material('wound-magnetic-tape', '#35241c', .42, .12);
  const windingEdge = material('tape-winding-edges', '#594132', .49, .05);
  const screw = material('aged-steel-screws', '#ac9e85', .29, .83);
  const pad = material('felt-pressure-pad', '#80725d', .95);
  const labelA = material('cassette-label-a', '#ffffff', .87);
  const labelB = material('cassette-label-b', '#ffffff', .87);
  for (const m of [labelA, labelB]) { m.emissive.set('#ffffff'); m.emissiveIntensity = .12; }

  // Separate front/rear shells with a real opening to the reels and a visible central seam.
  for (const side of [1, -1]) {
    const face = roundedPath(-50, -32, 100, 64, 3);
    face.holes.push(roundedPath(-33, -8.5, 66, 22, 3, T.Path));
    for (const x of [-18, 18]) circleHole(face, x, -26, 2.8);
    for (const x of [-10, 10]) circleHole(face, x, -26, 1.65);
    mesh(root, `case-${side === 1 ? 'front' : 'back'}`, extrusion(face, 1.25), shell, 0, 0, side === 1 ? 5.65 : -6.9);
    const outline = roundedPath(-49.3, -31.3, 98.6, 62.6, 2.8);
    outline.holes.push(roundedPath(-48.6, -30.6, 97.2, 61.2, 2.3, T.Path));
    mesh(root, `rim-${side}`, extrusion(outline, .25, .08), edge, 0, 0, side * 7.04 - (side < 0 ? .25 : 0));
    const label = roundedPath(-44, -16, 88, 42, 1.5);
    label.holes.push(roundedPath(-34.3, -9.6, 68.6, 24.2, 3.5, T.Path));
    const labelGeometry = new T.ShapeGeometry(label, 16);
    uvInBounds(labelGeometry, -44, -16, 88, 42, side === -1);
    if (side === -1) {
      const indices = labelGeometry.index;
      for (let i = 0; i < indices.count; i += 3) { const a = indices.getX(i); indices.setX(i, indices.getX(i + 2)); indices.setX(i + 2, a); }
      labelGeometry.computeVertexNormals();
    }
    mesh(root, `paper-label-${side === 1 ? 'A' : 'B'}`, labelGeometry, side === 1 ? labelA : labelB, 0, 0, side * 7.2);
    const rim = roundedPath(-34, -9.5, 68, 24, 3.5);
    rim.holes.push(roundedPath(-33, -8.5, 66, 22, 3, T.Path));
    mesh(root, `moulded-window-lip-${side}`, extrusion(rim, .32, .12), edge, 0, 0, side * 6.9 - (side < 0 ? .32 : 0));
    for (const x of [-46, 46]) for (const y of [-27.5, 27.5]) {
      mesh(root, `screw-recess-${side}-${x}-${y}`, ring(2.6, 1.75, .35), seam, x, y, side * 6.9 - (side < 0 ? .35 : 0));
      const head = mesh(root, `steel-screw-${side}-${x}-${y}`, new T.CylinderGeometry(1.65, 1.65, .65, 24), screw, x, y, side * 7.28);
      head.rotation.x = Math.PI / 2;
      const slot = box(root, 'screwdriver-slot', [2.1, .28, .08], seam, [x, y, side * 7.65]); slot.rotation.z = .45;
    }
    // Lower moulded trapezoid, through-holes and reinforcing ribs visible from both sides.
    const lower = new T.Shape();
    lower.moveTo(-38, -31); lower.lineTo(38, -31); lower.lineTo(34.5, -18); lower.lineTo(-34.5, -18); lower.closePath();
    for (const x of [-18, 18]) circleHole(lower, x, -26, 2.8);
    for (const x of [-10, 10]) circleHole(lower, x, -26, 1.65);
    mesh(root, `reinforced-tape-edge-${side}`, extrusion(lower, .6, .12), shell, 0, 0, side * 7.0 - (side < 0 ? .6 : 0));
    for (let x = -31; x <= 31; x += 2) box(root, 'lower-case-grip', [.36, 6.5, .2], edge, [x, -22.2, side * 7.67]);
  }
  // Side walls are distinct solids; the bottom leaves an actual tape-head opening.
  box(root, 'left-wall', [1.8, 56, 12.1], shell, [-49, 0, 0]);
  box(root, 'right-wall', [1.8, 56, 12.1], shell, [49, 0, 0]);
  box(root, 'top-wall', [93, 1.7, 12.1], shell, [0, 31, 0]);
  for (const x of [-42, 42]) box(root, 'bottom-corner', [14, 1.8, 12], shell, [x, -31, 0]);
  for (const x of [-49.96, 49.96]) box(root, 'side-case-seam', [.14, 55, .35], seam, [x, 0, 0]);
  box(root, 'top-case-seam', [91, .14, .35], seam, [0, 31.96, 0]);
  for (const x of [-40, 40]) box(root, 'record-protect-recess', [7, .2, 7], seam, [x, 31.98, 0]);
  for (const x of [-49.95, 49.95]) for (let y = -12; y < 14; y += 2) box(root, 'side-grip-ridge', [.2, .45, 9], edge, [x, y, 0]);
  for (const [x, radius] of [[-20, 19], [20, 15.5]]) {
    mesh(root, 'tape-pack', ring(radius, 9.7, 7), tape, x, 2.5, -3.5);
    for (let r = 10.4; r < radius; r += 1.1) {
      const winding = new T.TorusGeometry(r, .04, 3, 48);
      for (const z of [-3.6, 3.6]) mesh(root, 'individual-tape-winding', winding, windingEdge, x, 2.5, z);
    }
    for (const side of [1, -1]) {
      const reel = new T.Shape(); reel.absarc(0, 0, 9.35, 0, Math.PI * 2, false);
      const hole = new T.Path();
      for (let i = 0; i <= 72; i++) {
        const angle = -i / 72 * Math.PI * 2;
        const radius = i % 12 >= 3 && i % 12 <= 6 ? 3.9 : 5.2;
        const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius;
        if (i === 0) hole.moveTo(px, py); else hole.lineTo(px, py);
      }
      hole.closePath(); reel.holes.push(hole);
      mesh(root, `toothed-reel-${side}-${x}`, extrusion(reel, 1.6, .12), hub, x, 2.5, side === 1 ? 3.7 : -5.3);
      mesh(root, 'metal-hub-lip', new T.TorusGeometry(9.3, .28, 8, 64), screw, x, 2.5, side * 5.4);
      for (let j = 0; j < 6; j++) {
        const a = j * Math.PI / 3;
        mesh(root, 'reel-inset', new T.CircleGeometry(.63, 12), seam, x + Math.cos(a) * 7.3, 2.5 + Math.sin(a) * 7.3, side * 5.55).rotation.y = side === 1 ? 0 : Math.PI;
      }
    }
  }
  // Exposed magnetic ribbon, guide rollers and felt/metal pressure pad at the bottom edge.
  box(root, 'exposed-magnetic-ribbon', [72, .18, 3.8], tape, [0, -29.2, 0]);
  for (const x of [-36, 36]) mesh(root, 'tape-guide-roller', new T.CylinderGeometry(2.4, 2.4, 6, 24), hub, x, -26.6, 0).rotation.x = Math.PI / 2;
  box(root, 'pressure-pad-spring', [12, .5, 4], screw, [0, -27.7, 0]);
  box(root, 'felt-contact', [7, .7, 4], pad, [0, -28.35, 0]);
  // Thin clear window with real spindle openings; no opaque/rough fog layer over the label.
  const glazing = new T.MeshPhysicalMaterial({ color: '#b8a587', roughness: .08, metalness: 0, transparent: true, opacity: .075, clearcoat: 1 });
  glazing.name = 'clear-reel-window'; glazing.depthWrite = false;
  for (const side of [1, -1]) {
    const window = roundedPath(-33, -8.5, 66, 22, 3);
    for (const x of [-20, 20]) circleHole(window, x, 2.5, 9.6);
    const panel = mesh(root, 'clear-window-with-spindle-apertures', new T.ShapeGeometry(window), glazing, 0, 0, side * 5.75);
    if (side === -1) panel.rotation.y = Math.PI;
  }
  // Nominal compact-cassette dimensions include the moulded lip and screw heads.
  root.scale.set(100.4 / 100.44, 63.8 / 64.44, 12 / 15.54);
  return normalize(root, 'Original model based on the supplied cassette demo; reverse/inner mechanics are illustrative.');
}

function ticket() {
  const root = new T.Group(); root.name = 'ticket-curved-paper-demo';
  const front = material('ticket-front', '#ffffff', .92);
  const back = material('ticket-back', '#ffffff', .96);
  for (const m of [front, back]) { m.emissive.set('#ffffff'); m.emissiveIntensity = .12; }
  const edge = material('paper-cut-fibre-edge', '#b89a68', .99);
  // 90×60 mm soft paper ticket as a period-appropriate proxy; this is not a measured artefact.
  const columns = 64, rows = 36, width = 90, height = 60, thickness = .24;
  const positions = [], uvs = [], indices = [];
  function point(u, v) {
    const edgeWeightX = Math.abs(u * 2 - 1) ** 14;
    const edgeWeightY = Math.abs(v * 2 - 1) ** 14;
    const nickX = (Math.sin(v * 117) * .18 + Math.sin(v * 269) * .07) * edgeWeightX;
    const nickY = (Math.sin(u * 151) * .16 + Math.sin(u * 327) * .06) * edgeWeightY;
    const x = (u - .5) * width + nickX, y = (v - .5) * height + nickY;
    const fold = Math.exp(-(((u - .48 - v * .018) / .026) ** 2)) * .55;
    const curl = 2.8 * Math.exp(-((u - .02) ** 2 + (v - .98) ** 2) / .018)
      - 2 * Math.exp(-((u - .98) ** 2 + (v - .98) ** 2) / .028)
      + 1.6 * Math.exp(-((u - .98) ** 2 + (v - .02) ** 2) / .019);
    return [x, y, Math.sin(u * Math.PI) * .9 + fold + curl];
  }
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const u = col / columns, v = row / rows;
    positions.push(...point(u, v)); uvs.push(u, v);
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * (columns + 1) + col, b = a + 1, c = a + columns + 1, d = c + 1;
    indices.push(a, b, d, a, d, c);
  }
  const surface = new T.BufferGeometry();
  surface.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  surface.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  surface.setIndex(indices); surface.computeVertexNormals();
  mesh(root, 'paper-front-with-fold-and-curled-corners', surface, front);
  const reverse = surface.clone(), reversePositions = reverse.getAttribute('position'), reverseUv = reverse.getAttribute('uv');
  for (let i = 0; i < reversePositions.count; i++) {
    reversePositions.setZ(i, reversePositions.getZ(i) - thickness); reverseUv.setX(i, 1 - reverseUv.getX(i));
  }
  const reverseIndices = [...indices];
  for (let i = 0; i < reverseIndices.length; i += 3) [reverseIndices[i], reverseIndices[i + 2]] = [reverseIndices[i + 2], reverseIndices[i]];
  reverse.setIndex(reverseIndices); reverse.computeVertexNormals();
  mesh(root, 'paper-unprinted-demo-reverse', reverse, back);
  const rim = [];
  const perimeter = [];
  for (let col = 0; col <= columns; col++) perimeter.push(col);
  for (let row = 1; row <= rows; row++) perimeter.push(row * (columns + 1) + columns);
  for (let col = columns - 1; col >= 0; col--) perimeter.push(rows * (columns + 1) + col);
  for (let row = rows - 1; row > 0; row--) perimeter.push(row * (columns + 1));
  for (let i = 0; i < perimeter.length; i++) {
    const a = positions.slice(perimeter[i] * 3, perimeter[i] * 3 + 3);
    const b = positions.slice(perimeter[(i + 1) % perimeter.length] * 3, perimeter[(i + 1) % perimeter.length] * 3 + 3);
    const ab = [a[0], a[1], a[2] - thickness], bb = [b[0], b[1], b[2] - thickness];
    rim.push(...a, ...ab, ...bb, ...a, ...bb, ...b);
  }
  const rimGeometry = new T.BufferGeometry();
  rimGeometry.setAttribute('position', new T.Float32BufferAttribute(rim, 3)); rimGeometry.computeVertexNormals();
  mesh(root, 'continuous-paper-thickness', rimGeometry, edge);
  root.rotation.set(-8 * Math.PI / 180, 0, 3 * Math.PI / 180);
  return normalize(root, 'Original paper model and redrawn demo artwork; unprovided reverse is unprinted and illustrative.');
}

function normalize(model, note) {
  // Bake authored transforms and combine only meshes sharing a material to keep draw calls bounded.
  model.updateMatrixWorld(true);
  const buckets = new Map();
  model.traverse(node => {
    if (!node.isMesh) return;
    let geo = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    geo.applyMatrix4(node.matrixWorld); geo.scale(.001, .001, .001);
    // Flat colour edge meshes also need UVs so each material bucket has compatible attributes.
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    const bucket = buckets.get(node.material) ?? { geometries: [], parts: [] };
    bucket.geometries.push(geo); bucket.parts.push(node.name); buckets.set(node.material, bucket);
  });
  const baked = new T.Group(); baked.name = model.name;
  for (const [mat, bucket] of buckets) {
    const merged = mergeGeometries(bucket.geometries, false);
    if (merged === null) throw new Error(`Unable to merge ${mat.name}`);
    if (mat.name === 'smoked-brown-polycarbonate') {
      const positions = merged.getAttribute('position'), normals = merged.getAttribute('normal'), uv = merged.getAttribute('uv');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        if (Math.abs(normals.getZ(i)) > .6) uv.setXY(i, x / .101 + .5, y / .065 + .5);
        else if (Math.abs(normals.getX(i)) > .6) uv.setXY(i, z / .016 + .5, y / .065 + .5);
        else uv.setXY(i, x / .101 + .5, z / .016 + .5);
      }
    }
    const node = mesh(baked, mat.name, mergeVertices(merged, 1e-7), mat); node.userData.parts = bucket.parts;
  }
  baked.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(baked, true);
  const center = bounds.getCenter(new T.Vector3());
  for (const node of baked.children) node.geometry.translate(-center.x, -bounds.min.y, -center.z);
  baked.userData = { approximation: note, units: 'metres', front: '+Z', up: '+Y', origin: 'bottom centre' };
  return baked;
}

async function exportModel(model, filename, maps) {
  const json = await new GLTFExporter().parseAsync(model, { binary: false });
  const chunks = [Buffer.from(json.buffers[0].uri.split(',')[1], 'base64')];
  let size = chunks[0].length;
  json.images = []; json.textures = []; json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
  const textureIndices = new Map();
  async function addTexture(name) {
    if (textureIndices.has(name)) return textureIndices.get(name);
    const isNormal = name.endsWith('normal');
    const data = await readFile(resolve(texturePath, `${name}.${isNormal ? 'png' : 'jpg'}`));
    const pad = (4 - size % 4) % 4; chunks.push(Buffer.alloc(pad)); size += pad;
    const view = json.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: data.length }) - 1;
    chunks.push(data); size += data.length;
    const image = json.images.push({ name, bufferView: view, mimeType: isNormal ? 'image/png' : 'image/jpeg' }) - 1;
    const index = json.textures.push({ name, sampler: 0, source: image }) - 1; textureIndices.set(name, index);
    return index;
  }
  for (const mat of json.materials) {
    if (mat.name === 'smoked-brown-polycarbonate') mat.normalTexture = { index: await addTexture('plastic-normal'), scale: .26 };
    const mapName = maps[mat.name];
    if (mapName === undefined) continue;
    const index = await addTexture(mapName);
    mat.pbrMetallicRoughness.baseColorTexture = { index };
    mat.emissiveTexture = { index };
    if (mat.name.startsWith('ticket-')) mat.normalTexture = { index: await addTexture('paper-normal'), scale: .35 };
  }
  // Three geometry UV origin is bottom-left; glTF images have a top-left origin.
  for (const accessor of json.accessors) {
    if (!json.meshes.some(m => m.primitives.some(p => p.attributes.TEXCOORD_0 === json.accessors.indexOf(accessor)))) continue;
    const view = json.bufferViews[accessor.bufferView];
    const data = chunks[0]; const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    for (let i = 0; i < accessor.count; i++) { const v = offset + i * 8 + 4; data.writeFloatLE(1 - data.readFloatLE(v), v); }
    const min = accessor.min[1]; accessor.min[1] = 1 - accessor.max[1]; accessor.max[1] = 1 - min;
  }
  const binPad = (4 - size % 4) % 4; chunks.push(Buffer.alloc(binPad)); size += binPad;
  json.buffers = [{ byteLength: size }];
  const raw = Buffer.from(JSON.stringify(json)); const padded = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + size, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(size, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, padded, binHeader, ...chunks]);
  await writeFile(resolve(output, filename), glb);
  const bounds = new T.Box3().setFromObject(model, true);
  const triangles = model.children.reduce((total, node) => total + (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3, 0);
  return { file: filename, bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex'), meshes: model.children.length, triangles,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, dimensions: bounds.getSize(new T.Vector3()).toArray(), textures: [...textureIndices.keys()] };
}
const report = [];
report.push(await exportModel(cassette(), 'cassette.glb', { 'cassette-label-a': 'cassette-label-a', 'cassette-label-b': 'cassette-label-b' }));
report.push(await exportModel(ticket(), 'ticket.glb', { 'ticket-front': 'ticket-front', 'ticket-back': 'ticket-back' }));
await writeFile(resolve(output, 'model-source/build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
