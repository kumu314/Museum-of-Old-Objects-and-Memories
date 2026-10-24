import { CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RepeatWrapping } from 'three';

/** Continuous floor, fading into the distant gallery; no finite rectangle or hard horizon. */
export function createGallerySurroundings() {
  const gallery = new Group();
  // Blend the rough receiving plane into the photographic tabletop; the cabinet's contact shadow remains separate.
  const floor = new Mesh(new PlaneGeometry(160, 160), new MeshStandardMaterial({ color: '#30271f', roughness: 0.94, metalness: 0, envMapIntensity: 0.16, transparent: true, opacity: 0.24, depthWrite: false }));
  const grainCanvas = document.createElement('canvas'); grainCanvas.width = 512; grainCanvas.height = 512;
  const grain = grainCanvas.getContext('2d');
  if (grain === null) throw new Error('无法创建地面细微肌理');
  const pixels = grain.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const noise = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const value = 228 + noise % 16 + Math.round(8 * Math.sin(x * 0.12 + Math.sin(y * 0.04)));
    const index = (y * 512 + x) * 4;
    pixels.data[index] = value; pixels.data[index + 1] = value; pixels.data[index + 2] = value; pixels.data[index + 3] = 255;
  }
  grain.putImageData(pixels, 0, 0);
  const grainMap = new CanvasTexture(grainCanvas);
  grainMap.wrapS = RepeatWrapping; grainMap.wrapT = RepeatWrapping; grainMap.repeat.set(28, 28);
  floor.material.roughnessMap = grainMap; floor.material.bumpMap = grainMap; floor.material.bumpScale = 0.018;
  floor.material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 galleryPosition; varying vec4 galleryClip;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ngalleryPosition = (modelMatrix * vec4(position, 1.0)).xyz;').replace('#include <project_vertex>', '#include <project_vertex>\ngalleryClip = gl_Position;');
    shader.fragmentShader = 'varying vec3 galleryPosition; varying vec4 galleryClip;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', 'diffuseColor.a *= smoothstep(0.0, 0.12, galleryClip.y / galleryClip.w * 0.5 + 0.5) * smoothstep(-12.0, -1.5, galleryPosition.z) * (1.0 - smoothstep(1.8, 5.5, galleryPosition.z));\n#include <opaque_fragment>');
  };
  floor.rotation.x = -Math.PI / 2; floor.position.y = -3.225; floor.receiveShadow = true; gallery.add(floor);
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = 512; shadowCanvas.height = 128;
  const shade = shadowCanvas.getContext('2d');
  if (shade === null) throw new Error('无法创建底座接触阴影');
  shade.filter = 'blur(12px)'; shade.fillStyle = 'rgba(4,3,2,0.86)'; shade.fillRect(24, 28, 464, 72);
  const shadow = new Mesh(new PlaneGeometry(11.8, 2.6), new MeshBasicMaterial({ map: new CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, -3.218, 0); gallery.add(shadow);
  return gallery;
}
