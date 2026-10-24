# 展厅环境背景来源

更新：2026-10-24。

- 文件：`gallery-environment.png`，1672 × 941，RGB PNG，约 1.61 MB。
- 来源：使用内置 image_gen 工具，依据用户在本次对话提供的展柜视觉参考图生成环境底图。未引入第三方图库或 HDR 资源；不将生成图标注为实拍。
- 用途：独立展柜预览与正式参观页共用的环境背景。仅包含虚化的暖暗展厅和连续暖棕台面，不含展柜、展品、铭牌或 UI。展柜、GLB、底座接触阴影及检视仍由实时 Three.js 场景负责。
- 接入：`../gallery-backdrop.css` 使用本地相对资源引用，由 Vite / Next.js 打包。深色底色在图片未完成载入时保留。
- 这不是照片生成旧物模型的结果，不代表用户藏品、已确认故事或物主实拍。其使用不替代用户生成素材的授权和归属检查。

## 最终生成提示

```text
Use case: precise-object-edit.
Asset type: production environment backdrop for a live interactive Three.js museum cabinet, opaque wide 16:9 photograph.
Edit the attached reference image into a CLEAN ENVIRONMENT PLATE. Completely remove the entire foreground wooden six-compartment cabinet, its base, every exhibited object, every plaque, every glass panel, all interface text, title, buttons, symbols and bottom caption. Reconstruct the empty background behind them. No cabinet or foreground display object should remain.
Preserve and extend the reference's photographic environment: a very dark, warm umber museum gallery with heavily defocused distant display furniture at the far left and right, a few restrained diffuse amber glows around the edges, a nearly black brown unobtrusive central back wall, softly receding architectural depth. The entire background must be optically defocused and subdued, calm and warm, not a modern bright lobby. No visible people.
Preserve the reference's continuous warm dark-brown aged stone or walnut exhibition tabletop across the full lower 24 percent of the image, meeting the dark blurred gallery naturally near 76 percent height. This foreground plane has subtle irregular fine mottling, quiet worn patina and broad faint satin light reflections, no tile joints, no checkerboard, no grid, no wood plank seams, no bright yellow oval spotlight pools, no sharp horizon edge. Moderate surface roughness, low reflectivity. Make it convincingly photographic with shallow depth of field rather than smooth synthetic gradients.
The live cabinet will later cover the central 88 percent of width and the area from 10 to 89 percent height. Leave that zone empty and quiet; meaningful environmental mood must remain visible along the side margins, above the cabinet, and across the foreground tabletop. Match the reference camera almost straight on, close to tabletop height. Keep the overall exposure dark, with warm brown and neutral charcoal, avoid green.
ABSOLUTE EXCLUSIONS: text, typography, logos, watermark, camera, cassette, ticket, shelves or cabinet in foreground, six-cell framing, interface decorations, harsh light spots, sharp floor grout. Output only the clean empty environment photograph.
```
