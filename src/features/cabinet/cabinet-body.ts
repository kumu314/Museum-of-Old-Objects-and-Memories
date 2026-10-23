import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, ExtrudeGeometry, Shape, DoubleSide, Group, Line, LineDashedMaterial, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry,
  SRGBColorSpace, Vector3, type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createBrassPlaque } from './brass-plaque.ts';
import { CELL_SIZE, slotRestPosition, slotFloorSlope, slotFloorHeight } from './cabinet-layout.ts';

interface CabinetMaterials {
  readonly wood: MeshStandardMaterial;
  readonly interior: MeshStandardMaterial;
}

function canvasTexture(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('无法创建展柜装饰纹理');
  paint(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function cornerOcclusionTexture() {
  return canvasTexture(512, 384, (context) => {
    const edges: readonly [number, number, number, number][] = [
      [0, 0, 90, 0], [512, 0, 422, 0], [0, 0, 0, 70], [0, 384, 0, 302],
    ];
    for (const [x0, y0, x1, y1] of edges) {
      const shade = context.createLinearGradient(x0, y0, x1, y1);
      shade.addColorStop(0, 'rgba(12, 8, 6, 0.84)');
      shade.addColorStop(0.4, 'rgba(12, 8, 6, 0.3)');
      shade.addColorStop(1, 'rgba(12, 8, 5, 0)');
      context.fillStyle = shade;
      context.fillRect(0, 0, 512, 384);
    }
  });
}

function jointOcclusionTexture(surface: 'floor' | 'side') {
  return canvasTexture(512, 384, (context) => {
    // Canvas top maps to the floor's rear edge; the side plane's rear edge is at right.
    const edges: readonly [number, number, number, number][] = surface === 'floor'
      ? [[0, 0, 78, 0], [512, 0, 434, 0], [0, 0, 0, 126]]
      : [[512, 0, 364, 0], [0, 0, 0, 58], [0, 384, 0, 300]];
    for (const [x0, y0, x1, y1] of edges) {
      const shade = context.createLinearGradient(x0, y0, x1, y1);
      shade.addColorStop(0, 'rgba(12, 8, 6, 0.65)');
      shade.addColorStop(0.35, 'rgba(12, 8, 6, 0.24)');
      shade.addColorStop(1, 'rgba(12, 8, 5, 0)');
      context.fillStyle = shade;
      context.fillRect(0, 0, 512, 384);
    }
  });
}

function contactShadowTexture(tight: boolean) {
  return canvasTexture(256, 256, (context) => {
    const shadow = context.createRadialGradient(128, 128, 8, 128, 128, 123);
    shadow.addColorStop(0, tight ? 'rgba(9, 6, 4, 0.68)' : 'rgba(9, 6, 4, 0.22)');
    shadow.addColorStop(0.4, tight ? 'rgba(9, 6, 4, 0.5)' : 'rgba(9, 6, 4, 0.14)');
    shadow.addColorStop(0.72, tight ? 'rgba(9, 6, 4, 0.15)' : 'rgba(9, 6, 4, 0.04)');
    shadow.addColorStop(1, 'rgba(9, 6, 4, 0)');
    context.fillStyle = shadow;
    context.fillRect(0, 0, 256, 256);
  });
}

function lampHaloTexture() {
  return canvasTexture(256, 256, (context) => {
    const glow = context.createRadialGradient(128, 128, 0, 128, 128, 126);
    glow.addColorStop(0, 'rgba(255, 244, 209, 0.9)');
    glow.addColorStop(0.15, 'rgba(240, 156, 54, 0.78)');
    glow.addColorStop(0.46, 'rgba(240, 156, 54, 0.32)');
    glow.addColorStop(1, 'rgba(240, 156, 54, 0)');
    context.fillStyle = glow; context.fillRect(0, 0, 256, 256);
  });
}

function glassHighlightTexture() {
  return canvasTexture(128, 512, (context) => {
    const glint = context.createLinearGradient(0, 0, 128, 0);
    glint.addColorStop(0, 'rgba(200, 138, 75, 0)');
    glint.addColorStop(0.22, 'rgba(255, 214, 153, 0.18)');
    glint.addColorStop(0.38, 'rgba(255, 222, 173, 0.7)');
    glint.addColorStop(0.5, 'rgba(225, 165, 92, 0.3)');
    glint.addColorStop(1, 'rgba(200, 138, 75, 0)');
    context.fillStyle = glint; context.fillRect(0, 0, 128, 512);
    context.globalCompositeOperation = 'destination-in';
    const fade = context.createLinearGradient(0, 0, 0, 512);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(0.12, 'rgba(255,255,255,1)');
    fade.addColorStop(0.42, 'rgba(255,255,255,0.12)');
    fade.addColorStop(0.76, 'rgba(255,255,255,0.45)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = fade; context.fillRect(0, 0, 128, 512);
  });
}

function ticketShadowTexture() {
  return canvasTexture(256, 192, (context) => {
    context.filter = 'blur(14px)';
    context.fillStyle = 'rgba(8,5,3,0.42)';
    context.fillRect(35, 38, 186, 116);
  });
}

export function buildCabinetBody(materials: CabinetMaterials, labels: ReadonlyMap<number, string>): Group {
  const cabinet = new Group();
  cabinet.name = 'walnut-cabinet-body';

  function box(width: number, height: number, depth: number, x: number, y: number, z: number, material: Material) {
    const geometry = new RoundedBoxGeometry(width, height, depth, 2, Math.min(0.018, height / 5, width / 5, depth / 5));
    const uv = geometry.getAttribute('uv');
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const horizontal = width > height * 3;
    // The source represents 1.8 m; one cabinet unit is about 0.3 m. Offset each board.
    const offset = x * 0.17 + y * 0.23 + z * 0.37;
    for (let i = 0; i < uv.count; i++) {
      const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
      const nx = Math.abs(normals.getX(i)), ny = Math.abs(normals.getY(i));
      const u = nx > 0.7 ? pz : px;
      const v = ny > 0.7 ? pz : py;
      uv.setXY(i, (horizontal ? v : u) / 6 + offset, (horizontal ? u : v) / 6 + offset * 0.73);
    }
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    cabinet.add(mesh);
    return mesh;
  }

  function overlay(width: number, height: number, x: number, y: number, z: number, material: MeshBasicMaterial) {
    const mesh = new Mesh(new PlaneGeometry(width, height), material);
    mesh.position.set(x, y, z);
    cabinet.add(mesh);
    return mesh;
  }

  // Separate face rails leave a real joint and support the inset brass plaques.
  for (let slot = 0; slot < 6; slot += 1) {
    const [x, floorY] = slotRestPosition(slot);
    box(3.5, 2.52, 0.09, x, floorY + 1.2, -0.77, materials.interior);
  }
  for (const y of [2.57, 0.01, -2.74]) {
    box(10.8, y === 0.01 ? 0.14 : 0.18, 1.6, 0, y, 0.01, materials.wood);
    if (y === 0.01) box(10.83, 0.055, 0.075, 0, y - 0.045, 0.84, materials.wood);
  }
  for (const x of [-5.39, 5.39]) {
    box(0.2, 5.48, 1.6, x, -0.11, 0.01, materials.wood);
  }
  for (const x of [-1.8, 1.8]) {
    box(0.115, 5.32, 1.57, x, -0.12, 0.01, materials.wood);
    box(0.045, 5.32, 0.06, x, -0.12, 0.835, materials.wood);
  }
  // Four equal-width face boards, cut at 45 degrees; the structural box stays behind them.
  const outerX = 5.51, innerX = 5.28, top = 2.72, bottom = -2.91, frameWidth = 0.23;
  const rails: readonly (readonly [number, number])[][] = [
    [[-outerX, top], [outerX, top], [innerX, top - frameWidth], [-innerX, top - frameWidth]],
    [[-outerX, bottom], [-innerX, bottom + frameWidth], [innerX, bottom + frameWidth], [outerX, bottom]],
    [[-outerX, bottom], [-outerX, top], [-innerX, top - frameWidth], [-innerX, bottom + frameWidth]],
    [[outerX, top], [outerX, bottom], [innerX, bottom + frameWidth], [innerX, top - frameWidth]],
  ];
  rails.forEach((points, index) => {
    const shape = new Shape();
    points.forEach(([x, y], vertex) => { if (vertex === 0) shape.moveTo(x, y); else shape.lineTo(x, y); });
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, steps: 1 });
    const uv = geometry.getAttribute('uv'), position = geometry.getAttribute('position');
    for (let vertex = 0; vertex < uv.count; vertex++) {
      const x = position.getX(vertex), y = position.getY(vertex);
      uv.setXY(vertex, (index < 2 ? y : x) / 6, (index < 2 ? x : y) / 6);
    }
    const rail = new Mesh(geometry, materials.wood);
    rail.position.z = 0.805; rail.name = `cabinet-miter-frame:${index}`; cabinet.add(rail);
  });
  box(11.0, 0.13, 1.76, 0, -2.91, 0.025, materials.wood);
  box(10.77, 0.1, 1.63, 0, -3.015, 0.025, materials.wood);
  for (const x of [-4.95, 4.95]) box(0.33, 0.16, 1.18, x, -3.135, -0.035, materials.wood);

  box(10.68, 0.24, 1.48, 0, -3.095, -0.035, materials.wood);

  for (let slot = 0; slot < 6; slot++) {
    const [x, floorY] = slotRestPosition(slot);
    const railY = slot < 3 ? -0.065 : floorY - 0.16;
    box(3.43, slot < 3 ? 0.24 : 0.32, 0.09, x, railY, 0.825, materials.wood);
    if (slot < 3) {
      const shelf = box(3.43, 0.055, 1.46, x, slotFloorHeight(slot, 0.01) - 0.028, 0.01, materials.interior);
      shelf.rotation.x = Math.atan(slotFloorSlope(slot));
      shelf.name = `cabinet-raised-shelf:${slot}`;
    }
    for (const side of [-1, 1]) box(0.035, 2.28, 0.04, x + side * 1.68, floorY + 1.2, 0.74, materials.wood);
  }
  const occlusionMaterial = new MeshBasicMaterial({ map: cornerOcclusionTexture(), transparent: true, depthWrite: false });
  const floorOcclusionMaterial = new MeshBasicMaterial({ map: jointOcclusionTexture('floor'), transparent: true, depthWrite: false });
  const sideOcclusionMaterial = new MeshBasicMaterial({ map: jointOcclusionTexture('side'), transparent: true, depthWrite: false, side: DoubleSide });
  const glassMaterial = new MeshPhysicalMaterial({
    color: '#ffffff', metalness: 0, roughness: 0, transmission: 1,
    opacity: 1, ior: 1.5, thickness: 0.014, depthWrite: false, envMapIntensity: 0.7,
  });
  const glassEdge = new MeshStandardMaterial({ color: '#d8a263', metalness: 0, roughness: 0.25, transparent: true, opacity: 0.18, depthWrite: false });
  const liner = new MeshStandardMaterial({ color: '#0c0806', roughness: 0.56, metalness: 0 });
  const sideGlass = new MeshPhysicalMaterial({ color: '#ffd699', transparent: true, opacity: 0.18,
    roughness: 0.035, metalness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03, side: DoubleSide, depthWrite: false, envMapIntensity: 1.1 });
  const glintMaterial = new MeshBasicMaterial({ map: glassHighlightTexture(), transparent: true, opacity: 0.8,
    blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide });
  const haloMaterial = new MeshBasicMaterial({ map: lampHaloTexture(), transparent: true,
    blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide });
  const wallHaloMaterial = haloMaterial.clone();
  wallHaloMaterial.opacity = 0.5;
  const bronze = new MeshStandardMaterial({ color: '#c88a4b', roughness: 0.3, metalness: 0.7,
    emissive: '#c88a4b', emissiveIntensity: 0.1 });
  const floorGlowMaterial = haloMaterial.clone();
  floorGlowMaterial.opacity = 0.22;

  for (let slot = 0; slot < 6; slot += 1) {
    const [x, floorY, z] = slotRestPosition(slot);
    const ceilingY = slot < 3 ? 2.48 : -0.245;
    overlay(CELL_SIZE[0] + 0.07, ceilingY - floorY, x, (ceilingY + floorY) / 2, -0.711, occlusionMaterial);
    const floorOcclusion = overlay(CELL_SIZE[0] + 0.07, 1.49, x, slotFloorHeight(slot, 0.01) + 0.004, 0.01, floorOcclusionMaterial);
    floorOcclusion.rotation.x = -Math.PI / 2 + Math.atan(slotFloorSlope(slot));

    // A zero-thickness aperture on the ceiling's front lip avoids a protruding puck or dark bezel.
    const lamp = new Mesh(new CircleGeometry(0.145, 48), new MeshBasicMaterial({ color: '#fff6e0', toneMapped: false, side: DoubleSide }));
    lamp.scale.y = 0.2;
    lamp.position.set(x, ceilingY - 0.047, 0.79);
    lamp.name = `cabinet-lamp:${slot}`;
    cabinet.add(lamp);
    const lensGlow = overlay(0.66, 0.17, x, ceilingY - 0.047, 0.785, haloMaterial);
    lensGlow.name = `cabinet-lens-glow:${slot}`;
    const ceilingHalo = overlay(1.2, 0.75, x, ceilingY - 0.007, 0.36, haloMaterial);
    ceilingHalo.rotation.x = Math.PI / 2;
    const wallHalo = overlay(1.55, 0.8, x, ceilingY - 0.05, -0.701, wallHaloMaterial);
    wallHalo.name = `cabinet-lamp-halo:${slot}`;
    const floorGlow = overlay(2.75, 1.28, x, slotFloorHeight(slot, 0.06) + 0.008, 0.06, floorGlowMaterial);
    floorGlow.rotation.x = -Math.PI / 2 + Math.atan(slotFloorSlope(slot));
    floorGlow.name = `cabinet-floor-light:${slot}`;
    const openingFloor = slotFloorHeight(slot, 0.72);
    const openingHeight = ceilingY - openingFloor;
    for (const edgeY of [openingFloor + 0.018, ceilingY - 0.018]) {
      box(3.36, 0.035, 0.045, x, edgeY, 0.735, liner);
      box(3.31, 0.009, 0.012, x, edgeY, 0.765, bronze);
    }
    for (const side of [-1, 1]) {
      box(0.035, openingHeight, 0.045, x + side * 1.665, (ceilingY + openingFloor) / 2, 0.735, liner);
      box(0.009, openingHeight - 0.035, 0.012, x + side * 1.653, (ceilingY + openingFloor) / 2, 0.765, bronze);
      const glass = new Mesh(new PlaneGeometry(0.9, openingHeight - 0.07), sideGlass);
      glass.rotation.y = Math.PI / 2;
      glass.position.set(x + side * 1.64, (ceilingY + openingFloor) / 2, 0.24);
      glass.name = `cabinet-side-glass:${slot}:${side}`;
      cabinet.add(glass);
      const glint = overlay(side < 0 ? 0.21 : 0.14, openingHeight - 0.08, x + side * 1.60, (ceilingY + openingFloor) / 2, 0.747, glintMaterial);
      glint.name = `cabinet-glass-glint:${slot}:${side}`;
    }
    for (const side of [-1, 1]) {
      const atOuterWall = (slot % 3 === 0 && side < 0) || (slot % 3 === 2 && side > 0);
      const sideOcclusion = overlay(1.49, ceilingY - floorY - 0.025, x + side * (atOuterWall ? 1.688 : 1.7395), (ceilingY + floorY) / 2, 0.01, sideOcclusionMaterial);
      sideOcclusion.rotation.y = Math.PI / 2;
      const edge = box(0.008, ceilingY - floorY - 0.07, 0.012, x + side * 1.69, (ceilingY + floorY) / 2, 0.75, glassEdge);
      edge.castShadow = false;
    }

    const pane = new Mesh(new BoxGeometry(CELL_SIZE[0] - 0.035, openingHeight - 0.055, 0.014), glassMaterial);
    pane.position.set(x, (ceilingY + openingFloor) / 2, 0.755);
    pane.name = `cabinet-front-glass:${slot}`;
    // Picking only traverses the exhibit groups, never the glazing.
    cabinet.add(pane);

    {
      const shadow = new Group();
      shadow.position.set(x, floorY + 0.005, z);
      shadow.name = `cabinet-contact-shadow:${slot}`;
      const width = 1.95;
      const soft = new Mesh(new PlaneGeometry(width, 0.95), new MeshBasicMaterial({ map: contactShadowTexture(false), transparent: true, depthWrite: false }));
      soft.rotation.x = -Math.PI / 2 + Math.atan(slotFloorSlope(slot));
      soft.position.y = 0.001;
      const tight = new Mesh(new PlaneGeometry(width * 0.68, 0.3), new MeshBasicMaterial({ map: contactShadowTexture(true), transparent: true, depthWrite: false }));
      tight.rotation.x = -Math.PI / 2 + Math.atan(slotFloorSlope(slot));
      tight.position.y = 0.003;
      shadow.add(soft, tight);
      {
        const ticketShadow = new Mesh(new PlaneGeometry(2.15, 1.35), new MeshBasicMaterial({ map: ticketShadowTexture(), transparent: true, depthWrite: false }));
        ticketShadow.position.set(0.04, 0.53, -0.35);
        ticketShadow.name = `cabinet-ticket-shadow:${slot}`;
        ticketShadow.visible = slot === 4;
        shadow.add(ticketShadow);
      }
      cabinet.add(shadow);
      shadow.visible = labels.has(slot);
    }
    {
      const marker = new Line(new BufferGeometry().setFromPoints([
        new Vector3(-0.96, 0, -0.48), new Vector3(0.96, 0, -0.48),
        new Vector3(0.96, 0, 0.48), new Vector3(-0.96, 0, 0.48), new Vector3(-0.96, 0, -0.48),
      ]), new LineDashedMaterial({ color: '#eed9b5', transparent: true, opacity: 0.66, dashSize: 0.09, gapSize: 0.06, toneMapped: false }));
      marker.position.set(x, floorY + 0.018, z);
      marker.rotation.x = Math.atan(slotFloorSlope(slot));
      marker.computeLineDistances();
      cabinet.add(marker);
      marker.name = `empty-slot-marker:${slot}`;
      marker.visible = !labels.has(slot);
    }
  }

  for (let slot = 0; slot < 6; slot++) {
    const [x, floorY] = slotRestPosition(slot);
    const plaque = createBrassPlaque(labels.get(slot) ?? '', slot);
    plaque.position.set(x, slot < 3 ? -0.065 : floorY - 0.16, 0.91);
    if (slot < 3) plaque.scale.y = 0.9;
    plaque.visible = labels.has(slot);
    cabinet.add(plaque);
  }
  return cabinet;
}
