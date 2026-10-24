import { BufferGeometry, Line, Material, Mesh, Texture, type Object3D } from 'three';

export function disposeResources(root: Object3D, additionalTextures: ReadonlySet<Texture> = new Set()) {
  const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>(); const textures = new Set(additionalTextures);
  root.traverse((node) => {
    if (!(node instanceof Mesh) && !(node instanceof Line)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      const values: readonly unknown[] = Object.values(material);
      for (const value of values) if (value instanceof Texture) textures.add(value);
    }
  });
  const images = new Set<ImageBitmap>();
  for (const texture of textures) {
    const image: unknown = texture.source.data;
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) images.add(image);
    texture.dispose();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const image of images) image.close();
}
