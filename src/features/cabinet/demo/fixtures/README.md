# 三维边界夹具

全部由项目脚本程序合成，无真实照片、讲述、第三方模型或生成服务调用。GLB 元数据也标记为 QA fixture，不得作为图生 3D 成果展示。

| 文件 | 检查目的 | 预期 |
| --- | --- | --- |
| `slender.glb` | 0.04×8×0.06、偏移到 40/-20/10 的细长模型 | 居中、落地、不穿柜格 |
| `flat.glb` | 扁平模型、0.001 节点比例与偏心原点 | 保留自身变换并正确适配 |
| `textured.glb` | 内嵌 16×2 PNG 的有效模型 | 正常加载、贴图资源随生命周期释放 |
| `empty.glb` | 有效容器但场景没有几何体 | 明确拒绝 |
| `triangle-budget.glb` | 250,001 个三角面 | 面数超限，明确拒绝 |
| `texture-budget.glb` | 内嵌 4097×2 PNG | 单轴贴图超限，明确拒绝 |

在仓库根目录重建：

```sh
node --import tsx scripts/generate-model-fixtures.ts
pnpm test:scene
```

浏览器打开 `/model-lab.html` 并点击“运行全部检查”；同一检查台也随 `pnpm build:scene` 构建。Node 测试通过真实 GLTFLoader 检查几何夹具；内嵌图片解码与超限由实际浏览器检查，不能把 Node 测试当作图片解码证据。
