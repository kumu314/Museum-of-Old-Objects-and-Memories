import {
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Group,
  type Material,
} from 'three';

/** 仅细化 Camera_01 原有表面，保留其贴图、黑漆颜色和逐像素金属度。 */
export function refineCameraMaterials(model: Group): void {
  const replacements = new Map<Material, MeshStandardMaterial>();

  function refine(source: Material): Material {
    const existing = replacements.get(source);
    if (existing !== undefined) return existing;
    if (!(source instanceof MeshStandardMaterial)) return source;

    let replacement: MeshStandardMaterial;
    switch (source.name) {
      case 'Camera_01_lens': {
        // 此 GLB 的 KHR_materials_transmission 镜片已由加载器创建为 Physical。
        if (!(source instanceof MeshPhysicalMaterial)) return source;
        const lens = source.clone();
        lens.clearcoat = 1;
        lens.clearcoatRoughness = 0.04;
        lens.roughness = 0.08;
        lens.specularColor.set('#d9dfff');
        lens.iridescence = 0.18;
        lens.iridescenceIOR = 1.3;
        lens.iridescenceThicknessRange = [180, 260];
        replacement = lens;
        break;
      }
      case 'Camera_01_lens_body':
        replacement = source.clone();
        replacement.roughness *= 0.9;
        break;
      case 'Camera_01_body':
        replacement = source.clone();
        // 机身蒙皮与金属共用图集；保留粗糙度分区，只略增强原法线细节。
        // normalMap 存在时 Three 会忽略 bumpMap，不能用叠加 bump 假装增细。
        replacement.normalScale.multiplyScalar(1.12);
        break;
      case 'Camera_01_strap':
        replacement = source.clone();
        replacement.normalScale.multiplyScalar(1.08);
        break;
      default:
        return source;
    }

    replacement.needsUpdate = true;
    replacements.set(source, replacement);
    return replacement;
  }

  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.material = Array.isArray(node.material)
      ? node.material.map(refine)
      : refine(node.material);
  });

  // 同一源材质可被多个网格共用；全部替换后只释放一次材质，纹理仍归模型所有。
  for (const source of replacements.keys()) source.dispose();
}
