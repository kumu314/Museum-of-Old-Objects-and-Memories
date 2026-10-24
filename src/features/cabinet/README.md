# A：展柜与检视原型

更新于 2026-10-24。本目录保留独立三维原型；同一场景现也由 `../viewer/shared-museum.tsx` 挂载到 `/share/[token]` 正式参观页。正式页面经公共 schema 校验后消费发布快照，联动展签、实拍和原声；独立预览的本地编辑不会写入正式展馆。真实 AI、内容和设备尚未完整验收，不能据此视为 G4 已完成。

## 入口与边界

方案 B 的动态 GLB、制作预览、陈列设置与 C/D/B 交接说明见 [模型预览接口](../viewer/MODEL_INTEGRATION.md)。独立入口为 `/model-preview.html`；`/qa.html?preview=model` 使用相同检查台验证窄屏和图形故障，`&webgl=blocked` 模拟首次初始化失败。`/model-lab.html` 检查实际 GLB 边界、旧响应、双指和重复挂载；程序化资产与再生成命令见 [夹具说明](demo/fixtures/README.md)。这些入口采用已有演示或明确标识的合成资产，没有调用照片生成服务或保存到正式展馆。

- `cabinet-stage.ts`：`mountCabinetStage(canvas, items, controller, options)`，一个 Canvas，消费展品 ID、格位、铭牌和受信任模型键；`photo-plane` 使用当前快照授权的处理图片生成有厚度的薄片，背面为示意；`glb` 消费本站受控模型地址。返回 `retry()`、`retryModel(id)`、`resetView()`、`setModelSource(id, source)`、`setModelPlacement(id, placement)`、`setEditing(enabled)`、`setArrangement(arrangement)`、`destroy()`；`onSlotDrop(id, targetSlot)` 只上报换位意图，由调用方更新权威陈列数据。
- `../viewer/inspection-controller.ts`：`createInspectionController(ids)`，提供选择、返回、订阅和带 transitionId 的完成通知；旧回调无法完成新动画。
- `model-fit.ts`：完整节点包围盒的最小等比适配与底部中心落点，三轴均保留至少 10%；当前三件米制 GLB 共用 `cabinet-layout.ts` 中的 `MODEL_UNITS_PER_METRE=14.18`，不再逐件按柜格宽度放大。
- `cabinet-arrangement.ts`：演示陈列条目的校验、六格移动/互换和铭牌文字修改；每件展品恰好出现一次，格位为互不重复的整数 0–5。
- `model-manifest.ts`：固定模型键及来源、版本、许可和近似程度；不接受用户输入的模型 URL。
- `demo/index.html`、`demo/main.ts`、`demo/style.css`：可移植的演示页面源文件。通过根目录 Vite 配置与锁文件运行。
- `demo/qa.html`、`demo/qa.ts`：单独检查台，支持视口、WebGL 中断、减少动态 fixture、合成悬停和静止一秒 RAF 计数；不是参观页面的操作入口。

接入时在客户端挂载场景，并在对应生命周期调用 `destroy()`。销毁会释放指针捕获并关闭所属 WebGL 上下文；再次挂载使用新 Canvas。`zoomBy(factor)` 调整检视时的临时观察比例，`getDiagnostics()` 为检查台提供只读资源记录。调用方必须先按公共契约校验数据。`inspectionInset()` 返回覆盖画布的右侧面板宽度（像素）；窄屏面板在画布下方时返回 0。`onSurfaceStatus` 应显示故障说明、隐藏失效画布并保留图文入口；`onAssetStatus` 提供加载和失败状态。B 从同一个 controller 订阅当前选择，并在切换时停止旧音频，默认不自动播放。

## 当前实现（2026-10-24 三维模型、统一尺寸与陈列编辑）

磁带和旧车票已切换到项目自建的 `assets/cassette.glb`、`assets/ticket.glb`，与相机共用 GLTFLoader 加载、包围盒归一化和原有检视流程。两件使用真实几何、PBR 材质及程序化重绘的 2048×1280 双面颜色纹理；塑料与纸纤维另有法线纹理。磁带包括前后外壳、开孔、卷轴、磁带卷、螺钉与侧缘，车票包括曲面、折痕、卷角及连续纸边。侧背和内部机械仍是示意，不是实物扫描或精确藏品复原。旧参考图片裁切模型不再进入当前运行链路，历史说明见 `assets/REFERENCE_SOURCE.md`；模型统计、来源边界及重建命令见 `assets/MODELS_SOURCE.md`。

三件按米制资产共同比例陈列：`MODEL_UNITS_PER_METRE=14.18`。相机沿用原资产包围盒约 147.34×77.57×88.84 mm；磁带为 100.4×63.8×12 mm；车票建模纸幅为 90×60 mm、纸厚 0.24 mm。车票弯曲并倾斜后包围盒约为 93.20×63.85×12.27 mm，最后一项是整个曲面在深度方向的跨度，不是纸厚。这些是演示样例尺寸约定，并非用户藏品测量；相机型号也仍与参考图的双反不同。

### 编辑操作与保存边界

1. 在主应用登录现有制作账号后打开 `http://127.0.0.1:17681/?studio`。该预览通过 `/api/auth/session` 校验会话，开发服务器仅代理此读取接口；未登录或核验失败时不显示“编辑陈列”与“展品目录”。普通 `/` 始终是参观视图。静态构建若没有同源会话接口，制作入口不会启用。
2. 点击右上角“编辑陈列”。若正在检视，先沿原四态流程放回，回到 `overview` 后才进入独立编辑模式；完成编辑仍留在总览。
3. 将展品拖到六格中的空格会移动，拖到有展品的格位会交换。格位按上排左至右 1–3、下排左至右 4–6 编号；不支持格内任意坐标摆放。拖出有效格位或按 Esc 取消本次拖动。
4. 展开底部“修改铭牌 / 选择格位”，可用带标签的展品与格位下拉框及“移动 / 交换”按钮完成同样操作，支持键盘；工具面板可以收起，避免遮挡拖动区域。
5. 铭牌在显式点击“保存铭牌”后才应用，去除首尾空白，内容不能为空，最多 24 个 Unicode 码点。不会随逐字输入重建场景，也不会修改展品固定名称、样例说明或模型来源。铭牌随展品换位。
6. 点击“完成编辑”退出。普通参观仍采用 `overview → focusing → inspecting → returning`，点击展品取出、旋转缩放、返回和 Esc 的检视语义保留。

`demo/main.ts` 拥有陈列的权威状态。制作预览保存到同源浏览器的 `localStorage` 键 `shiwuguan.demo.arrangement.v1`，记录结构为 `{ version: 1, arrangement: [{ id, slot, plaqueText }] }`；仅在制作入口完成会话校验后读取。普通参观预览不读取或覆盖旧记录，固定使用第 1、2、5 格及本节下方的样例铭牌。读取时校验版本、完整 ID 集合、唯一格位及铭牌；无效记录会明确提示并使用初始陈列，在用户实际修改并保存前不覆盖旧记录。存储失败会提示当前画面已更新但刷新可能丢失。清除站点数据、换浏览器或换源不会共享这些修改。

这只是本地演示编辑：复用现有团队会话核验入口，没有服务器陈列保存、个人归属、物主确认、发布快照或多人同步；不据此视为方案 B 身份隔离已完成。正式工作台写接口继续自行鉴权。“分享参观”和“音画设置”继续保持未接入状态。编辑文本按文本绘制，不解释 HTML。

### 视觉调整（2026-10-24）

普通预览固定为左上相机、中上磁带、中下车票，其余三格保留微弱虚线摆放框且不显示铭牌。样例铭牌为“海鸥双反相机 · 约 1980 年代”“手录磁带 · 1996 年夏”“旧车票 · 2003 年冬”。这些名称与年代仅是用户指定的视觉样例；当前相机仍沿用原 CC0 占位资产，检视说明保留型号差异，不作为藏品事实。按本次用户补充要求，三件样例尺寸、GLB 与统一比例保持不变。

移除台面的人为亮斑、镜面反射层及格位黄色铜线；背景采用共用的本地暖暗展厅与连续台面底图，保留粗糙接收平面和柔和接触阴影，来源与完整生成提示见 [环境素材说明](assets/GALLERY_SOURCE.md)。玻璃内衬改为低透明度中性暖色反光。铭牌与横梁共用稳定格位中心，增加纵向黄铜渐变和深色文字。顶栏标题采用 32px 暖白衬线，底部 13px 引导在 `inspecting` 平滑淡出。键盘聚焦时显示展品选择按钮；图形故障时保留可见入口。正式参观页共用场景与环境样式，内容仍来自发布快照。

### 原型验证记录（2026-10-24）

已完成 strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 类型检查，35 项测试及生产构建；测试覆盖四态检视、统一米制比例、陈列唯一性、移动/互换、铭牌校验及旧有视差约束。生产主包约 695 kB / gzip 181 kB，仍有大于 500 kB 的既有包体提示。GLB 的构建统计见 `assets/model-source/build-report.json`，离线容器与纹理解码检查入口见 `assets/MODELS_SOURCE.md`。

本次浏览器已实际验证：拖向空格移动、占用格互换、拖出柜外取消；在新格位取出、旋转和放回；检视中点击编辑后先放回；键盘替代表单换位、空白与 25 字符铭牌被拒绝且输入保留；刷新后恢复布局和铭牌。1600×900 与 390×844 视口下陈列工具可操作。WebGL 中断后显示错误、重试及目录入口，恢复后三件模型、纹理及柜体正常；QA 控制台 error/warn 为空，静止一秒新 RAF 调度与执行均为 0。

对应本机证据目录为 `~/.local/share/codex-previews/heikesong-a/full-models-20261023/`，包含 `editor-final.png`、`editor-narrow.png`、`cassette-inspection-front.png`、`cassette-inspection-back.png`、`ticket-inspection-front.png`、`ticket-inspection-back.png` 与 `context-restored.png`。这是本机浏览器证据；真实手机 / Safari、完整应用部署、正式音频与发布链路尚未验证或接入。

## 运行与接入

在仓库根目录运行：

```sh
pnpm dev:scene
pnpm test:scene
pnpm build:scene
```

预览地址 `http://127.0.0.1:17681/`，构建产物为 `dist/scene/`。完整工具链与验证入口见 [运行说明](../../../docs/运行说明.md)。旧版本精修日志可查 Git；本页只保留当前接口、行为和验证边界。

原型浏览器结果不替代正式参观页验收。正式页面的本机检视、PNG 实拍、WAV 播放、快速切换、Esc 返回、390px 窄屏、模型失败及 WebGL 中断与恢复已使用合成内容验证；证据见 [验收清单](../../../docs/11-验收清单.md)。真实手机 / Safari、目标设备性能、完整应用部署与浏览器往返缓存实机命中仍未验收。当前资产的来源与许可见 [来源清单](assets/SOURCES.md)，不得因精简开发日志而删除许可记录。
