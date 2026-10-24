# 拾物馆品牌资源

2026-10-24 用户确认采用朱砂红“拾”字方印，并保留组合稿右侧的“拾物馆 / MEMORIES MUSEUM”标准字。

- `logo.png`：独立方印，512 × 512，用于项目标识。
- `lockup.webp`：横向组合，1080 × 320，保留已确认原稿的暗色背景和字形。适用于暗色顶栏，不是透明底或矢量文件。
- `src/app/icon.png`、`src/app/apple-icon.png`：同一方印导出的 64 和 180 像素浏览器图标，由 Next.js 文件约定接入。
- `src/features/navigation/brand.tsx`：首页、登录页与工作台共用的品牌组合；保留替代文本，显示时等比例缩放。

组合原稿来自 `output/imagegen/logo-concepts-20261024/04-brand-lockup-combined.png`（imagegen 生成后由用户确认）。前端资源仅裁去空白、缩放和编码；未采用后续生成的透明底试稿。独立图标取自用户选定的第一张方印。

不要用重新排版的字体替换标准字，也不要将图标改回早期六格物件插画。
