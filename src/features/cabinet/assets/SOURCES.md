# 三维演示资产来源

这些资产用于验证展柜与检视交互，不是用户真实旧物的精确复原，不对应已确认的物主故事。

## 当前资产清单（2026-10-24）

| 资产 | 当前来源与用途 | 详情 |
| --- | --- | --- |
| `camera-01.glb` | Poly Haven CC0 演示相机，移除肩带并内嵌纹理 | 下方相机记录 |
| `cassette.glb` | 项目自建完整磁带网格与重绘标签，侧背和内部机械示意 | [自建模型来源与重建](MODELS_SOURCE.md) |
| `ticket.glb` | 项目自建双面曲面纸张，参考票面重绘、背面空白示意 | [自建模型来源与重建](MODELS_SOURCE.md) |
| 胡桃木贴图 | 既有材质资产 | [木纹来源](WALNUT_SOURCE.md) |
| `reference-overview.png` | 保留的历史参考图；当前运行时不再裁切它生成磁带/车票 | [历史薄片记录](REFERENCE_SOURCE.md) |

三件米制 GLB 按 `MODEL_UNITS_PER_METRE=14.18` 共同比例陈列。具体尺寸、构建统计及真实性边界见 [MODELS_SOURCE.md](MODELS_SOURCE.md)；不得将相机 CC0 许可扩大到用户参考图或自建模型的参考图内容。

## `camera-01.glb`

- 原资产：[Camera 01 — Poly Haven](https://polyhaven.com/a/Camera_01)。
- 作者：Rajil Jose Macatangay。
- 许可：CC0 1.0；见 [Poly Haven 资产许可](https://polyhaven.com/license)及 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。许可允许修改和再分发；未使用网站预览渲染图。
- 导入日期：2026-10-23。
- 下载清单：[官方文件 API](https://api.polyhaven.com/files/Camera_01)，采用 `gltf.1k.gltf` 及其 `include` 列表。
- 原始模型：[Camera_01_1k.gltf](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/Camera_01/Camera_01_1k.gltf)。原始 glTF、二进制与 9 张 JPEG 合计 2,439,882 字节，各文件均与 API 的字节数和 MD5 一致。

派生修改：

1. 移除单独的 `Camera_01_strap` 节点及其网格，即摊开放置的肩带，保留机身、镜头和附着在机身上的原有细部。
2. 将几何数据与 9 张 1024 × 1024 JPEG 全部内嵌到单个 GLB；保留原始材质、UV、法线和镜片的 `KHR_materials_transmission`，不依赖外部纹理请求。
3. 保留米制尺寸、+Y 向上与镜头正面朝 +Z 的方向。新增父节点平移 `[-0.00005474686622619629, -0.0005347318947315216, -0.025720559060573578]`，以移除肩带后、包含所有节点变换的完整包围盒确定底部中心原点，没有改用动画中间位置或独立渲染尺度补丁。

派生文件：

- 大小：2,436,612 字节。
- SHA-256：`dd41ee119722496057f95bcfb048a0039dffcffb05ed90717bc7ac9a5eaf2987`。
- 可见模型：4 个网格、4 份材质、22,319 个三角形。
- 完整尺寸（宽 × 高 × 深）：`0.14734002947807312 × 0.07756740972399712 × 0.08883751928806305` 米。
- 完整边界：`min [-0.07367001473903656, 0, -0.044418759644031525]`，`max [0.07367001473903656, 0.07756740972399712, 0.044418759644031525]`。

导入验证：GLB 2.0 文件头、长度与分块、bufferView 范围与 4 字节对齐、纹理内嵌引用均通过检查。Three 0.186.1 的 `GLTFLoader.parseAsync` 已实际解析导出文件，并在 Node 中使用 ImageMagick 将 9 张内嵌 JPEG 解码成真实 RGBA DataTexture；节点变换后的逐顶点包围盒与上述边界一致。镜头壳原始 Z 范围为 `0.0108～0.0701` 米，机身约为 `-0.0187～0.0196` 米，证明镜头沿 +Z 突出；本次只做平移，保留该朝向。此记录不替代浏览器中的 WebGL 画面与交互验收。
