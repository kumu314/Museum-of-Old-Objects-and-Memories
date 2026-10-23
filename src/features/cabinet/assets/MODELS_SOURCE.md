# 项目自建磁带与旧车票模型

更新于 2026-10-24。当前 `model-manifest.ts` 将磁带、旧车票登记为独立 GLB，加载 `cassette.glb` 与 `ticket.glb`。两件由本项目离线脚本建模，未下载或引入第三方磁带、车票网格；标签和票面依据用户提供的演示参考图程序化重绘，未从参考照片裁切像素。仅用于本项目演示，不代表用户真实藏品或已确认的物主故事，也不沿用 Poly Haven 相机的 CC0 许可声明。

## 几何、材质与真实性

- 磁带：分别建模的前后外壳、中央接缝、真正开孔的卷轴窗口、双卷轴与磁带卷、螺钉、侧面凹槽和磁头开口；A/B 双面纸签和低透明度窗口材质。壳体、塑料、磁带卷与金属使用 PBR 材质，卷轴不是画在平面的照片。内部机械、背面及磨损是示意，不能据此判断品牌、型号或真实使用状态。
- 旧车票：连续的正反曲面、中央折痕、卷角、微小边缘缺口和封闭纸边；正面重绘“北京 → 上海”等参考图票面内容，未提供的背面保持空白纸色示意。纸纤维为法线纹理，卷曲和纸厚来自实际网格。票面日期、金额与车次只属于演示参考，不是经核实的旅行记录。
- `model-source/generate-textures.py` 生成四张 2048×1280 颜色纹理：`cassette-label-a`、`cassette-label-b`、`ticket-front`、`ticket-back`；另生成 1024×1024 塑料法线与 1024×512 纸张法线。使用固定随机种子与指定字体。颜色纹理采用 sRGB，法线纹理保持数据颜色空间，运行时统一设置设备支持的最大各向异性过滤。
- `model-source/build-models.mjs` 按材质合并网格、烘焙建模变换，并将几何与纹理全部内嵌 GLB 2.0。输出单位为米，+Y 向上、+Z 为正面，以完整模型包围盒的底部中心为原点。

## 尺寸约定与参考资料

三件展品在 `cabinet-layout.ts` 中使用同一个 `MODEL_UNITS_PER_METRE=14.18`，保留相机、磁带和车票的相对米制尺寸。`fitModelBounds` 仍检查柜格三轴净空，当前样例均使用这一共同比例；不逐件放大到相同柜格占宽。

| 模型 | 建模尺寸 / 原资产尺寸 | 尺寸的含义 |
| --- | --- | --- |
| 相机 | 约 147.34×77.57×88.84 mm | 公开相机资产移除肩带后的完整包围盒；不是参考图双反或用户藏品测量 |
| 磁带 | 100.4×63.8×12 mm | 包含壳体边缘与螺钉的样例整体外廓 |
| 旧车票 | 纸幅 90×60 mm；纸厚 0.24 mm | 作为时期相近的纸票样例；厚度与弯曲是建模参数，非实测 |

磁带格式背景参考伊利诺伊大学 [PSAP Audiotape：Compact Cassette](https://psap.library.illinois.edu/collection-id-guide/audiotape)。该资料介绍塑料外壳、双内部卷轴及约 4×2½×½ 英寸的常见外形；本项目的毫米参数是样例建模取值，不是由该资料证明的某件藏品精确测量。

90×60 mm 纸票尺寸背景参考 2005 年公开的 [CN2741780Y《一种铁路纸质客票》](https://patents.google.com/patent/CN2741780Y/zh)“背景技术 / 外观特征”对既有车票的描述。这里只借用历史纸幅尺度，不复现其磁条等专利方案，不推断参考图中车票的真实尺寸、纸厚或制式完全一致。

车票导出前带有曲面、卷角、后倾 8° 和平面内倾斜 3°，因此完整包围盒为约 93.20×63.85×12.27 mm；12.27 mm 是倾斜纸张的整体深度跨度，纸层厚度仍为 0.24 mm。三个样例的尺寸和侧背细节均不应标注为物主藏品的精确复原。

## 构建产物记录

以下取自同目录 [`model-source/build-report.json`](model-source/build-report.json)，尺寸为宽 × 高 × 深，单位为米。网格数为按材质合并后的渲染网格数量，不是制作时的零件数。

| 文件 | 字节数 | 网格数 | 三角形数 | 导出包围盒尺寸（米） |
| --- | ---: | ---: | ---: | --- |
| `cassette.glb` | 3,974,308 | 11 | 31,116 | 0.10040000081062317 × 0.06379999965429306 × 0.012000000104308128 |
| `ticket.glb` | 2,441,244 | 3 | 9,616 | 0.09320279955863953 × 0.06384895741939545 × 0.012273497879505157 |

SHA-256：

- `cassette.glb`：`0951e1ccf8db0d2f7303730573d6f7718fa336941560c3487f1b6d24dd5b236d`
- `ticket.glb`：`ae9835f47bb286f371a92d18eae6946799796503600230e3dd5dd8f13864b7a7`

内嵌纹理：磁带为 `plastic-normal`、`cassette-label-a`、`cassette-label-b`；车票为 `ticket-front`、`paper-normal`、`ticket-back`。完整 min/max 包围盒见报告，不需要外部图片请求。

## 从源文件重建

在项目根目录运行，替换下列绝对路径占位参数。需要已配置的 Python（Pillow、NumPy）、Noto Serif CJK Regular TTC 字体，以及现有 Node / Three.js 环境；验证脚本额外使用 `@napi-rs/canvas` 解码内嵌图片。当前运行环境的 Three.js 为 0.186.1，不为重建升级项目依赖。

```sh
python3 src/features/cabinet/assets/model-source/generate-textures.py \
  /path/to/generated-textures \
  --font /path/to/NotoSerifCJK-Regular.ttc

node src/features/cabinet/assets/model-source/build-models.mjs \
  /path/to/node_modules/three \
  /path/to/generated-textures

node src/features/cabinet/assets/model-source/verify-models.mjs \
  /path/to/node_modules/three \
  /path/to/node_modules/@napi-rs/canvas/index.js
```

第二步会重建并覆盖 `assets/cassette.glb`、`assets/ticket.glb` 和 `assets/model-source/build-report.json`。第三步实际调用 GLTFLoader 解析并解码纹理，检查 GLB 容器、内嵌 buffer/image、对齐、索引、法线、米制尺寸和底部中心原点；不启动 WebGL，不能替代浏览器渲染验收。改变字体、图像库或 Three.js 版本后应重新核对报告和效果，不保证跨工具版本输出字节相同。
