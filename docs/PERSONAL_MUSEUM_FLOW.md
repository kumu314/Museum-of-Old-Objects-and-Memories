# 个人展馆与建模流程

更新：2026-10-25。个人展馆与单图生成任务已接入；生成模型发布快照已接入（迁移 0017）。四视图仅支持照片准备，完整自助流程、实际手机与生产部署仍待验收；证据按 [验收清单](11-验收清单.md) 的日期及范围判断。

## 入口与内容

首页收藏按钮统一进入 `/studio`，由服务端处理已登录与未登录用户，保留首页视觉。

- 每个账号只允许一座未删除展馆，由数据库部分唯一索引和服务端事务共同约束。重复或并发创建返回 `409 MUSEUM_EXISTS`，不覆盖原馆。删除为软删除，可重新建馆，历史快照和素材不物理清除。
- 普通登录、注册进入 `/studio`；从有效分享链接续访时，使用 main 的严格返回路径校验并优先回到原参观页。服务端判断本人的有效展馆：没有展馆时显示工作台的馆名设置；有馆无展品时进入 `/studio/[id]`；已有至少一件保存的展品时进入 `/museum`。是否首次登录、是否发布不参与本人展馆分流。
- `/museum` 是仅本人可见的当前草稿预览，顶部提供“进入工作台”。页面和素材按会话及本人归属授权，未发布展品也能预览。页面只序列化展示字段，不传原始讲述、确认记录、建模输入。
- `/share/[token]` 仍需有效登录和当前链接，只读不可变发布快照。未登录先到 `/login?next=...`，登录或注册后返回校验通过的原参观链接；外链和任意站内路径不能作为返回目标。
- 每页六格，翻页控件在柜格下方。全局 `slotIndex` 从零递增，页号为 `floor(slotIndex / 6)`，当前场景只接收该页局部的 0–5 格。每次只挂载一个 Canvas；翻页不会创建展品，保存才会收录，切换前处理未保存输入。
- 每件旧物独立保存名称、讲述、录音文字、展签和素材。全馆简介是独立的 `museum.description`，在工作台顶部编辑，在本人及参观页馆名下展示；不把单件展签自动汇总或覆盖为全馆简介。
- 发布涵盖全馆名称、简介和所有页的展品；全部当前展品须确认，照片平面须关联实拍。修改简介或旧物草稿不会改变旧分享快照，需明确重新发布。

## 迁移与兼容

本次合流保留 main 的 `0003_user_ownership.sql` 与 `0004_login_attempt_scope.sql`、`team_members`/`team_sessions`、复合节流及注册开关；个人展馆迁移接续为 0005。未改写 main 已应用迁移。早期 PR #9 在队员机器应用的 0003 表改名及 0004 个人展馆历史与 main 不同，旧分支数据库会被迁移器拒绝直接叠加；须先备份并另行协调数据迁移，不能改迁移记录或清库。

执行既有 `pnpm db:migrate` 和 `pnpm db:migrate:test` 会应用各自目标库的全部待执行迁移；完整编号见 [迁移说明](../migrations/README.md)。其中 `0005_personal_museum_pages.sql`迁移增加每账号一个有效展馆索引、将格位改为非负 PostgreSQL integer，并增加私有 `model_input`。

旧展品按单图空准备初始化，不改变旧照片、讲述、展签或已发布快照。更新接口采用完整白名单，新增必填 `modelInput`，旧客户端须随本轮一起更新；缺省会拒绝而不会静默清空已保存的建模照片。

如果旧库有某账号多座有效展馆，迁移会报错并整体回滚。先备份数据库和配套素材，由馆主明确选择内容保留/归属处理；不要直接清库或自动软删。可只读检查：

```sql
SELECT created_by, count(*)
FROM museums WHERE deleted_at IS NULL
GROUP BY created_by HAVING count(*) > 1;
```

## 混元两种照片准备模式的接入边界

本轮支持选择模式、上传、关联并保存建模准备照片，刷新后恢复。图片经过现有上传校验与脱敏，服务端逐项验证同馆归属和 image 类型。建模输入不自动进入分享快照；展示图仍由 `photoAssetId` 单独指定。

```ts
// 展品保存接口中的私有 modelInput，允许尚未补齐照片。
{ mode: 'single', imageAssetId: string | null }
{ mode: 'multiview', views: {
  front: string | null, back: string | null,
  left: string | null, right: string | null
} }
```

公共契约位于 `src/contracts/model-generation.ts`，路径由 `modelGenerationPaths` 提供。

| 路径 | 状态 | 请求 |
| --- | --- | --- |
| `POST /api/museums/{museumId}/exhibits/{exhibitId}/model/single` | 已接入单图任务 | `singleModelRequestSchema`，`imageAssetId: UUID` |
| `POST /api/museums/{museumId}/exhibits/{exhibitId}/model/multiview` | 仅预留契约，未接入生成 | `multiviewModelRequestSchema`，四个不同素材 UUID |

请求须带 `expectedVersion`、用于去重的 UUID `requestId`、明确授权 `generationConsent: true`；不接受远程图片地址或本地路径。单图处理器在调用上游前核对身份、展馆/展品/照片归属与来源版本。工作台保存照片后可提交单图生成、读取最新任务及轮询状态；四视图按钮仍不可提交。

持久任务实现请求去重、状态恢复与未知提交保护；外部调用在事务外，返回后重新核对来源版本。结果通过 GLB 安全与预算校验后私有保存：来源版本与单图输入未变、展品未删除时自动入柜，增加展品及展馆版本、使旧确认失效；过期结果保留为候选，不覆盖新内容。幂等采纳接口保留，用户仍须审阅并明确确认、发布。工作台“当前展示方式”可切回照片或内置模型；保存时显式解除当前生成模型引用，增加版本并使确认失效，已发布快照不变。普通编辑不会解除模型引用。迁移 0017 将生成模型纳入不可变快照及授权分享读取。

两套服务端适配器均已接入单图任务：[官方云 API](../src/server/integrations/hunyuan3d/README.md) 面向生产，[concept 网页反代](../src/server/integrations/hunyuan3d-proxy/README.md) 用于演示。2026-10-25 工作区已有一次获准相机示例的云端生成、隔离环境发布读取和桌面检视记录，存在 COS DNS 环境限制；不据此宣布普通用户完整自助流程或手机验收通过。详见验收清单的当日增量记录。

照片准备模式参考腾讯官方开源实现的 [单图/多视图输入](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/gradio_app.py) 和 [多视图示例](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/examples/shape_gen_multiview.py)，应用未安装或调用其运行时。当前适配器提交入口为单图；四视图照片准备和请求 schema 不代表官方云 API 或 concept 已支持该提交方式，实际接入仍须 D 核实并对齐。
