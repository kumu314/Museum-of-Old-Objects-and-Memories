# 方向二共享契约提案

版本：0.1（提案，未批准）
日期：2026年10月24日
提出：方向二实现分支；**唯一 owner 与拍板人：C**（用户 2026-10-24 指定 C 统筹契约）
基线：[方向二规划](DIRECTION_2_TEAMMATE_PLAN.md)、[新增功能总路线](NEW_FEATURES_ROADMAP.md)、[开发书 §9.8](PROJECT_PLAN.md)

**本文件是提案，不是已批准契约。** 在 C 拍板并以契约 PR 合入 schema/迁移之前，方向二不修改 `src/contracts/**`、`src/server/core|db/**`、`migrations/**` 和 API 路由；独立界面工作只用明确标注 DEMO 的 fixture。文中的表、字段、枚举均不存在于当前代码。

## 1. 范围与依赖事实（2026-10-24 审计）

- 已存在可复用：注册登录与同源校验、`museums.created_by` 归属唯一权威、版本乐观锁、确认、sealed 不可变快照与 `snapshot_assets`、可撤销分享 token、错误契约与 no-store 头。
- 不存在：浏览计数、用户地区字段、地图数据与渲染、共同作者/贡献/撤回 schema、"公开可发现"概念（现有分享仅持链接）。
- 跨方向依赖：地图/榜单统计的"公开馆"依赖方向一的可见性契约（私密 / 持链接 / 公开可发现）。该枚举尚不存在、不在任何在途 PR 中；归属需 C 与方向一协调后决定落在哪条 PR。

## 2. 提案 A：可发现性边界

方向二只统计并展示"公开可发现"的展馆；持链接分享（现有 `share_enabled`）不计入地图与榜单。可见性枚举建议由方向一契约定义；在其合入前，方向二仅交付 DEMO fixture 版骨架，不接真实统计。

## 3. 提案 B：累计浏览计数（建议迁移 `0006_museum_view_events.sql`）

| 字段 | 类型与约束 |
| --- | --- |
| id | uuid PK |
| museum_id | uuid NOT NULL REFERENCES museums(id) |
| viewer_id | uuid NOT NULL REFERENCES team_members(id) |
| created_at | timestamptz NOT NULL DEFAULT now() |

- 语义：一次**服务端成功返回参观数据**（当前为 share 读取，将来 discover 读取）写一条事件；请求失败不计数。INSERT-only，不提供更新或删除路径；索引 `(museum_id, created_at)`。
- 聚合口径：`COUNT(*)` 且排除馆主（`viewer_id <> museums.created_by`）；对外字段与文案恒为"浏览**次数**"，不是人数。
- 明确不声称：不声称独立访客、不声称防刷；刷新、预加载、机器人、平台人员查看的计数口径为产品待决策项，未决策前不做去重处理，也不在界面或文档暗示已处理。
- 建议接口：`GET /api/discover/museums/leaderboard`（累计榜，成功 `data.entries[]`：museumId、title、viewCount、regionCity、isDemo）；错误复用既有 NOT_FOUND/UNAUTHORIZED 语义，不新增错误码。原始事件无公开查询端点。

## 4. 提案 C：用户城市级地区（建议同批迁移或顺延 0007）

- `team_members` 增列 `region_city text NULL`，CHECK 限定河南 17 地级市 + 济源：郑州、开封、洛阳、平顶山、安阳、鹤壁、新乡、焦作、濮阳、许昌、漯河、三门峡、南阳、商丘、信阳、周口、驻马店、济源。
- 语义：用户显式设置即同意以**城市级**展示；NULL = 未选择，不参与地图聚合；任何上下文不存储、不返回精确地址或坐标。单字段白名单更新接口，幂等，无需版本号。

## 5. 提案 D：共同作者、贡献与撤回（粒度=展品；迁移编号由 C 分配）

- `exhibit_collaborators`：`(exhibit_id, invitee_id)` 唯一；状态 `pending / accepted / declined / revoked`；记录邀请人与响应时间。重复邀请返回当前状态（幂等、结果确定）。
- `exhibit_contributions`：归属 `(exhibit_id, museum_id)`；贡献者只能写自己的行；`display_consent: private | public-consented`（每位作者对自己的每条贡献独立同意）；`state: draft / confirmed / withdrawn`；带版本字段与撤回时间。
- 不变量：未 `accepted` 且未撤回者不进署名；发布快照只包含 `confirmed + public-consented + 未撤回` 的贡献（复用现有 sealed 快照与触发器机制）；撤回 = 展品版本 +1、旧确认失效、新公开版本不再包含该贡献，馆主物件与他人贡献保留；不存在删除他人贡献的路径；已下载副本不承诺撤回。
- 不实现（待产品）：馆主隐藏他人内容、匿名字段 UI（定稿后才定存储字段）。
- 不做：共同摘要、AI 合并矛盾、无实物故事、共同所有展馆。

## 6. 提案 E：河南地图静态资产

河南省级与市级边界（GeoJSON 或预投影 SVG path）作为静态资产逐文件入库，记录来源链接、许可文本/版本、处理方式。候选数据源的许可未逐项核实前，不得进入发布构建。渲染建议内联 SVG，不新增 npm 依赖，避免修改锁文件。

## 7. 建议 PR 顺序与验收命令

0. 契约 PR（C）：迁移 0006/0007、`src/contracts/discovery.ts`、core 读写与权限；与方向一可见性枚举对齐。
1. 河南地图骨架 + 地区馆数（DEMO 版，方向二分支）。
2. 累计浏览榜 UI（DEMO 版，契约合入后接真实接口）。
3. 共同作者邀请/响应/撤回 UI（依赖 D 合入）。
4. 多人共同记忆并列展示（与方向一参观页 owner 协调挂载点，不双方改同一文件）。

验收命令（均为仓库既有入口）：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:db`、`pnpm db:migrate:test`、`pnpm build`，完整门禁 `pnpm check`；服务端权限行为用双演示账号验证，不依赖前端隐藏按钮。

## 8. DEMO fixture 边界

演示账号用 `pnpm team:create` 在各机隔离数据库创建（demo 前缀）；fixture 落点建议 `src/features/map-board/demo-fixtures/`，必须通过将来同一 schema 校验并带明显 DEMO 标注；fixture 的馆数、浏览次数只用于界面展示，永不混入真实榜单、不作为热度或社会证明。
