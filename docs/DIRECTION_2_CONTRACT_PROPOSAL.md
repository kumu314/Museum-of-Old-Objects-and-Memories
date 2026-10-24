# 方向二共享契约提案

版本：1.1（累计榜与地区已落库）
日期：2026年10月24日 22:30
基线：main `3a6010d`
提出：方向二实现分支；契约 owner：C

**状态说明。** v0.1/v0.2 是提案，本版把待定项定下来。D1–D5 由方向二实现方按"全权委托"拍板，C 可随时推翻；推翻时改本文件并在 PR 里注明，不要只改代码里的口径。

**仍然成立的边界（v1.1 起已部分改变）。** v1.0 时本版不含任何迁移与 schema 变更，界面只消费 DEMO fixture。
`0008_discovery_views.sql` 已把「累计浏览榜 + 地区分布」真正落库，DEMO fixture 随删除，
详见 **§15 落库实现（v1.1）**。仍未落库的是共同作者与多人讲述（`0009` 起，见 §16）。

## 0. 版本变更

v0.1 → v0.2（按代码审计修订）：

| # | v0.1 的说法 | 审计事实 |
| --- | --- | --- |
| 1 | 浏览计数迁移用 `0006` | `0006_model_generation.sql` 已被 **PR #15** 占用，且 `migrate.ts` 强制编号连续无缺口 |
| 2 | 缺"公开可发现"枚举 | 更严重：**没有任何匿名读取路径**，`/api/share/[token]` 与 `/share/[token]` 都要 `requireMember()` |
| 3 | `viewer_id uuid NOT NULL` | 与"公开可发现"自相矛盾：匿名访问没有 user id |

v0.2 → v1.0：D1–D5 定稿（§13），并补本轮已实现范围（§14）。

## 1. 仓库与分支状态

- v1.0 写作时 main = `afb41e4`（PR #14 已合并）；写作当天随后 `#15`/`#16`/`#17` 全部合入，main 到 `3a6010d`。
- 迁移实况（v1.1 实测）：`0001`–`0007` 已在 main（`0006_model_generation.sql`、`0007_generation_submission_safety.sql` 均由 PR #15 带入）。
- 方向二迁移取 `0008`（`0008_discovery_views.sql`），已在本地开发库与隔离测试库实际应用。
- 方向二既有分支：`feat/direction2-discovery-board`（PR #16，已合并）、`feat/direction2-coauthor-contributions`（PR #17，已合并）、`feat/direction2-discovery-persistence`（本分支）。

## 2. 已存在、可复用

| 能力 | 落点 |
| --- | --- |
| 注册/登录/会话/同源校验 | `src/server/auth/session.ts`、`page-user.ts` |
| 展馆归属唯一权威 | `museums.created_by` + 触发器 + `museums_one_active_owner`（0003/0005） |
| 越权即不存在 | `museumRecord(client, actorId, id, lock)` 统一 `NOT_FOUND` |
| 版本乐观锁 / 确认 | `assertVersion`、`exhibits.version` / `confirmed_version` |
| 发布快照（sealed 不可变） | `published_snapshots` + `snapshot_assets` |
| 可撤销分享 | `share_token_hash` + `share_enabled` |
| 错误契约 | `src/contracts/errors.ts`（13 码，含 4xx/5xx 映射） |
| 演示账号 | `pnpm team:create` |

## 3. 不存在（v1.0 时）

浏览计数与统计表、地域字段、地图资产与渲染、共同作者/贡献/撤回、可见性枚举、匿名读取路径。v1.0 的 PR 只加了纯类型契约与界面，没有任何表。

**v1.1 已补齐：** 浏览计数表、`museums.region_city`、聚合查询与上报端点（见 §15）。仍然不存在：共同作者/贡献/撤回的表与端点（§16）、匿名读取路径（D1 不变）。

## 4. 迁移编号（D5 已定）

`src/server/db/migrate.ts` 强制 `Migration sequence must start at 0001 with no gaps`。

**决定：** 方向二不预占编号，也不在 #15 落地前创建迁移文件。契约 PR 合并时若 #15 已合入，按当时实际最大编号加一登记；#15 本轮包含 `0006`、`0007`，不得预占或复用这些编号。编号由 C 在合并当天登记，实现方不自选。

**执行结果（v1.1）：** `#15` 合入后 main 的实际最大编号是 `0007`（`0007_generation_submission_safety.sql`），因此方向二取 `0008`。这与 v1.0 里"最早 0007"的预估不同——预估只能当参考，登记必须以合并当天的实际文件为准。

## 5. 可发现性（D1 已定）

**决定：首版仅登录可见。** 地图页 `/discover` 走 `requirePageUser()`，未登录 307 到 `/login`。

理由：仓库里没有任何匿名只读路径，开一条就等于新增一个"未公开内容可能泄露"的面；而可见性枚举（私密 / 持链接 / 公开可发现）不在任何在途 PR 里，方向二无权定义。等枚举与匿名只读端点由 C 与方向一定好之后，再把 `/discover` 放开，届时只去掉一层门禁，页面与数据路径不用重写。

## 6. 累计浏览计数（D2 已定）

表（编号待 §4 登记）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| museum_id | uuid NOT NULL REFERENCES museums(id) | |
| viewer_id | uuid **NOT NULL** REFERENCES team_members(id) | 见 D2 |
| snapshot_id | uuid NULL REFERENCES published_snapshots(id) | 只统计 sealed 版本的浏览，草稿不计 |
| created_at | timestamptz NOT NULL DEFAULT now() | 索引 `(museum_id, created_at)` |

- 写入点：成功返回参观数据之后（当前为 `readShare`，将来是 discover 读取）。失败 / 404 不写。
- INSERT-only，无更新与删除路径；原始事件不设公开查询端点。
- 聚合 `COUNT(*)` 且排除馆主（`viewer_id <> museums.created_by`）。
- 对外恒称"浏览**次数**"，不是人数。

**D2 决定：`viewer_id NOT NULL`。** "馆主自己的查看不计入"是已定要求，只有能识别身份才做得到。代价是匿名访问不计入，于是口径要写小写准：文案为"浏览次数"，脚注说明"只统计成功读取到展馆内容的访问，排除馆主自己的查看"。

**明确不声称：** 独立访客、防刷、去重。刷新 / 预加载 / 自动化流量的口径仍属未决，未决前不做处理，也不在界面暗示已处理。

## 7. 城市级地区（D3 已定）

**决定：`museums.region_city text NULL`**，CHECK 限定河南 17 个地级市 + 济源，共 18 城。

理由：聚合对象是馆，地图上一个点就是一座馆，语义直接；而 `team_members` 正在"是否改名 `users`"的议题里，把新列挂上去会平白增加迁移冲突面。一账号一活跃馆使"馆的城市"与"人的城市"在实际数据上等价，不需要两列。

- 只存城市，不存地址与坐标；NULL = 未选择，不参与聚合，不按 IP 推断。
- 只有馆主能改自己的 `region_city`；单字段白名单更新，幂等。

## 8. 共同作者、贡献与撤回（D4 已定）

- `exhibit_collaborators`：`(exhibit_id, invitee_id)` 唯一；`pending / accepted / declined / revoked`；记录邀请人与响应时间。重复邀请幂等返回当前状态。
- `exhibit_contributions`：归属 `(exhibit_id, museum_id)`；`display_consent: private | public-consented`；`state: draft / confirmed / withdrawn`；带版本与撤回时间。
- 写入校验：邀请已 `accepted`、`contributor_id = 会话用户`；馆主不能代写他人贡献；贡献者只能改自己的行，没有删除他人的路径。
- 发布快照只含 `confirmed + public-consented + 未撤回`。
- 不做：共同摘要、AI 合并矛盾、无实物故事、共同所有展馆。

**D4 决定：撤回立即失效当前分享，不等馆主重新发布。**

理由："每位作者分别同意自己的内容公开"意味着撤回即撤销同意；馆主不能拿旧同意继续公开。等待期继续公开旧快照，等于撤回没有生效，与"作者撤回后新请求不得读取已撤销内容"直接冲突。

实现口径：撤回事务内 `museums.share_enabled = false`、`version + 1`；`current_snapshot_id` 保留（sealed 快照不删，用于审计与重新发布时对比），馆主重新发布后新快照不含该贡献。其他作者的内容不受影响。已下载副本不承诺撤回，界面要写明。

## 9. 地图资产与合规

**不自绘省界。** 中国地图的边界与行政要素必须来自合规地图服务，本方向不把 GeoJSON 或 SVG 省界入库，也不使用 OSM / Mapbox / 境外瓦片。

- 底图：腾讯位置服务 JavaScript API GL（合规白名单：腾讯、高德、百度、天地图）。
- key 从服务端环境变量 `NEXT_PUBLIC_TMAP_KEY` 读，经页面以 prop 传入客户端组件；**代码里不写任何可用 key**，仓库不提交 `.env.local`。
- 未配置 key、脚本加载失败或超过 15 秒未加载完成时，地图整块降级为文案提示。城市分布列表始终保留，提供馆数、浏览次数和键盘筛选入口，数据与地图同源。
- 城市中心点是近似坐标，只用于省级视图定位气泡，不是行政区划数据，不得用于测距导航。
- 坐标系 GCJ-02（腾讯地图要求）；注意 `LatLng` 是「纬度在前」。
- 本机没有 key，**地图真实渲染未经验证**，只有降级路径与类型检查通过。

## 10. 冲突文件与 owner

| 文件 | 冲突原因 | 处理 |
| --- | --- | --- |
| `src/features/studio/exhibit-editor.tsx` | PR #15 已改；共同作者面板落点 | 等 #15 合并，或新增独立组件只做单行挂载 |
| `src/features/viewer/museum-display.tsx`、`shared-museum.tsx` | 多人并列展示落点，方向一也在改 | 停提案，双方不改同一文件 |
| `src/contracts/errors.ts` | 新增错误码会与 #15 的 `GENERATION_UNAVAILABLE` 撞 | 复用现有 13 码 |
| `src/contracts/index.ts` | 新增契约通常在这里 re-export | 本方向**不改**，消费方直接从 `contracts/discovery` 导入 |
| `migrations/**`、`pnpm-lock.yaml`、`.env.example`、全局样式 | 共享面 | 本方向**未改**；地图不引任何 npm 依赖 |

## 11. 建议 PR 顺序

0. 契约提案（本文件）+ DEMO 界面骨架（当前分支，无迁移）。
1. 契约 PR（C owner）：`museums.region_city`、`museum_view_events`、`/api/discover/*`，等 #15 定编号。
2. 河南地图接真实聚合与 key。
3. 累计榜接真实接口。
4. 共同作者邀请 / 响应 / 撤回。
5. 多人并列展示（与方向一协调挂载点）。

## 12. 验收命令与环境限制

`pnpm typecheck`、`lint`、`test`、`test:db`、`test:scene`、`build`、全量 `pnpm check`。

本机实测（2026-10-24）：
- `typecheck` 通过、`lint` 0 error（6 个既有 `<img>` warning）、`test:scene` 93/93、`build` 19 路由通过。
- 开发库 15432 在监听；本轮无 DB 改动，未跑 `test:db`。
- `pnpm test` 中有 2 例为既知环境失败（ffmpeg 缺 `libwebp_anim`、Windows `symlink` 语义），非本方向引入。

PR 审查修复复验（2026-10-24，Linux 隔离工作树）：
- `typecheck`、发现页相关 ESLint、`build` 通过；发现模块 16/16 测试通过，包含 SDK 超时、失败清理及重试。
- 浏览器直接挂载原 `DiscoverBoard` 组件，验证无 key、拦截 SDK 加载失败两种路径：18 城按钮始终可用；洛阳筛选 2 条、未标注 1 条、全部 9 条；柱条高度及有数据柱条宽度非零。390px 视口无横向溢出、无页面 JavaScript 异常。
- 上述组件检查不替代完整登录流程或真实腾讯地图验收；未配置有效地图 key，真实底图与域名白名单仍未验证。

## 13. 决定汇总

| 编号 | 问题 | 决定 |
| --- | --- | --- |
| D1 | 地图/榜单是否要求登录 | 首版仅登录；匿名要等可见性枚举与匿名只读端点 |
| D2 | `viewer_id` 可空吗 | `NOT NULL`，口径写"登录访客浏览次数" |
| D3 | `region_city` 挂哪张表 | `museums`，避开 `team_members` 改名议题 |
| D4 | 撤回是否立即失效快照 | 立即：停分享 + 版本 +1，重新发布后新快照不含该贡献 |
| D5 | 迁移编号 | 不预占；按当时实际最大编号加一，由 C 登记 |

## 14. 本轮已实现（v1.0 DEMO，历史记录）

| 文件 | 内容 |
| --- | --- |
| `src/contracts/discovery.ts` | 18 城白名单、榜单与地区分布的 zod 契约（含"名次连续""入榜不超总数"约束），纯类型无 DDL |
| `src/features/discover/regions.ts` | 城市聚合与近似中心点；NULL 不计入城市桶，单列计数 |
| `src/features/discover/leaderboard.ts` | 累计榜排序（次数降序 + 确定性平局）、筛选、DEMO 与真实混入即抛错 |
| `src/features/discover/demo-fixtures.ts` | 9 条 DEMO fixture，`isDemo: true` 字面量锁定（**v1.1 已删除**） |
| `src/features/discover/henan-map.tsx` | 腾讯地图 GL JS，无 key / 加载失败均降级为文案 |
| `src/features/discover/city-bars.tsx` | 城市分布，与地图共用同一份聚合结果 |
| `src/features/discover/discover-board.tsx` | 组装、DEMO 横幅、筛选、口径脚注 |
| `src/app/discover/page.tsx` | 登录门禁 + `noindex` + 从环境变量取 key |
| 三个 `*.test.ts` | 16 例，覆盖排序 / 平局 / 筛选 / 聚合 / 白名单 / DEMO 混入 / 地图脚本超时清理与失败后重试 |

v1.0 未做（当时明确不声称）：真实浏览计数、真实聚合接口、匿名访问、共同作者、地图真实渲染、地图 key 的域名白名单验证。

## 15. 落库实现（v1.1）

迁移 `0008_discovery_views.sql`：`museums.region_city`（18 城 CHECK 白名单）+ `museum_view_events`（`museum_id` / `viewer_id` / `created_at`）。
**不存 IP、UA、Referer、设备指纹**：只回答"谁看过哪座馆"。

### 15.1 上榜范围是一条安全边界

只有 **未删除 + 已发布 + 分享开着**（`deleted_at IS NULL AND share_enabled AND current_snapshot_id IS NOT NULL`）的馆进入榜单与地图聚合。

理由不是"好看"，是防泄露：少了「已发布」，馆主还没公开的草稿标题会出现在全站榜单上（浏览数当然是 0，但标题已经出去了）；少了「分享开着」，已下架的馆仍被持续公示。这条口径写在 `src/server/core/discovery.ts` 的 `visibleMuseum` 常量里，只此一处。

### 15.2 浏览口径（D2 的落实）

- 上报走 `POST /api/share/[token]/views`，按 **token** 定位而不是 `museumId`：参观者手里只有 token，让他先换 id 等于把内部主键发给每台看展的机器。
- 只有真能读到内容（token 有效、分享开着、快照已封存）才记；读不到就是 `SHARE_NOT_FOUND`，不记。
- **馆主自查照实入库**，排除发生在聚合侧（`e.viewer_id <> m.created_by`）。事件表记事实，聚合算是口径；混在一处则改口径时要回改历史数据。
- **不去重**：刷新、预加载、自动化的处理仍属未决，未决前如实记录，也未在任何界面或文档里声称防刷、未宣称独立访客。
- 客户端上报只挡 React StrictMode 的双跑（`useRef` 一次性），**不是**统计去重；真实刷新与新标签页各计一次。

### 15.3 地区（D3 的落实）

- `region_city` 挂 `museums`，只到城市一级；白名单同时存在于迁移 CHECK 与 `henanCities`，由 `tests/contracts/region-whitelist.test.ts` 钉住，改一侧忘另一侧 CI 直接红。
- **`region_city` 不进发布快照**：位置是馆的属性，不是某一版内容的属性。改城市不该要求重新发布，旧快照也不该带着过期城市。
- `updateMuseumInputSchema.regionCity` 是 `nullable().optional()`：不传 = 不改，传 `null` = 清空。老客户端整份保存不会把馆主选的市抹掉。

### 15.4 验证结果（本机实跑，不是推断）

- 迁移在本机开发库与隔离测试库实际应用：`Applied migrations: 6, 7, 8`；`\d museum_view_events` 与 `information_schema` 核对通过。
- `pnpm test:db` **56/56**：新增 8 例覆盖"馆主自查不计""未发布不上榜""停止分享立即退榜但事件保留""无效 token 不记""两次读取结果完全一致""未标注城市单列""不传地区不清空 / 传 null 才清空""数据库拒绝白名单外城市名"。
- 端到端（dev server + 真实 HTTP）：未登录 `/discover` 307 → `/login`；登录 200、空态文案正确、HTML 内 **0 处 DEMO**。
- 端到端计数：库内 3 条事件（2 条访客 + 1 条馆主），页面显示 **2 次**，馆主那条被聚合正确排除。
- `updateMuseum` 四条路径实测：设洛阳 → 不带城市保存仍为洛阳 → 非法城市 400 → `null` 清空。
- 共同作者/多人讲述**仍未落库**，见 §16。

### 15.5 删除的东西

`demo-fixtures.ts` 已删除（其注释原本就写着"真实聚合接入后本文件应删除"）；`leaderboard.ts` 的 `toLeaderboard`/`rankEntries`、`regions.ts` 的 `distributeByCity` 一并删除——真实链路的排序与聚合在 SQL，留着重名函数只会让人以为还有两条数据路径。`isDemo` 字段保留在契约里但恒为 `false`，留给将来可能的演示环境。

## 16. 下一步（未做，明确不声称）

1. 共同作者与多人讲述落库：邀请（四状态）、讲述（逐份同意）、撤回（只撤自己的）三张表，最早取 `0009`。规则层与契约已在 PR #17 合入，缺的是表与端点。
2. 匿名只读通道：D1 未变，`/discover` 仍要登录；开放匿名需先定可见性枚举与匿名端点，届时只去掉一层门禁。
3. 地图真实渲染未验证：`NEXT_PUBLIC_TMAP_KEY` 本机未配置，域名白名单仍需确认。
4. 榜单条数上限 200（`leaderboardLimit`）只是防拖垮查询的硬顶，不是产品设计的 Top N 榜；超限时当前界面没有分页提示，属于已知缺口。

