# A：展柜与检视原型

更新于 2026-10-24。本目录与 `../viewer/` 为统一仓库中的独立三维原型。这是可操作的三维原型，尚未接入 C 的公共展示 schema、发布快照或 B 的正式故事与音频面板，不能视为完整产品或 G4 已完成。

## 入口与边界

- `cabinet-stage.ts`：`mountCabinetStage(canvas, items, controller, options)`，一个 Canvas，消费展品 ID、格位和受信任模型键。返回 `retry()`、`retryModel(id)`、`resetView()`、`setEditing(enabled)`、`setArrangement(arrangement)`、`destroy()`；`onSlotDrop(id, targetSlot)` 只上报换位意图，由调用方更新权威陈列数据。
- `../viewer/inspection-controller.ts`：`createInspectionController(ids)`，提供选择、返回、订阅和带 transitionId 的完成通知；旧回调无法完成新动画。
- `model-fit.ts`：完整节点包围盒的最小等比适配与底部中心落点，三轴均保留至少 10%；当前三件米制 GLB 共用 `cabinet-layout.ts` 中的 `MODEL_UNITS_PER_METRE=14.18`，不再逐件按柜格宽度放大。
- `cabinet-arrangement.ts`：演示陈列条目的校验、六格移动/互换和铭牌文字修改；每件展品恰好出现一次，格位为互不重复的整数 0–5。
- `model-manifest.ts`：固定模型键及来源、版本、许可和近似程度；不接受用户输入的模型 URL。
- `demo/index.html`、`demo/main.ts`、`demo/style.css`：可移植的演示页面源文件。通过根目录 Vite 配置与锁文件运行。
- `demo/qa.html`、`demo/qa.ts`：单独检查台，支持视口、WebGL 中断、减少动态 fixture、合成悬停和静止一秒 RAF 计数；不是参观页面的操作入口。

接入时在客户端挂载场景，并在对应生命周期调用 `destroy()`。调用方必须先按公共契约校验数据。`inspectionInset()` 返回覆盖画布的右侧面板宽度（像素）；窄屏面板在画布下方时返回 0。`onSurfaceStatus` 应显示故障说明、隐藏失效画布并保留图文入口；`onAssetStatus` 提供加载和失败状态。B 从同一个 controller 订阅当前选择，并在切换时停止旧音频，默认不自动播放。

## 当前实现（2026-10-24 三维模型、统一尺寸与陈列编辑）

磁带和旧车票已切换到项目自建的 `assets/cassette.glb`、`assets/ticket.glb`，与相机共用 GLTFLoader 加载、包围盒归一化和原有检视流程。两件使用真实几何、PBR 材质及程序化重绘的 2048×1280 双面颜色纹理；塑料与纸纤维另有法线纹理。磁带包括前后外壳、开孔、卷轴、磁带卷、螺钉与侧缘，车票包括曲面、折痕、卷角及连续纸边。侧背和内部机械仍是示意，不是实物扫描或精确藏品复原。旧参考图片裁切模型不再进入当前运行链路，历史说明见 `assets/REFERENCE_SOURCE.md`；模型统计、来源边界及重建命令见 `assets/MODELS_SOURCE.md`。

三件按米制资产共同比例陈列：`MODEL_UNITS_PER_METRE=14.18`。相机沿用原资产包围盒约 147.34×77.57×88.84 mm；磁带为 100.4×63.8×12 mm；车票建模纸幅为 90×60 mm、纸厚 0.24 mm。车票弯曲并倾斜后包围盒约为 93.20×63.85×12.27 mm，最后一项是整个曲面在深度方向的跨度，不是纸厚。这些是演示样例尺寸约定，并非用户藏品测量；相机型号也仍与参考图的双反不同。

### 编辑操作与保存边界

1. 点击右上角“编辑陈列”。若正在检视，先沿原四态流程放回，回到 `overview` 后才进入独立编辑模式；完成编辑仍留在总览。
2. 将展品拖到六格中的空格会移动，拖到有展品的格位会交换。格位按上排左至右 1–3、下排左至右 4–6 编号；不支持格内任意坐标摆放。拖出有效格位或按 Esc 取消本次拖动。
3. 展开底部“修改铭牌 / 选择格位”，可用带标签的展品与格位下拉框及“移动 / 交换”按钮完成同样操作，支持键盘；工具面板可以收起，避免遮挡拖动区域。
4. 铭牌在显式点击“保存铭牌”后才应用，去除首尾空白，内容不能为空，最多 24 个 Unicode 码点。不会随逐字输入重建场景，也不会修改展品固定名称、样例说明或模型来源。铭牌随展品换位。
5. 点击“完成编辑”退出。普通参观仍采用 `overview → focusing → inspecting → returning`，点击展品取出、旋转缩放、返回和 Esc 的检视语义保留。

`demo/main.ts` 拥有陈列的权威状态，保存到同源浏览器的 `localStorage` 键 `shiwuguan.demo.arrangement.v1`，记录结构为 `{ version: 1, arrangement: [{ id, slot, plaqueText }] }`。初次无记录时使用清单中的展品名称与“年代待考”。读取时校验版本、完整 ID 集合、唯一格位及铭牌；无效记录会明确提示并使用初始陈列，在用户实际修改并保存前不覆盖旧记录。存储失败会提示当前画面已更新但刷新可能丢失。清除站点数据、换浏览器或换源不会共享这些修改。

这只是本地演示编辑：没有服务器保存、团队身份、物主确认、发布快照或多人同步；“分享参观”和“音画设置”继续保持未接入状态。编辑文本按文本绘制，不解释 HTML。

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

原型浏览器结果不替代正式参观页验收。真实手机 / Safari、目标设备性能、正式音频联动、完整应用部署与浏览器往返缓存实机命中仍未验收。当前资产的来源与许可见 [来源清单](assets/SOURCES.md)，不得因精简开发日志而删除许可记录。
