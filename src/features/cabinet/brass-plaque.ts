import { BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function texture(paint: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 192;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('无法创建黄铜铭牌纹理');
  paint(context); return new CanvasTexture(canvas);
}

function paintText(context: CanvasRenderingContext2D, text: string) {
  context.clearRect(0, 0, 1600, 192);
  context.fillStyle = '#21190f'; context.textAlign = 'center'; context.textBaseline = 'middle';
  const family = '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
  context.font = `400 94px ${family}`;
  const fontSize = Math.min(94, Math.floor(94 * 1260 / Math.max(1, context.measureText(text).width)));
  context.font = `400 ${fontSize}px ${family}`;
  context.fillText(text, 800, 100);
}

export function updateBrassPlaqueText(root: Object3D, slot: number, text: string): void {
  const label = root.getObjectByName(`exhibit-plaque:${slot}`);
  if (!(label instanceof Mesh) || !(label.material instanceof MeshBasicMaterial) || !(label.material.map instanceof CanvasTexture)) throw new Error('缺少铭牌文字材质');
  if (label.userData.text === text) return;
  const canvas: unknown = label.material.map.source.data;
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('缺少铭牌文字画布');
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('无法更新铭牌文字');
  paintText(context, text); label.material.map.needsUpdate = true; label.userData.text = text;
}

export function createBrassPlaque(text: string, slot: number) {
  const plaque = new Group();
  plaque.name = `cabinet-plaque-group:${slot}`;
  const brushed = texture((c) => {
    c.fillStyle = '#bdbdbd'; c.fillRect(0, 0, 1600, 192);
    for (let y = 0; y < 192; y++) {
      const value = 180 + Math.sin(y * 7.31) * 12 + Math.sin(y * 1.77) * 5;
      c.fillStyle = `rgb(${value},${value},${value})`; c.fillRect(0, y, 1600, 1);
    }
  });
  const patina = texture((c) => {
    const gradient = c.createLinearGradient(0, 0, 0, 192);
    gradient.addColorStop(0, '#d1b987'); gradient.addColorStop(0.24, '#c3a16c');
    gradient.addColorStop(0.52, '#b69663'); gradient.addColorStop(1, '#947344');
    c.fillStyle = gradient; c.fillRect(0, 0, 1600, 192);
    c.strokeStyle = '#c6b18b'; c.lineWidth = 6; c.strokeRect(3, 3, 1594, 186);
  });
  patina.colorSpace = SRGBColorSpace;
  const material = new MeshPhysicalMaterial({ map: patina, color: '#c5b59d', metalness: 0.88, roughness: 0.58, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.0006, anisotropy: 0.3, envMapIntensity: 0.85 });
  const body = new Mesh(new RoundedBoxGeometry(1.96, 0.235, 0.043, 3, 0.014), material);
  body.name = `cabinet-plaque:${slot}`; plaque.add(body);
  const seat = new Mesh(new RoundedBoxGeometry(1.985, 0.25, 0.008, 2, 0.012), new MeshStandardMaterial({ color: '#281f17', roughness: 0.95 }));
  seat.position.set(0, -0.003, -0.024); plaque.add(seat);
  const textMap = texture((c) => paintText(c, text));
  textMap.colorSpace = SRGBColorSpace;
  const label = new Mesh(new PlaneGeometry(1.96, 0.235), new MeshBasicMaterial({ map: textMap, transparent: true, depthWrite: false }));
  label.position.z = 0.022; label.name = `exhibit-plaque:${slot}`; plaque.add(label);
  label.userData.text = text;
  const screwMaterial = new MeshStandardMaterial({ color: '#b9a17a', metalness: 0.9, roughness: 0.35 });
  const screwGeometry = new SphereGeometry(0.022, 16, 8);
  const grooveMaterial = new MeshStandardMaterial({ color: '#55432b', metalness: 0.7, roughness: 0.6 });
  for (const x of [-0.865, 0.865]) {
    const screw = new Mesh(screwGeometry, screwMaterial); screw.scale.z = 0.4; screw.position.set(x, 0, 0.024); plaque.add(screw);
    const groove = new Mesh(new BoxGeometry(0.026, 0.003, 0.001), grooveMaterial); groove.position.set(x, 0, 0.033); groove.rotation.z = 0.3; plaque.add(groove);
  }
  return plaque;
}
