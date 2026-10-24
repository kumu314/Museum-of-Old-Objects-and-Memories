# 方向一已实现 API 与迁移

日期：2026-10-24。当前分支基于 `3a6010d`。本文件记录可在本地运行的服务端实现；未提交、合入或部署。

## 开放范围

复用现有登录会话、同源校验、错误包装和 PostgreSQL 事务。发现、公开昵称、关注、收藏、留言及在线自传目前只允许 `direction1_demo_accounts` 中的有效演示账号使用；展馆进入发现还要求馆主在名单中、账号有效、明确填写昵称、模式为 `discoverable`，并有当前封存快照。名单初始为空，由隔离测试夹具登记合成账号，没有用户自报标志或客户端登记接口，`member` 角色不授予演示权限。

普通馆主仍可管理自己展馆的私密/链接状态和标签。已有链接分享保持“有效账号登录后持有效链接访问”；链接馆不进入目录、搜索或关注列表。真实公开互动不开放。`/world` 目前仍是浏览器内虚构角色演示，没有连接下表的多人持久化 API；不能把页面里的角色切换用作真实服务端身份。

## 请求与响应

响应沿用 `{ data }` / `{ error }`，可撤销内容及错误返回 `private, no-store` 与 `nosniff`。所有写入需要现有同源条件及有效会话，账号、作者与馆主从服务端会话和归属关系决定，严格 schema 拒绝多余正文属性。

新增写入携带 UUID `operationId`；涉及版本的操作还携带 `expectedVersion`。数据库回执跨进程去重，相同操作 ID 携带不同内容返回 `409 IDEMPOTENCY_CONFLICT`；同一请求重放不再次执行，返回当前有权读取的投影。创建留言重放保持同一 ID；若之后该内容已隐藏或入口失效，拒绝读取，不恢复原文或重复创建。回执只保存标识、请求散列和必要的结果 ID，不保存原文或 token。

`expectedVersion` 属于具体修改对象：标签和访问方式使用展馆版本；留言管理/删除使用留言版本；留言设置使用独立的设置版本；昵称使用资料版本。冲突统一 `409 VERSION_CONFLICT`，不自动覆盖或盲目重试。

| 路径 | 方法 | 已实现行为 |
| --- | --- | --- |
| `/api/profile` | GET / PATCH | 本人的公开资料，未填写返回 null；首次 PATCH 使用 expectedVersion=1，之后使用实际资料版本。不自动使用登录名 |
| `/api/museums/:museumId/access` | GET / PATCH | 馆主读取/设置三态访问；开放前必须有有效快照；公开发现额外检查演示资格及昵称 |
| `/api/museums/:museumId/tags` | GET / PATCH | 馆主标签；完整替换明确数组，空数组清空；增加馆版本，发布后才更新发现 |
| `/api/discovery` | GET | query、cursor、limit（默认 20，最多 50）；仅搜索发布的昵称、馆名、展品名、标签；通配符作为文字处理 |
| `/api/discovery/:museumId/:accessEpoch` | GET | 当前有权发现的展馆展示数据，排除原始讲述、内部草稿与 token |
| 上一路径 + `/assets/:assetId` | GET | 仅当前快照的素材集合；复用已处理图片、缩略图、音频与响应边界 |
| `/api/following` | GET | 仅本人关注列表，query/cursor/limit 同目录；隐藏当前不可发现的馆，不能请求他人列表 |
| `/api/following/:userId` | PUT / DELETE | 关注/取消账号；禁止自关注；安全重复操作；取消关注不暴露目标私人资料 |
| 发现详情路径 + `/favorite` | PUT / DELETE | 收藏/取消本馆，仅返回总数与本人状态；禁止自收藏，没有收藏者身份查询接口 |
| 发现详情路径 + `/comments` | GET / POST | 分页公开留言及新建根留言/回复；正文最多 2000 字，作者必须有明确公开昵称；POST 的 accessEpoch 必须与路径相同 |
| `/api/museums/:museumId/comments` | GET | 馆主分页管理视图，可见隐藏状态；访客不能读取该管理视图 |
| 上一路径 + `/:commentId` | DELETE | 作者清除自己的正文，保留回复及占位；馆变私密后仍可删除自己的历史发言，不返回该馆私密内容 |
| 上一路径 + `/:commentId/moderation` | PATCH | 仅馆主 hide / restore；隐藏根留言隐藏整条线程，恢复不复活已删除正文 |
| `/api/museums/:museumId/comment-settings` | GET / PATCH | 仅馆主读取/修改新增留言开关，初始 open；关闭不剥夺阅读和作者删除权 |
| `/api/museums/:museumId/comment-bans` | PUT / DELETE | 仅馆主通过本馆 targetCommentId 定位发言者后禁评/解除，不接受任意账号搜索；禁评仍可参观 |

留言列表支持 cursor/limit（默认 50，最多 100）；返回 `nextCursor`，管理和访客游标不能互用。目录游标绑定搜索条件及列表种类；留言游标绑定馆和入口版本。游标只承载经 schema 校验的分页数据，不是授权凭据。

公开留言只有 visible / deleted；管理视图额外有 hidden / hidden_deleted，后一状态表示正文已删但隐藏仍生效。作者删除已被隐藏的根留言不能重开线程，馆主恢复也不能恢复已删正文。回复受同馆外键及根线程约束，不支持编辑正文。

## 发布与链接兼容

- `POST /api/museums/:museumId/publish` 只生成/切换不可变快照，返回的 `token` 恒为 null；新馆保持 private。已有开放访问保持相应方式，改用新快照时更新 accessEpoch；同一快照重复发布不再次变更 epoch。
- `POST /api/museums/:museumId/share` 明确开启持链接访问或换链，返回新 token；私密馆变 link_only，已有公开发现馆保持 discoverable。换链使旧 token 和旧 epoch 失效。
- `DELETE /api/museums/:museumId/share` 关闭两种外部入口并设为 private；再次发布不会自动重开。
- PATCH access 不返回秘密链接；从私密开放后需要参观链接时，另行调用现有 POST share 获取。工作台现有“开启持链接访问”直接执行该明确操作。公开发现选择与公开昵称/标签编辑尚未接入工作台。
- 旧 publish 客户端不得继续把非空 token 当发布成功条件。上述接口仍沿用原有 expectedVersion；开链或换链重复发送旧版本会返回冲突，不自动再生成链接。

## 迁移与运行边界

`0013_museum_access.sql` 以 access_mode 为权威，保留 share_enabled 为受触发器约束的兼容投影。原有效分享转 link_only，其他馆保持 private，零自动公开；旧 token 的哈希与快照不变。私密时清除 token/epoch，公开时必须有封存的当前本馆快照。旧二进制只写 share_enabled 会失败，不能混用旧服务写入器。

`0014_discovery_directory.sql` 增加空的演示名单、主动填写的昵称、关注、收藏、馆/快照标签和无正文回执。`0015_museum_comments.sql` 增加留言、根线程约束、设置、禁评及回执结果标识。`0016_memoir_records.sql` 增加在线自传与可删除的独立章节发布记录。旧迁移未重写。

迁移只在本机新建的隔离 PostgreSQL 18 集群中运行；未操作原开发库或生产库。实际部署前仍需按项目手册准备配套备份、恢复验证、迁移顺序和应用切换。不能在旧代码与新代码混跑时迁移该访问模型。

同步 main `3a6010d` 后保留其 0006/0007 建模迁移，将本轮未提交的方向一迁移顺延至 0008—0011。此前应用旧方向一 0006—0009 的隔离库和源码备份均保留，联合验证另建新库；不能把新编号直接用于旧分支账本，也不能修改账本或清库迁就源码。

访问撤销目前保留既有关注/收藏关系，不自动清理；不暴露私密馆计数。恢复访问后的关系和计数最终保留策略仍待产品确认。此处没有新增排行榜、举报后台、支付或管理员业务。

## 在线自传 API

所有自传入口检查有效会话、服务端演示名单及自传归属；关联展馆也须归本人。客户端不能指定 owner、确认人或生成结果。`GET /api/memoirs/:memoirId` 返回 `{ memoir, sourceVersion }`，而不是原始数据库行。下表路径均已实现；页面 `/memoir` 仍使用独立本地 DEMO，尚未连接这些接口。

| 路径 | 方法 | 行为与版本 |
| --- | --- | --- |
| `/api/memoirs` | GET / POST | 本人分页列表；创建含 operationId/title/museumId，返回服务端 ID；重复创建请求保持 ID，删除后重放返回不可访问 |
| `/api/memoirs/:memoirId` | GET / DELETE | 本人容器及来源版本；删除须当前自传 expectedVersion 和 confirmOnlineDeletion=true |
| 上一路径 + `/sessions` | GET / POST | 已有访谈；创建选 childhood/school/work/legacy，使用自传版本。开场是原创静态问题，不是实时 AI，不扣费 |
| 上一路径 + `/sessions/:sessionId` | GET / PATCH | 读取原会话；pause/resume/next/skip/refuse/complete 使用会话版本；next 结束当前题，下一题另行明确选择 |
| 会话路径 + `/questions` | GET | 本会话问题分页；恢复读取已有问题，不重新生成 |
| 会话路径 + `/answers` | POST | 保存当前题或主动修订已有回答，使用会话版本；questionId 与 answerId 必须匹配；追加修订，不覆盖旧原文 |
| 自传路径 + `/answers` | GET | 本自传回答全部修订的分页；保留空格、换行、不确定表达和 Unicode 码点 |
| 自传路径 + `/supplements` | POST | 主动补充或修订补充资料，使用自传版本，answerId=null 创建；与访谈回答类别分开 |
| 自传路径 + `/chapters` | GET / POST | 本书章节分页；创建使用自传版本 |
| 自传路径 + `/chapters/:chapterId` | GET / PUT | 章节元数据；保存编辑稿使用章节版本与 expectedSourceVersion，逐段引用本书当前回答修订及有效码点范围 |
| 章节路径 + `/history?kind=...` | GET | draft/revision/confirmation/publication 四类独立历史分页；不会把草稿当编辑或确认版 |
| 章节路径 + `/confirmation` | POST | 使用章节版本、当前 revisionId 和 expectedSourceVersion，要求 reviewedSources=true；无自动确认 |
| 章节路径 + `/publication` | POST / DELETE | 使用章节版本；公开另需当前 confirmationId、privacyAcknowledged=true 和 authorizePublicChapter=true；DELETE 立即撤销本章许可 |
| 自传路径 + `/export?format=...` | GET | markdown/json 附件下载；包含原文及修订、问题、来源、草稿、编辑、确认和许可；本人权限，不依赖 AI 配置或深访额度 |
| 发现详情路径 + `/memoir-chapters` | GET | 当前有权发现的馆中具有有效逐章许可的正文分页；没有许可返回空页，不返回私有目录、来源、草稿或回答 |

分页输入为 cursor（UUID 或缺省）、limit（默认 50，最多 100），返回 items/nextCursor，按 ID 稳定排序。访谈最多四个已知话题，无需分页。新增资料可能需要刷新第一页；游标不是权限凭据。来源修订递增 sourceVersion；任何资料或许可写入也更新自传总版本，防止整书删除静默覆盖新写入。章节编辑、确认或许可变化更新章节版本；保存回答与访谈动作更新会话版本。相同操作重放不再写入，历史回执不保证其旧确认仍对当前来源有效。

保存回答不会请求追问；拒绝/跳过/结束的主题不能重新创建或恢复，暂停主题保留问题，切换主题会暂停原活跃会话。主动修订历史回答不会恢复追问。来源或编辑变化后，旧确认不能用于新的公开许可；已授权正文保持独立旧版本，直到撤销或重新授权。

回答请求有 128 KiB 字节上限；章节编辑为 768 KiB，覆盖契约允许的 20000 码点正文、1600 处来源引用及 JSON 转义。超出预算仍返回明确错误，不静默截断。段落与来源关系使用数据库外键；码点区间在 schema、业务与数据库写入边界检查。回答修订、问题、章节内容和确认不允许 UPDATE；发布正文只允许撤销，删书时可清除。

在线删除在同一事务中级联清除会话、问题、回答及修订、章节草稿/编辑、来源、确认与发布正文。墓碑只保留自传 ID、owner ID、删除时间，去重回执只保留散列和标识。旧 ID 不能重新插入；旧创建/保存请求不能恢复内容，旧公开章节入口不再返回正文。不会删除馆内旧物。删除不代表 PostgreSQL 物理页、备份、导出副本或第三方留存已清除；备份期限及恢复后删除重放尚未验收，继续禁止真实资料。

## 尚未接入

在线自传私有读写、导出和删除已通过隔离数据库及 HTTP 验证；持久化 AI 操作、额度/费用编排和刷新/重启恢复仍未实现，DeepSeek 没有真实调用路由。在线草稿结构已存在，目前没有对外创建 AI 草稿的接口。现有两页仍用本地 fixture；在线页面、链接参观的章节入口、真实发现参观与中央书籍集成仍待完成，完整目标尚未验收。
