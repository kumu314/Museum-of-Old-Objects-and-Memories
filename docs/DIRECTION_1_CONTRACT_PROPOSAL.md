# 方向一：共享契约提案

状态：主要产品选择与唯一契约作者已确认；共享 schema、独立 DEMO、社交后端/访问迁移、在线自传私有读写/确认/许可/导出/删除与服务端协议适配器已实现，待审阅；AI 操作编排和页面在线接入未实现。\
核验日期：2026-10-24。代码基线：`origin/main@3a6010d`。本地分支：`codex/direction1-contract-proposal`。\
本文件只提出可审阅方案，不授予提交、推送、创建 PR、合并、付费调用或部署权限。

已实现范围、验证证据与未执行项见[方向一实现记录](DIRECTION_1_PROGRESS.md)，实际服务端接口见[已实现 API 与迁移](DIRECTION_1_API.md)。下文清单仍包含未实现的自传与集成设计，不因已有 DEMO 自动变成已实现能力。

## 1. 已核验的基础与缺口

已阅读根目录 AGENTS.md v1.1.1、方向一用户规划、新增功能路线、开发书、团队执行方案、实施状态和提交手册。前三份新增规划及开发书的本地修改尚未全部进入 Git；本提案不替它们提交或改写内容。

| 核验项 | 当前事实与证据 | 方向一需要补齐的内容 |
| --- | --- | --- |
| Git | 已从 `2e205c8` 经 `33fe1c6`、`afb41e4` 快进到 `3a6010d`；四份原有规划文档改动保留 | 本提案尚未提交；后续 PR 须由用户另行授权 |
| 已有 PR | 初次查询主仓库全部 13 条 PR 时 #9、#11 已合入、#14 开放；后续拉取主线已包含展柜修复，未发现方向一或新增跨方向契约 PR | 初次 PR 状态是历史记录，不能当作当前状态；其他修复不代表方向一契约已获审阅 |
| 身份与归属 | `src/server/auth/session.ts`、`src/server/core/records.ts`；账号表仍为 `team_members`，馆归属唯一依据为 `museums.created_by` | 不新建用户系统、不用 `role` 或 DEMO 标记授予权限 |
| 分享 | `src/server/core/sharing.ts`、`src/app/share/[token]/page.tsx`；登录、token、当前快照、素材集合检查已存在 | 没有三态访问模式和不依赖分享秘密的发现访问 |
| 展示契约 | `src/contracts/museum.ts` 的严格公开投影排除原始讲述和 AI 草稿 | 没有公开昵称、手动标签、目录、搜索、关注、收藏或留言契约 |
| AI | `src/contracts/ai.ts` 及 `src/server/integrations/ai/**` 是短展签整理；60—120 字、最多两个追问、来源类别仅原始讲述或转写 | 自传需要独立业务 schema，不能扩宽短展签限制来兼容长篇访谈 |
| AI 去重 | `src/server/core/ai.ts` 复用已存草稿，并用进程内 WeakMap 合并并发 | 不能证明重启后防止重复付费；自传调用需要持久化操作记录 |
| 数据库 | 主线为 0001—0007；本对话新增的未提交迁移顺延为 0008—0011，使用新隔离库联合验证 | 合入前再次核对全仓连续编号，不重写旧迁移 |
| 环境 | `.env.local` 被忽略；现有文字 AI 使用 `AI_*`；方向一已新增独立 DeepSeek 适配器和空配置字段，未接入真实路由 | 采用 `DEEPSEEK_API_KEY`，不能覆盖现有展签配置或复制聊天密钥 |

以上表格区分现有基线与新增目标；本轮应用和测试的实际运行结果另见实现记录。首轮范围为 DEMO，真实公开互动、真实用户自传与真实 DeepSeek 调用均未验收。

## 2. 决策记录与剩余建议

2026-10-24 用户已明确采纳第一组产品建议、导出与删除建议，并指定本对话为方向一公共 schema、权限、迁移及 API 的唯一作者，方向二只消费该契约。下表区分已确认规则与剩余建议；未答复的选择不作为生产行为实现。

| 决策 | 建议方案 | 尚需谁确认 |
| --- | --- | --- |
| 新馆默认访问方式 | 私密；发布快照与开放访问分开操作 | 已确认 |
| 旧数据迁移 | 已启用分享的馆保留“持链接访问”，其余保持私密；零自动公开 | 已确认，仍须验证升级兼容性 |
| 发布与访问 | 发布只切换快照；新馆仍私密，另行明确开启链接或发现 | 已确认 |
| 首发公开范围 | 仅 DEMO；真实公开互动暂不开放 | 已确认；举报/管理员平台延期，不得宣称已有处置能力 |
| 关注对象 | 关注账号，收藏展馆，两个关系分开；关注列表仅本人可见 | 已确认 |
| 收藏者名单 | 馆主和其他访客均只看总数，不展示名单；关注列表仅本人可见 | 已确认；不能因有总数就公开身份 |
| 禁评后的访问 | 只禁止本馆留言，仍可参观有权访问的展馆 | 已确认 |
| 留言编辑 | 首版不提供编辑，保留自己删除与馆主管理 | 已确认 |
| 回复结构 | 根留言下一层回复，回复可标明所回应的同一线程发言；作者删除根留言保留回复和删除占位，馆主隐藏根留言隐藏整条线程 | 已确认 |
| 自关注与自收藏 | 首版均禁止 | 已确认 |
| 标签层级 | 首版为馆级手动标签，随发布快照冻结；不自动生成标签 | 已确认 |
| 导出 | Markdown 阅读稿及 JSON 来源包；包含回答与各类章节版本 | 已确认 |
| 删除 | 明确确认后立即清除在线库内该自传资料及公开许可；已导出副本无法撤回 | 已确认；备份期限由部署负责人确认，期限未定前不开放真实资料；供应商留存另行核实 |
| 深访额度 | 本轮无支付；DEMO 配额单独标识，不承诺真实免费次数或价格 | A/C；深访扣额时点和失败结算须独立确认 |
| 模型与数据用途 | 无静默模型默认值；先核对轮换后账号可用模型、价格及第三方处理条件 | A/D；仅允许获授权的合成输入作真实调用验证 |

唯一作者已由用户指定为本对话，范围为方向一公共 schema、权限、迁移和 API；方向二只消费契约。后续关键变更仍需非作者复核，无法安排时按开发书记录单人自查。本次指定不包含提交、推送、PR、合并、付费调用或部署授权。

## 3. 文件边界与提交顺序

原有四份规划文档的已有改动保留。实现优先新增契约、校验过的 DEMO 数据与独立功能目录，不改锁文件，也不触碰方向二或开放的展柜 PR 文件；实际完成范围以第 10 节验证记录为准。

| 后续提交包 | 拟议路径；不表示目录已经存在 | 建议唯一 owner 与门槛 |
| --- | --- | --- |
| 公共契约 | 新增 `src/contracts/discovery.ts`、`social.ts`、`memoir.ts`；增量修改 `index.ts`、`errors.ts`、必要的 `museum.ts` | C；先定产品选项和字段，契约 PR 单独审阅 |
| 权限与数据 | 新增对应 `src/server/core/` 模块、API 路由和连续迁移 | C；复用 records/session/http，不复制归属判断 |
| DEMO 与界面 | 拟新增 `src/features/discovery/**`、`src/features/memoir/**`、`src/app/world/**`、`src/app/memoir/**`，样式局限于各自 CSS module | 方向一；消费审阅后的同一 schema，数据入口运行时校验 |
| DeepSeek 协议 | 拟新增 `src/server/integrations/deepseek/**`，服务端配置及 `.env.example` | D 或明确委托的唯一作者；C 核对编排，无锁文件变更需求 |
| 共享入口与集成 | `src/app/museum/page.tsx`、工作台、`src/features/viewer/**`、根布局、全局样式 | B/C 协调唯一作者；方向二不得同时编辑 |
| 方向二消费 | 地图与榜单只消费同一公开资格判定和目录投影；共同作者另提扩展 | 方向二 owner；不得放宽当前 `museumRecord` 的唯一馆主权限来兼容协作者 |

顺序：确认选择与 owner → 公共契约及 DEMO schema → 独立 DEMO 交互 → 权限、迁移和持久化 → DeepSeek 编排 → 共享入口集成及完整验收。未合入期间按方向一规划使用通过唯一 schema 的 fixture；不得另建兼容公共类型，生产入口不因本地实现自动开放。审阅、提交及合入仍按独立门禁执行。

`src/contracts/**`、`src/server/core/sharing.ts`、`records.ts`、迁移、`.env.example`、工作台、查看器、根配置和全局样式均是潜在冲突文件。开放的 #14 涉及展柜，方向一不触碰其文件。此处没有向方向二或其他成员发送消息，也没有启动子代理。

## 4. 公共字段与边界约定

正式 schema 复用现有 `idSchema`（UUID）、`versionSchema`、`timestampSchema`、Unicode 码点长度校验和统一响应包装 `{ data }` / `{ error }`，类型只从 Zod 推导。请求使用严格对象及明确白名单；未知字段报错。更新不省略必填字段，`null` 只用于明确可清空的引用。

建议预算：昵称 1—80 字，搜索词 0—100 字，馆级标签最多 10 个、各 1—30 字、去重；留言 1—2,000 字；单次回答最多 6,000 字；章节最多 40 段、各最多 1,000 字、总计最多 20,000 字；每次 AI 来源总计最多 12,000 字；列表默认 20、最多 50 条。以上是待审阅的技术预算，不是已确定产品限制，不采用短展签的最小 60 字要求。

保存接口的 JSON 字节预算必须覆盖合法字段及最坏转义长度，不能直接套默认 64 KiB 导致合法长章节保存失败。AI 输出预算可以小于人工章节预算，但必须单独说明，超出时保持草稿而非截断成成功。正文原样保存，不为校验长度静默裁剪或改写不确定表达。

### 4.1 昵称、访问方式与目录

| 对象 | 拟议字段 | 校验与可见性 |
| --- | --- | --- |
| PublicProfile | `userId, nickname, version, updatedAt` | 昵称由本人明确填写；不把登录 username 当公开昵称回填；账号停用后不继续展示 |
| MuseumAccess | `accessMode: private / link_only / discoverable`、`version` | 一个权威枚举；旧 `shareEnabled` 如需保留，仅作为兼容投影，不得独立写入第二状态 |
| 发现访问版本 | `accessEpoch: UUID` | 发布新快照、切换访问模式、换链、停止分享时更新/撤销；与秘密分享 token 分开，不是鉴权凭据 |
| DiscoveryMuseum | `museumId, accessEpoch, owner: {userId,nickname}, title, description, tags, exhibitNames, publishedAt, favoriteCount, isFollowing, isFavorited` | 字段显式投影自当前有效发布内容；不返回私密草稿、账号凭据、分享 token/hash、原始文件名或存储路径 |
| 列表结果 | `items, nextCursor: string或null` | cursor 校验格式、分页条件和搜索上下文；总数若未计算，不伪造为 0 |

公开资格的唯一服务端规则：有效登录 + 展馆未删除 + 馆主账号有效 + `discoverable` + 当前已封存的本馆快照 + 首发范围许可。目录、搜索、详情、素材和方向二地图/榜单共同调用这一规则，不能各写一套过滤器。DEMO 首发范围由服务端确定，不能接受客户端 `isDemo` 自报。

发布与访问拆开：发布只产生/切换确认过的快照，不自动把私密馆变为可访问；开放链接或公开发现必须明确操作且已有有效快照。当前 `publishMuseum` 自动启用分享、`rotateShareToken` 可重开分享，必须由 C 在同一变更中审阅修改，不能只改 UI 或加枚举。

迁移保留旧链接访问能力但不把旧链接收入发现。私密时 token 和发现访问版本失效；`link_only` 从目录与搜索退出，但当前有效链接继续允许登录访客访问；停止分享同时撤销两种外部入口。换链使旧 token 及旧发现访问版本失效；如果仍选择公开发现，目录提供新版本入口，不能承诺公开馆无法再被发现。

发现详情和素材的每个请求检查当前 `accessEpoch` 与快照；不能把馆 ID 当永久访问凭据。页面、数据、错误响应和可撤销素材使用现有 no-store 与 nosniff；不把 token 放进目录，不通过列出私密馆来补齐关注列表。

### 4.2 搜索、关注与收藏

- 搜索只匹配公开昵称、当前发布的馆名、展品名及手动标签；不检索讲述、AI 草稿、自传、私密用户资料或未发布修改。新标签编辑随馆版本更新，经发布后才入搜索；昵称是单独获准公开的个人资料。
- 首版建议复用 PostgreSQL 参数化查询，中文包含匹配；转义 `%`、`_` 与转义字符，不将输入当 SQL、正则或通配指令。只按已批准字段检索，不接外部搜索服务。排序和 cursor 使用稳定的发布时间与 ID，不以草稿更新时间暴露编辑活动。
- 关注建议存 `(followerId, followedUserId, createdAt)`，唯一约束防重复，首版禁止自关注；`PUT` 关注、`DELETE` 取消均可安全重复。公开响应不包含关注者名单。本人关注列表只展示目前可发现的馆；不可见馆不能透出标题、简介或素材。
- 收藏建议存 `(userId, museumId, createdAt)`，与关注不同；总数来自同一持久关系，重复收藏不增加。馆主及访客仅获允许的总数与当前访客自己的收藏状态，不返回收藏者身份；首版禁止自收藏。访问撤销后的计数保留规则仍待确认，不自动清理关系。

### 4.3 留言与回复

| 对象 | 拟议字段 | 约束 |
| --- | --- | --- |
| Comment | `id, museumId, authorId, rootId或null, replyToId或null, body, status, version, createdAt` | 作者只取服务端会话；根留言无 root/replyTo；回复必须指向本馆同一根线程，不能跨馆或成环 |
| 展示状态 | 公开 `visible / deleted`；管理另含 `hidden / hidden_deleted` | 判别联合：删除态无正文；作者删除已隐藏根留言仍保持整线程隐藏，恢复显示不恢复正文 |
| 留言设置 | `museumId, mode: open / closed, version` | 仅馆主可更新；关闭只限制新增与回复，不阻止自己删除或馆主管理 |
| 馆内禁评 | `museumId, userId, createdAt, createdBy` | 仅本馆生效、唯一约束；被禁者是否仍可看馆按第 2 节确认结果实施 |

访客只看可见留言和必要的删除占位；馆主的管理投影可看隐藏项，不能把管理列表通过访客接口返回。作者删除时清除正文，删除根留言后保留有效回复和删除占位；馆主隐藏根留言则隐藏整条线程。这组规则已确认。

新建/回复先检查馆仍公开可访问、留言开启、本人未被本馆禁评、目标线程仍可回复；检查和插入在同一事务中与关闭/禁评/隐藏串行化。作者删除自己留言；馆主可隐藏任意本馆留言、关闭留言和禁评账号，不能冒充作者编辑他人正文。默认不提供编辑接口。

管理禁评可由 `targetCommentId` 定位本馆发言者，避免新增搜索私人账号的接口；不信任客户端指定作者。隐藏/删除携带预期版本；相同操作 ID 重放返回原结果，不因响应丢失重复插入。真实互动未获产品确认时，生产请求必须在服务端拒绝，而不只是隐藏按钮。

## 5. 自传资料、状态与权限

| 实体 | 拟议字段 | 保存与授权 |
| --- | --- | --- |
| Memoir | `id, ownerId, museumId, title, version, createdAt, updatedAt` | owner 为登录本人；关联馆也必须归本人；一个自传容器不赋予任何馆编辑权 |
| InterviewSession | `id, memoirId, topicId, state: active / paused / completed, currentQuestionId或null, version` | 默认私有；续接读取已有问题、话题与答案，不新建一份访谈 |
| TopicDecision | `sessionId, topicId, disposition: open / skipped / refused / completed` | 明确拒绝后不自动再次排入追问；恢复会话不解除拒绝 |
| Question | `id, sessionId, topicId, kind: opening / followup, text, basedOnAnswerRevisionIds, createdAt` | 开场可用原创静态问题；后续每轮 AI 输出零或一个问题，不把多个问句塞成一项通过验证 |
| AnswerRevision | `id, answerId, sessionId, questionId或null, revision, kind: interview / user_supplement, text, createdAt` | 原始回答不被 AI 或修改稿覆盖；修正追加新版本，补充资料明确标为用户补充 |
| SourceRef | `answerRevisionId, start, end` | 只允许本自传中本次选中的用户回答版本；码点偏移，满足 `0 <= start < end <= 原文长度` |
| ChapterDraft | `id, memoirId, chapterId, sourceVersion, paragraphs, aiOperationId, createdAt` | AI 草稿独立保存，禁止生成完成后自动采纳、确认或授权 |
| ChapterRevision | `id, chapterId, version, title, paragraphs, derivedFromDraftId或null, createdAt` | 用户编辑版本独立保存；每段保留来源/作者类别，不能默默继承已不支持新文本的引用 |
| ChapterConfirmation | `id, chapterId, revisionId, confirmedBy, confirmedAt` | 明确操作，只确认当前编辑版和已核对来源；编辑或来源修订使当前确认失效 |
| ChapterPublication | `id, chapterId, confirmedRevisionId, consentVersion, privacyAcknowledgedAt, grantedAt, revokedAt或null` | 逐章独立授权；快照冻结正文，默认不存在公开许可；公开投影不含原始回答或内部来源文本 |

AI 段落必须有至少一条有效来源，每条指向本次允许发送的回答版本；用户新增事实应经明确“保存为补充回答”操作记录后引用。用户改写段落时显示原文和来源，要求重新核对；不借“来源有效”宣称文字事实已被机器证明。冲突回答并列保留，不以较晚回答自动覆盖较早版本，不推算出生年或补全人物感受。

访谈动作分开表达：保存回答、请求一个追问、记录当前回答并下一题、跳过、拒绝该话题、暂停、恢复。保存、跳过、拒绝和暂停本身不触发收费请求。用户可在额度不足时继续保存、人工编辑、查看、导出和删除；停止深访服务不能把资料 API 一起关闭。

允许讨论敏感经历，但问题与整理不进行心理诊断、治疗、情绪归因或推算经历；退出/跳过选项始终可达，明确拒绝后不换一种问法继续施压。第三方传输同意与章节公开同意分别记录，不用勾选公开来推定允许发送给供应商。

暂停/拒绝/来源修订递增会话或来源版本；正在返回的旧 AI 问题不得把会话重新激活或追问已拒绝内容。用户未保存的输入由界面保留，身份失效、冲突、网络失败时不覆盖输入，也不误称“已保存”。恢复由服务端状态决定，不靠组件挂载时创建新任务。

章节编辑不自动改变已经发布的正文；当前确认会失效，重新公开须重新确认并授权。用户可以立即撤销单章授权。公开馆不等于公开自传，馆内书籍入口只显示有当前有效许可的章节，不能返回私有目录、摘要、草稿或回答。

自传公开正文不能写入现有禁止删除的通用展馆快照：本需求要求删除平台内对应自传资料，而 `published_snapshots` 禁止删除。建议使用独立章节发布表和动态授权入口，馆快照只允许不含私密文字的关联引用；删除自传时清理所有章节发布正文，旧馆快照不能保留可读副本。具体迁移和删除机制须由 C/D 审阅。

在线删除在事务中撤销许可并清除会话、问题、回答版本、草稿、编辑/确认/发布版本、来源关联和包含文本的操作数据；不影响馆内旧物。删除后到达的 AI 回包不得重建容器。去重/删除审计仅保留无正文的必要标识。备份中残留、恢复后的再删除、供应商留存不能因在线删除成功就称为已清除；未定策略前只用合成资料。

导出仅本人可访问，不要求访谈额度；包含原始回答及修订、AI 草稿、用户编辑版、已确认章节与来源关系，分别标明来源，不能混成一个“已确认版本”。已确认格式为 Markdown 和 JSON。真实导出在受控服务端完成，返回 no-store 下载，不落到 public；DEMO 的浏览器下载只包含明确标识的合成资料。书籍阅读版式和 3D 入口另由 B/A 协调。

## 6. 拟议 API 清单

以下为完整目标的设计清单，包含尚未实现的接口；已实现社交接口的实际路径与行为以[API 记录](DIRECTION_1_API.md)为准。所有接口复用登录会话；所有写入复用现有同源检查。正常读写返回 200，首次创建资源返回 201；错误统一现有结构，删除返回 `{ data: { ok: true } }`。`expectedVersion` 指路径目标资源的当前版本；生成/采纳另显式核对来源版本，不把会话版本、章节版本与馆版本混用。

| 路径与方法 | 主要输入 / 返回 | 服务端权限 |
| --- | --- | --- |
| `GET/PUT /api/profile` | 本人昵称；更新携带 `nickname, expectedVersion` | 本人，不返回登录凭据 |
| `PUT /api/museums/:id/access` | `accessMode, expectedVersion, operationId` → 更新后访问设置 | 唯一馆主；检查当前快照；不接受客户端 token |
| `GET /api/discovery` | `q, cursor, limit` → 目录分页 | 登录且仅合格公开馆 |
| `GET /api/discovery/museums/:id/:epoch` | 公开馆数据 | 登录、公开资格、当前 epoch/快照 |
| `GET /api/discovery/museums/:id/:epoch/assets/:assetId` | 授权媒体流 | 同上且资产属于当前快照 |
| `GET /api/following` | 本人关注列表的公开投影 | 只能查自己，不接收任意 followerId |
| `PUT/DELETE /api/following/:userId` | 关注 / 取消 → 当前关系 | 来源账号取会话；目标必须满足审阅后的公开规则 |
| `PUT/DELETE /api/discovery/museums/:id/:epoch/favorite` | 收藏 / 取消 → 本人状态和允许总数 | 登录、当前公开资格；不返回他人身份 |
| `GET/POST /api/discovery/museums/:id/:epoch/comments` | 列表；新增 `body, rootId, replyToId, operationId` | 公开资格；新增另查开关、禁评及线程 |
| `DELETE /api/comments/:id` | `expectedVersion, operationId` → 删除占位 | 作者本人；先授权，避免探测私密馆留言 |
| `GET /api/museums/:id/comments/manage` | 本馆管理投影分页 | 馆主 |
| `POST /api/museums/:id/comments/:commentId/hide` | `expectedVersion, operationId` → 隐藏状态 | 馆主且留言确属本馆 |
| `PUT /api/museums/:id/comments/settings` | `mode, expectedVersion, operationId` | 馆主 |
| `PUT/DELETE /api/museums/:id/comments/bans/:targetCommentId` | 禁评 / 解除，`expectedVersion, operationId` | 馆主；由本馆留言定位账号 |
| `GET/POST /api/memoirs` | 本人自传 / 创建 | 本人；创建 operationId 去重，不能指定他人 owner |
| `GET/DELETE /api/memoirs/:id` | 详情 / 全部在线删除；删除含 `expectedVersion, operationId` | 本人；删除需明确操作，无模型调用 |
| `POST /api/memoirs/:id/sessions` | `topicId, expectedVersion, operationId` | 本人；开始会话不等于已支付或已有深访额度 |
| `GET /api/memoirs/:id/sessions/:sessionId` | 已存状态、当前问题及可分页的回答/话题记录 | 本人；暂停续接不重新生成问题 |
| `POST /api/memoirs/:id/sessions/:sessionId/answers` | `questionId, text, expectedVersion, operationId` → 已存回答版本 | 本人；回答与保存结果先落库 |
| `PUT /api/memoirs/:id/sessions/:sessionId/answers/:answerId` | `text, expectedVersion, operationId` → 新回答版本 | 本人；保留原文，关联草稿/确认标记需重新核验 |
| `POST /api/memoirs/:id/sessions/:sessionId/actions` | `action: next / skip / refuse / pause / resume, expectedVersion, operationId` | 本人；不隐式调用模型，拒绝状态不可被 AI 改写 |
| `POST /api/memoirs/:id/supplements` | `text, expectedVersion, operationId` → 明确标识的用户补充回答 | 本人主动保存，不能由模型输出代建 |
| `POST /api/memoirs/:id/chapters` | `title, expectedVersion, operationId` → 空章节编辑入口 | 本人；创建不等于整理、确认或发布 |
| `POST /api/memoirs/:id/sessions/:sessionId/followup` | `expectedVersion, processingConsentVersion, operationId` → AI 操作 | 本人、话题有效、明确第三方传输同意、深访额度 |
| `POST /api/memoirs/:id/chapters/:chapterId/organize` | `answerRevisionIds, expectedVersion, processingConsentVersion, operationId` → AI 操作 | 本人、来源归属及传输同意；不扣深访额度 |
| `GET /api/memoirs/:id/operations/:operationId` | 持久化操作状态及已保存结果引用 | 本人；刷新只查询，不重提 |
| `PUT /api/memoirs/:id/chapters/:chapterId` | 完整编辑值、来源、`expectedVersion, operationId` | 本人；新编辑版使当前确认失效 |
| `POST /api/memoirs/:id/chapters/:chapterId/confirm` | `revisionId, expectedVersion, operationId` | 本人明确确认；不能由模型输出触发 |
| `PUT/DELETE /api/memoirs/:id/chapters/:chapterId/publication` | 授权 / 撤销；授权含当前确认版和隐私提示版本 | 本人；不能凭馆公开设置代授权 |
| `GET /api/discovery/museums/:id/:epoch/memoir` | 仅获准公开的确认章节 | 登录、当前馆访问、逐章当前许可；不返内部来源 |
| `GET /api/memoirs/:id/export` | 已保存资料下载 | 本人；不检查付费额度 |

旧 `/api/share/:token` 继续只认有效 token、登录和当前快照，不能通过访问设置新增接口绕过撤销。持链接馆是否允许自传阅读、留言和收藏需要产品明确；本提案先把新增公开社交限定为公开可发现馆的 DEMO，不把能力悄悄扩展到其他模式。

## 7. 权限矩阵与错误语义

| 操作 | 匿名 | 登录访客 | 作者本人 | 馆主 | 自传本人 |
| --- | --- | --- | --- | --- | --- |
| 发现/搜索/公开素材 | 拒绝 | 仅当前合格公开内容 | 同访客 | 同访客；草稿走既有本人入口 | 同访客 |
| 查看/修改他人私有馆、自传或草稿 | 拒绝 | 拒绝 | 留言作者不获额外权限 | 馆主不获其他人的自传权限 | 仅自己自传 |
| 新留言/回复 | 拒绝 | 通过开关、禁评和当前访问检查后允许 | 同访客 | 同访客 | 无附加权限 |
| 删除留言 | 拒绝 | 拒绝 | 仅自己留言 | 可隐藏，不能冒充作者删改正文 | 无附加权限 |
| 隐藏、开关、馆内禁评 | 拒绝 | 拒绝 | 无附加权限 | 仅本馆 | 无附加权限 |
| 确认/授权/导出/删除自传 | 拒绝 | 拒绝 | 留言作者身份无关 | 不因馆主身份获他人资料权限 | 仅自己；不依赖付费额度 |

复用：400 `VALIDATION_ERROR`、401 `UNAUTHORIZED`、403 `FORBIDDEN`、404 `NOT_FOUND` / `SHARE_NOT_FOUND`、409 `VERSION_CONFLICT`、413 `PAYLOAD_TOO_LARGE`、502 `AI_UNAVAILABLE`、504 `AI_TIMEOUT`。公开不可见、epoch 失效、跨馆素材等采用一致 404，不能返回“这是私密馆”等存在性细节。所有错误均带现有 requestId，不含用户正文或上游原始响应。

建议新增以下稳定错误码，由 C 在唯一 `errors.ts` 中加入枚举与状态映射，不在路由自造字符串：

| HTTP / 错误码 | 含义与用户后续操作 |
| --- | --- |
| 403 `DEMO_ONLY` | 真实公开互动尚未开放；保留输入，不假装已提交 |
| 403 `COMMENTS_CLOSED` / `COMMENTING_BLOCKED` | 仅在已获准看到该馆后提示关闭或本馆禁评；仍可执行已授权的自己删除 |
| 409 `THREAD_UNAVAILABLE` | 已可见线程变更导致无法回复；保留输入重新选目标 |
| 409 `MEMOIR_NOT_CONFIRMED` | 当前章节未确认；提示审阅该章，不沿用要求展品 ID 的 `NOT_CONFIRMED` 结构 |
| 409 `INTERVIEW_STATE_CONFLICT` | 暂停、跳过或拒绝后不允许继续该问题；刷新实际进度，不自动重提 |
| 409 `IDEMPOTENCY_CONFLICT` | 同 operationId 携带不同请求内容；不能当成已有成功结果 |
| 409 `AI_OUTCOME_UNKNOWN` | 请求可能已计费，不能自动重试；人工核对或明确知情后新建操作 |
| 403 `INTERVIEW_QUOTA_EXHAUSTED` | 停止新的付费深访；保存、章节整理、编辑、导出等不受此码封锁 |
| 429 `RATE_LIMITED` | 临时请求预算限制；不扣深访额度，不自动重复付费调用 |

已有 API 错误结构除展品未确认外不接受 details。若需要章节 ID、重试时间等结构化 details，必须同一契约 PR 扩展判别联合；不能直接把新字段塞进错误响应。

## 8. 持久化、迁移与并发

- C 分配增量迁移：公开资料与访问模式、关注/收藏、留言/禁评、自传与来源/版本、生成操作各按可审阅包拆分，可能分多条连续编号；不按本提案预留编号。每个表、迁移及共享文件只有一个作者。
- 访问模式升级必须同时覆盖 `publishMuseum`、`stopSharing`、`rotateShareToken`、`museumRecord`、公开 schema 及相关路由；现有分享状态与新模式不得成为两个可冲突的权威来源。历史链接不自动公开、历史快照不改写，新公开字段不从私密故事回填。
- 关注、收藏以复合唯一约束去重；留言及回复用同馆复合外键/必要触发器保证归属，不能只在应用里检查后插入。用户外键引用现有账号表。来源引用使用本自传内复合外键，禁止跨用户/跨自传引用。
- 馆访问、发布、关闭留言、禁评与新留言使用一致锁顺序；事务内再次核对资格，避免检查后撤销仍插入。各资源独立版本检查，留言状态不依赖整个展馆版本，禁止增加无必要的冲突。
- 每个写请求先校验身份，且重放结果仍检查资源权限；operationId 关联 actor、操作类型、资源与请求摘要，同键同内容不重复执行、返回当前获准读取的投影，创建操作保持同一资源 ID，同键异内容 409；删除或失权之后重放不能恢复数据或泄露历史正文。
- 自传生成操作建议状态为 `prepared → sending → succeeded / failed / unknown / superseded`。唯一键覆盖 actor、operationId；输入来源与版本先持久化，外部调用在事务外，结果落库前重查归属、删除、话题和来源版本。一个来源上的并发深访只有一个可提交操作。
- 首版建议在有时限的 POST 请求内执行单次调用，完成并保存后返回 200；重复 POST 发现同一活跃操作时返回 202，刷新只 GET 原操作。不能先返回 202 却把工作留给没有运行保证的后台 Promise。若改用独立 worker，必须先交付执行入口、存活观测和重启恢复证据；本提案不假设它已经存在。
- 进程中断留下 sending 时转 unknown，不根据“没有结果”盲目重发；普通 Chat Completions 未证实支持任务查询/幂等，不能承诺重启自动查回结果。超时或网络断开可能已经产生供应商费用，客户端没有自动重试按钮连发，人工核对后才考虑新 operationId。
- 输入已保存后再请求 AI；响应发送失败不能回滚已提交资料或删除已经落库的草稿。额度结算与最终操作状态在事务中去重；供应商成本与用户访谈额度是两个概念，不能宣称超时一定不产生费用。
- 核验旧版 0001—0005 升级、重复迁移、旧链接、旧快照和两用户隔离；新开发/测试数据库均为各自隔离 PostgreSQL。迁移及可能的删除策略上线前准备配套备份恢复，未获授权不操作现有数据库。

## 9. DeepSeek 与参考来源

### 9.1 开源方案核验

已先检索 GitHub，比较 [DeepSeek 官方集成索引](https://github.com/deepseek-ai/awesome-deepseek-integration) 与 [Vercel AI SDK](https://github.com/vercel/ai) 的服务端调用和结构化输出路径。它们能帮助协议接入，不能替代本项目的版本、归属、确认、来源与删除规则。建议优先复用仓库已有 fetch/Zod 适配方式，本轮没有引入 SDK、升级依赖或改锁文件；如后续确需 SDK，由唯一依赖 owner 核验固定版本与许可。

本机 `my-life-memoir/SKILL.md` 已作为方法资料审阅，未执行脚本、未将其作为系统指令，也未复制文本、题库、脚本或模板。未找到许可证文件，不能据此推断可复制再分发。只借鉴单话题、断点续接、段落来源和保留不确定性；不采用批量逼问、推算事实、诊断记忆/情绪、自动翻阅相册或聊天等与本任务不符的方法。

### 9.2 模型、费用与数据用途

2026-10-24 核对 [官方入口说明](https://api-docs.deepseek.com/)、[模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)、[更新记录](https://api-docs.deepseek.com/updates/)。当前列出的 OpenAI 兼容服务地址为 `https://api.deepseek.com`，模型为 `deepseek-flash` 和 `deepseek-v4-pro`。旧 Flash 别名可能重定向，旧 `deepseek-chat` / `deepseek-reasoner` 另有停用公告；“可以使用旧模型”不能推出这些旧名字仍提供原模型。旧 Pro 也不等于价格更低。

当前价格页按每百万 token 列出峰时/非峰时费用：Flash 未命中输入为 0.30/0.15 美元、输出 1.20/0.60 美元；Pro 对应 1.32/0.66、3.96/1.98 美元。此记录只供选择比较，不是锁价承诺；实际调用前重核价格、缓存计费和请求模型，按返回 usage 记录用量，不将请求上限当实际费用。模型选择、单次/日预算和深访额度待 A/D 确认。

另核对 [开放平台服务协议](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html) 与 [隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)。平台内“仅本人可见”不能解释为第三方不处理或不保留输入；敏感自传资料的供应商处理范围、留存/训练设置及删除路径仍需确认。首轮只发合成回答，敏感内容可在本人空间人工保存，不在条件未核实前发送给第三方。

### 9.3 适配器要求

- 密钥只从服务端 `DEEPSEEK_API_KEY` 获取；新增非秘密字段建议为 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。`.env.example` 仅写字段及说明，不读取、复述或保存聊天中出现的疑似密钥；真实有效的暴露密钥须先由持有人轮换。
- 服务地址限定批准的 HTTPS 主机及路径，拒绝凭据、query/hash、非批准端口和重定向；不提供客户端任意上游地址。不把新配置别名写回现有 `AI_API_KEY`，避免改变展签服务。
- 系统规则与 JSON 用户数据分消息；请求只能装入本自传中被用户选择的回答版本、当前主题与必要问题记录，不装入账户资料、展品故事、相册或联系人。不配置工具、检索、浏览、函数调用或发布动作。
- 深访输出是零或一个中性问题；章节输出是有来源的段落数组。严格校验字段、数量、长度、完成原因、总字节与来源范围，拒绝截断、空正文、未知/跨书来源和越界偏移。无有效材料时允许不生成，不凑篇幅。
- 建议明确非流式请求、30 秒超时、64 KiB 响应预算及逐操作输出 token 上限，具体能力参数由 D 按选定模型核验；超时不自动换供应商、不自动再调用。非法响应不伪造 DEMO 成功，用户回答与已存草稿继续可读可编辑。
- 正常日志只含操作 ID、资源 ID、版本、耗时、模型/错误类别和 token 数，不含请求正文、响应全文、密钥、Cookie、完整 token 或路径。先完成无密钥与假上游验证，再在隔离 DEMO 账号下单独验收真实调用。

## 10. DEMO 规范与计划验收

DEMO 账号和所有馆、留言、自传回答均标识为虚构/合成。建议每条公共 fixture 带 `provenance: demo`，每次 AI 草稿另带 `generation: fixture / provider`；页面持续展示“DEMO 演示数据 / 非实时 AI”，不得只在 README 里解释。fixture 从同一公共 schema parse，不能用断言绕过；真实上游失败不能 fallback 成 fixture。fixture 只证明界面和规则，不证明真实调用、数据库权限或上线。

以下是完整目标的计划验收场景，表内状态指服务端完整交付，不等于对应 DEMO 尚未实现。当前 DEMO、假上游和基线检查的实际通过记录见实现记录；不能把它们替代真实权限、持久化或真实 AI 验收。

| 待验收范围 | 应当观察的证据 | 本轮状态 |
| --- | --- | --- |
| 默认与迁移 | 产品确认记录；旧公开状态迁移零自动收录，旧链接按批准规则保留 | 产品已确认；迁移及旧链接数据库测试通过，未迁移原库 |
| 登录与隔离 | 匿名页面/数据/素材拒绝；两账号不能互读私密馆、自传、来源或操作 | 已实现入口的数据库/HTTP/页面保护通过；AI 操作未实现 |
| 发现与搜索 | 四字段逐项命中；未发布修改、私密/链接馆、停用账号和自传文本不被检索 | 数据库及 HTTP 通过；世界页面仍为 fixture |
| 撤销与快照 | 切私密、退出发现、停分享、换链及新发布后旧入口/素材即时检查；下载副本限制说明 | 数据库、HTTP 与工作台实际操作通过 |
| 关注与收藏 | 单向列表、重复请求、取消、总数无身份、非公开对象无资料泄露 | 数据库/HTTP 通过；在线页面待接入 |
| 留言与管理 | 新增/回复、跨馆回复拒绝、自己删除、馆主隐藏/关闭/禁评、其他人越权拒绝 | 数据库/HTTP 通过；在线页面待接入 |
| 并发 | 两标签保存冲突、关闭/禁评与发言并发、重复 POST 与响应丢失重放 | 服务端版本/回执及跨连接去重、禁评重检通过；在线两标签界面待接入 |
| 访谈控制 | 原创主题开场；每轮至多一个追问；继续/下一题/跳过/拒绝/暂停/刷新恢复；旧回包无效 | 静态开场和持久化动作/读取已测；真实追问与过期回包编排未接入 |
| 来源与事实 | 不确定年份、互相矛盾回答、中性问题、注入文本、跨用户来源、逐段回链及人工事实核验 | 原文/修订/同书码点来源通过；适配器假上游通过；真实事实质量未验收 |
| 章节版本 | 原回答/AI 草稿/用户稿/确认稿分存；编辑失效；未确认及未逐章授权不能公开 | 数据库及 HTTP 通过；AI 草稿在线生成与页面接入待完成 |
| 访问与删除 | 馆公开不自动公开自传；仅本人导出；删后原接口/操作回包/公开入口不能读回或复活 | 在线导出/事务删除/旧 ID 防复活及独立公开正文通过；AI 回包、备份和链接章节入口未验收 |
| 额度与故障 | 配额耗尽及服务关闭仍可保存编辑导出；缺钥、超时、非法输出、重启 unknown 不重付费 | DEMO/适配器边界已测；真实额度、持久操作和恢复未实现 |
| DEMO 界面 | 正常、空态、失败、快速切换、键盘、中文输入法、桌面与手机；标记始终可见 | 桌面/手机 DEMO 与焦点已测；真实系统中文输入法及在线界面待验收 |
| 真实 DeepSeek | 轮换后私钥、已批模型/预算/用途、隔离 DEMO 真实请求及来源人工复核 | 环境/决策依赖未满足，未执行 |
| 数据与发布 | 隔离 PostgreSQL 升级/约束/删除/重启恢复；类型、lint、相关单测/HTTP、生产构建 | 0001—0009、约束、在线删除、类型/lint/相关测试/构建通过；AI 重启、备份恢复及部署未验收 |

后续使用仓库实际脚本：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:db`、`pnpm test:http`、`pnpm build`；涉及查看器再加相应场景检查，不机械扩大验证。UI 必须有实际浏览器操作证据，fixture 与假上游的通过结果单列。提 PR 前复查最终 diff、契约/迁移、秘密与 mock 边界；关键变更按开发书 §7.1 落实 D 复核或明确记录单人自查。

## 11. 本提案的评审入口

第 2 节已记录主要产品选择和唯一公共契约作者；剩余问题单独确认。请审阅第 4—8 节接口、权限、版本与迁移影响。建议将契约、权限/数据、社交界面、自传界面和 DeepSeek 分成可单独验证的变更包。当前改动保留在本地，提案审阅不等于提交、推送、PR、数据库变更、付费调用或部署授权。
