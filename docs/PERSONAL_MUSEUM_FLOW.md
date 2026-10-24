# 个人展馆与建模接口准备

2026-10-24 用户确认本轮完整实施，并授权推送与提交主仓库 PR。以下描述本分支实现范围，经草稿 [PR #9](https://github.com/kumu314/Museum-of-Old-Objects-and-Memories/pull/9) 交付，验收结果见验收清单；不表示已合并或部署。

## 入口与内容

首页收藏按钮统一进入 `/studio`，由服务端处理已登录与未登录用户，保留首页视觉。

- 每个账号只允许一座未删除展馆，由数据库部分唯一索引和服务端事务共同约束。重复或并发创建返回 `409 MUSEUM_EXISTS`，不覆盖原馆。删除为软删除，可重新建馆，历史快照和素材不物理清除。
- 登录、注册统一进入 `/studio`，忽略 `next`。服务端判断本人的有效展馆：没有展馆时显示工作台的馆名设置；有馆无展品时进入 `/studio/[id]`；已有至少一件保存的展品时进入 `/museum`。是否首次登录、是否发布、是否来自参观链接均不参与分流。
- `/museum` 是仅本人可见的当前草稿预览，顶部提供“进入工作台”。页面和素材按会话及本人归属授权，未发布展品也能预览。页面只序列化展示字段，不传原始讲述、确认记录、建模输入。
- `/share/[token]` 仍需有效登录和当前链接，只读不可变发布快照。未登录先到 `/login`；登录进入自己的展馆后，可再次打开原参观链接。不自动返回参观链接是本轮明确选择。
- 每页六格，翻页控件在柜格下方。全局 `slotIndex` 从零递增，页号为 `floor(slotIndex / 6)`，当前场景只接收该页局部的 0–5 格。每次只挂载一个 Canvas；翻页不会创建展品，保存才会收录，切换前处理未保存输入。
- 每件旧物独立保存名称、讲述、录音文字、展签和素材。全馆简介是独立的 `museum.description`，在工作台顶部编辑，在本人及参观页馆名下展示；不把单件展签自动汇总或覆盖为全馆简介。
- 发布涵盖全馆名称、简介和所有页的展品；全部当前展品须确认，照片平面须关联实拍。修改简介或旧物草稿不会改变旧分享快照，需明确重新发布。

## 迁移与兼容

上游 main 已合入不同的 `0003_user_ownership.sql` 与 `0004_login_attempt_scope.sql`。以下迁移说明只适用于本分支，不能直接叠加到最新 main；合入前须先协调两套已应用迁移及认证实现，重新执行升级与权限回归。PR 保持草稿，不通过重写历史迁移或清库消除差异。

执行既有 `pnpm db:migrate` 和 `pnpm db:migrate:test` 应用连续迁移 `0004_personal_museum_pages.sql`。迁移增加每账号一个有效展馆索引、将格位改为非负 PostgreSQL integer，并增加私有 `model_input`。

旧展品按单图空准备初始化，不改变旧照片、讲述、展签或已发布快照。更新接口采用完整白名单，新增必填 `modelInput`，旧客户端须随本轮一起更新；缺省会拒绝而不会静默清空已保存的建模照片。

如果旧库有某账号多座有效展馆，迁移会报错并整体回滚。先备份数据库和配套素材，由馆主明确选择内容保留/归属处理；不要直接清库或自动软删。可只读检查：

```sql
SELECT created_by, count(*)
FROM museums WHERE deleted_at IS NULL
GROUP BY created_by HAVING count(*) > 1;
```

## 混元两种模式的接入边界

本轮支持选择模式、上传、关联并保存建模准备照片，刷新后恢复。图片经过现有上传校验与脱敏，服务端逐项验证同馆归属和 image 类型。建模输入不自动进入分享快照；展示图仍由 `photoAssetId` 单独指定。

```ts
// 展品保存接口中的私有 modelInput，允许尚未补齐照片。
{ mode: 'single', imageAssetId: string | null }
{ mode: 'multiview', views: {
  front: string | null, back: string | null,
  left: string | null, right: string | null
} }
```

公共契约位于 `src/contracts/model-generation.ts`，预留以下两个 POST 路径（由 `modelGenerationPaths` 提供）。**尚未注册任务提交路由**；这些是接入约定，不能作为已可调用的生成服务。本轮没有任务 ID、进度、生成结果、服务密钥或素材外传，界面按钮禁用并标注“混元 · 尚未接入”。

| 预留路径 | 校验 schema | 照片字段 |
| --- | --- | --- |
| `/api/museums/{museumId}/exhibits/{exhibitId}/model/single` | `singleModelRequestSchema` | `imageAssetId: UUID` |
| `/api/museums/{museumId}/exhibits/{exhibitId}/model/multiview` | `multiviewModelRequestSchema` | `views: { front, back, left, right }`，四个不同素材 UUID |

两者均须带 `expectedVersion`、用于去重的 UUID `requestId`、明确授权 `generationConsent: true`。不接受远程图片地址或本地路径。schema 通过只表示请求结构有效；正式处理器仍须服务端核对身份、展馆/展品/照片归属和当前来源版本。

正式接入由 C/D 实现持久任务、幂等提交、状态查询、结果不明时的核对和资源限制；外部调用在事务外，返回后重新核对来源版本。生成结果需经过 GLB 安全与预算校验，再供预览、明确采纳、确认和发布，不能自动替换当前展示。

模式参考腾讯官方开源实现的 [单图/多视图输入](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/gradio_app.py) 和 [多视图示例](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/examples/shape_gen_multiview.py)，未安装或调用其运行时。开源本地管线的输入能力不代表后续所选云 API 已经具备同样契约，实际供应商接口仍须 D 核实。
