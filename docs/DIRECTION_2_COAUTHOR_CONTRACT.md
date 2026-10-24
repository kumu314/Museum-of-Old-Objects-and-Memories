# 方向二 · 共同作者与多人记忆契约（v0.1 · 待评审）

状态：**提案**。本文件只定字段与规则，不含 DDL。实现已落在 `src/contracts/contributors.ts`
与 `src/features/contributors/`（纯函数 + DEMO 界面），**没有任何表**。

唯一 owner：**C**（契约 / 迁移 / 权限 / 发布事务）。其他方向如需改动本契约，先提请求，不自行扩展枚举。

---

## 1. 范围

做：

- 邀请粒度 = **单件展品**（一件实物、一段讲述）
- 邀请的发出、接受、拒绝、收回
- 每位作者对自己那份讲述的**逐份公开同意**
- 作者**撤回**自己的讲述
- 同一实物下**多人独立讲述**并列展示，各自署名与来源

不做（首版明确不做，避免被当成"还没做完"）：

- 共同所有的展馆
- 无实物对应的故事
- 多人共写同一份内容
- 任何形式的合并、摘要、AI 弥合矛盾
- 转让馆主、变更归属（归属仍由 `museums.created_by` + 触发器锁定）

## 2. 规则（服务端必须自己判，不靠前端隐藏）

| # | 规则 | 判定点 |
| --- | --- | --- |
| R1 | 未接受邀请**不能署名** | 邀请状态必须为 `accepted` 才产生该展品的署名权；`pending` / `declined` / `cancelled` 一律不算 |
| R2 | 每位作者**分别同意**自己的内容公开 | 同意是 `contributions.publish_consent`，逐份、逐人；一个人同意不能覆盖另一个人 |
| R3 | 贡献者**只能撤回自己的** | 撤回的 `actor_id` 必须等于 `author_id`；没有"代表他人撤回"的入口 |
| R4 | 撤回后新公开版本**移除该作者内容**，其他人的保留 | 撤回置 `withdrawn_at`，记录不删；发布/分享读取时按此过滤 |
| R5 | 多人讲述**并列保留**，不合并 | 契约层不提供合并函数；公开视图是数组，每条自带来源 |
| R6 | 来源必填 | `source_note` 非空。缺来源的转述无法核验，不接受 |
| R7 | 馆主不需要邀请 | 馆主由 `museums.created_by` 决定，`author_role='owner'`，不受邀请状态影响 |

`off` 的情况一律"不出现在公开视图"，而不是"出现但置灰"。

## 3. 表结构草案（两表，不是三表）

### `contribution_invitations`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `exhibit_id` | uuid NOT NULL FK → `exhibits(id)` | 粒度所在；`ON DELETE RESTRICT` |
| `museum_id` | uuid NOT NULL FK → `museums(id)` | 冗余用于归属校验与索引；须与 `exhibit.museum_id` 一致（触发器校验） |
| `invitee_id` | uuid NOT NULL FK → `team_members(id)` | 被邀请人必须是已存在账号 |
| `invitee_name` | text NOT NULL | 发出时的展示名快照 |
| `status` | text NOT NULL CHECK (IN ('pending','accepted','declined','cancelled')) | |
| `invited_by` | uuid NOT NULL | 发出者，必须是该馆 `created_by` |
| `invited_at` | timestamptz NOT NULL DEFAULT now() | |
| `responded_at` | timestamptz NULL | `pending` 时必须为 NULL |

索引与约束：

- 部分唯一索引 `(exhibit_id, invitee_id) WHERE status IN ('pending','accepted')`：同一展品对同一个人不能同时有两条未了结邀请。
- `responded_at` 一致性由 CHECK 约束保证（与契约里的 refine 同义）。

**为什么 `declined` 与 `cancelled` 分开**：动作主体不同（前者是被邀请人、后者是馆主）。合并会丢掉"谁拒绝的"这个事实，也没有办法在馆主侧区分"对方不愿意"和"我发错了"。

### `contributions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `exhibit_id` | uuid NOT NULL FK → `exhibits(id)` | |
| `author_id` | uuid NOT NULL FK → `team_members(id)` | |
| `author_role` | text NOT NULL CHECK (IN ('owner','coauthor')) | 落库时固定，不随后续角色变化改写 |
| `story` | text NOT NULL CHECK (char_length BETWEEN 1 AND 4000) | |
| `source_note` | text NOT NULL CHECK (char_length BETWEEN 1 AND 200) | |
| `publish_consent` | boolean NOT NULL DEFAULT false | **默认 false**：没有明确同意就不公开 |
| `withdrawn_at` | timestamptz NULL | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

索引：`(exhibit_id, created_at)`、`(author_id)`。

**为什么撤回是列而不是第三张表**：只有作者本人能撤回，`actor_id` 恒等于 `author_id`，单独建表不会带来新信息。若将来需要"撤回后恢复"，再补事件表；届时是新增表，不是改这张表。

**为什么 `publish_consent` 默认 false**：同意必须是被记录下来的肯定动作，不能因为漏点而默认放行。

## 4. 权限矩阵

| 动作 | 馆主 | 已接受邀请者 | 待回应/已拒绝 | 其他登录用户 | 匿名 |
| --- | --- | --- | --- | --- | --- |
| 发邀请 | ✅ 自己馆的展品 | ❌ | ❌ | ❌ | ❌ |
| 收回未回应邀请 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 接受 / 拒绝邀请 | ❌ | — | ✅ 仅自己那条 | ❌ | ❌ |
| 写自己的讲述 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 改自己的公开同意 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 撤回自己的讲述 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 撤回/删除他人讲述 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 读公开版本 | ✅ | ✅ | ✅ 仅已公开部分 | 按可见性（见 D1） | 按可见性（见 D1） |

## 5. 错误语义

| 情况 | HTTP | code | 备注 |
| --- | --- | --- | --- |
| 未登录 | 401 | `UNAUTHORIZED` | 现有约定 |
| 不是该馆展品 / 展品不存在 / 无权访问 | 404 | `NOT_FOUND` | **三者同一响应**，不做区分 |
| 撤回他人内容 | 404 | `NOT_FOUND` | 与"不存在"同响应，否则等于提供存在性探测 |
| 重复撤回 | 409 | `VERSION_CONFLICT` | 或幂等成功；倾向 409，让调用方知道状态已变 |
| 接受一条已被收回的邀请 | 409 | `VERSION_CONFLICT` | |
| 字段非法（来源为空、正文超长） | 400 | `VALIDATION_ERROR` | |

**不新增错误码。** 现有 13 个码够用，加码会让契约层与 `errorHttpStatus` 同步改动，而那个文件正被 PR #15 改着。

## 6. 迁移影响

- 编号：**不预占**。`0006` 在 PR #15 手里，`migrate.ts` 要求连续无缺口，本契约落地时按当时实际最大号 +1（预计 `0007` 起），由 C 在合并当天登记进 `docs/运行说明.md`。
- 本契约只新增两张表，**不改任何已有表**：不改 `museums`、`exhibits`、`team_members`，不动 `created_by` 与归属触发器。
- 回滚：两表均为新增，回滚只需 `DROP TABLE`（先 `contributions` 后 `contribution_invitations`）。

## 7. 与发布 / 分享的关系

`published_snapshots` 封存后不可变，所以"公开版本"里的讲述是**发布那一刻**从 `contributions` 过滤出的结果。

撤回时（与提案 D4 一致）：

1. 置 `contributions.withdrawn_at`
2. 该馆 `version + 1`
3. **停掉当前分享**（`share_enabled = false`）
4. `current_snapshot_id` 保留，供重新发布时对比

即"撤回立即生效"，旧快照不再对外提供。代价是馆主会经历一次被动下架，这是"作者可撤回"的必然成本。

## 8. 未决问题（不擅自补成产品决定）

1. 邀请是否过期？（当前草案：不过期，靠馆主收回）
2. 被拒绝后能否再次邀请？（当前草案：可以，新建一条记录）
3. 同一作者在同一展品能否有多份讲述？（契约允许，产品未定）
4. 撤回后能否重新投稿？（当前草案：不能恢复原记录，只能新建一份）
5. 馆主能否移除共同作者？（当前草案：不能，只有作者自己撤回内容；移除作者需另立契约）

## 9. 验收

已随本次提交跑过的门禁与用例见 PR 描述。规则层的 17 个用例在
`src/features/contributors/model.test.ts`，含"不能撤回别人的""未接受不署名""撤回后移除且他人保留"。
数据库层用例等表落地后补，届时需要 Docker（本机守护进程未启动，当前无法执行 `test:db`）。

### 2026-10-24 PR 复查（单人自查，AI 辅助）

修复邀请只按账号匹配导致跨展品署名的问题：规则按展品和账号同时匹配，状态契约拒绝混入其他展品的记录。公开讲述改按实际时间排序，兼容不同时区及同一时刻的不同表示。

验证：17 个规则用例、TypeScript 检查与本模块 ESLint 均通过；浏览器直接挂载原 DEMO 组件，验证初始 2 条、接受邀请后 3 条、本人撤回后 2 条、另一作者整体撤回后 1 条、刷新恢复 2 条，390px 视口无横向溢出、无浏览器异常。

本轮未验证真实登录页面、数据库或发布事务；组件检查不代表这些尚未接入的协作能力已完成。生产构建及全仓门禁由 PR CI 记录核对。
