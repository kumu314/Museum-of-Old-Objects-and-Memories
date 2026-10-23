import {
  CanvasTexture, Color, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry,
  PMREMGenerator, PointLight, Scene, Vector3, type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Local studio reflection cards: no HDR download or recurring environment render. */
export function createWarmEnvironment(renderer: WebGLRenderer) {
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  room.traverse((node) => {
    if (node instanceof PointLight) node.color.set('#ffe6c7');
    if (node instanceof Mesh && node.material instanceof MeshLambertMaterial) {
      node.material.emissive.set('#ffe6c7');
      node.material.emissiveIntensity *= 0.55;
    }
  });
  const cards = [
    { color: '#fff5e4', strength: 7, size: [2.4, 5.5], position: [-4.5, 4.0, 6.5] },
    { color: '#f3b86c', strength: 4, size: [1.2, 4.6], position: [5.0, 2.0, 4.5] },
    { color: '#fff1da', strength: 5, size: [4.5, 1.0], position: [0, 7.0, 2.0] },
  ] as const;
  for (const card of cards) {
    const panel = new Mesh(new PlaneGeometry(...card.size), new MeshBasicMaterial({
      color: new Color(card.color).multiplyScalar(card.strength), toneMapped: false,
    }));
    // RoomEnvironment itself is translated down; cards face the capture origin.
    panel.position.set(card.position[0], card.position[1] + 3.5, card.position[2]);
    panel.lookAt(new Vector3(0, 3.5, 0));
    room.add(panel);
  }
  try { return pmrem.fromScene(room, 0.035, 0.1, 100, { size: 256 }); }
  finally { room.dispose(); pmrem.dispose(); }
}

/** Separate glazing probe. Cards are captured by PMREM, not merely lit scene meshes. */
export function createGlassEnvironment(renderer: WebGLRenderer) {
  const room = new Scene();
  room.background = new Color('#1b1008');
  const diffusion = document.createElement('canvas'); diffusion.width = 128; diffusion.height = 256;
  const context = diffusion.getContext('2d');
  if (context === null) throw new Error('无法创建玻璃反射柔光卡');
  const glow = context.createRadialGradient(64, 128, 5, 64, 128, 125);
  glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.45, '#b0b0b0'); glow.addColorStop(1, '#000000');
  context.scale(0.52, 1); context.fillStyle = glow; context.fillRect(0, 0, 256, 256);
  const softCard = new CanvasTexture(diffusion);
  const cards = [
    { x: -2.75, y: 0.3, width: 0.52, height: 5.5, strength: 2.6 },
    { x: -1.02, y: -0.4, width: 0.18, height: 3.0, strength: 1.5 },
    { x: 2.88, y: 0.8, width: 0.72, height: 4.2, strength: 2.0 },
  ];
  for (const card of cards) {
    const panel = new Mesh(new PlaneGeometry(card.width, card.height), new MeshBasicMaterial({ map: softCard, color: new Color('#ffd699').multiplyScalar(card.strength), toneMapped: false }));
    panel.position.set(card.x, card.y, 8); panel.lookAt(0, 0, 0); room.add(panel);
  }
  const pmrem = new PMREMGenerator(renderer);
  try { return pmrem.fromScene(room, 0.022, 0.1, 30, { size: 256 }); }
  finally {
    room.traverse((node) => { if (node instanceof Mesh) { node.geometry.dispose(); if (node.material instanceof MeshBasicMaterial) node.material.dispose(); } });
    softCard.dispose(); pmrem.dispose();
  }
}
