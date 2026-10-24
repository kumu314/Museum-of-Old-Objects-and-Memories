# 自传 DeepSeek 适配器

这是服务端协议模块，尚未接入自传 API、数据库编排或浏览器 DEMO。当前页面不会调用本模块，配置字段也不表示已经开通真实服务。

使用独立的 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_API_KEY`，没有模型或其他 AI 密钥回退。地址只允许官方 HTTPS 主机与根路径或 `/v1`；禁止重定向、任意地址与工具调用。真实凭据仅由持有人在被忽略的本机配置中设置，不能使用聊天中暴露的凭据。

2026-10-24 对照 [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode/) 和 [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) 实现非流式 JSON 输出，显式关闭思考模式，避免依赖服务默认设置。当前配置只接受官方列出的 `deepseek-flash`、`deepseek-v4-pro`，实际选型、费用和用途仍需用户确认；不以本模块代替供应商账号验证。

每次仅发送选中的回答版本 ID、原文和必要的话题/问题上下文；不发送账号、展馆、会话实体、时间戳或来源以外资料。系统规则与用户 JSON 分消息。段落来源按 Unicode 码点校验，追问为零或一个，拒绝原样重复问题。语义重复、事实可靠性和中性程度仍需人工验收，结构验证不能证明这些事项。

传输限时 30 秒、响应最多 64 KiB。追问最多 500 输出 token，章节最多 6000 输出 token，并限制为 12 段、每段最多 1000 码点、合计最多 6000 码点；人工编辑契约仍允许 20000 码点。超过任一预算、截断、未知来源、工具请求、无效 JSON 或缺失用量均拒绝，不截断成成功，也不回退样例。

返回严格校验的输出、供应商请求 ID、实际返回的模型和 token 用量。未知缓存用量保持 null，不估算成零费用。网络断开及超时带 `outcome: unknown`，请求拒绝和不可采纳结果分别标记；所有情况都不自动重试。`rejected` 仅表示收到拒绝响应，不保证供应商一定没有计费。当前不记录用户原文、上游正文或凭据。

调用层仍须完成：鉴权与 DEMO 服务端名单、用户传输同意、额度与费用预算、持久化 operationId 去重、来源/话题/删除版本检查及重启恢复。不得把本函数放在数据库事务内等待，也不能把返回值直接确认为章节或公开。没有这些编排之前不得暴露真实调用路由。

测试入口：`node --import tsx --test tests/server/deepseek.test.ts`。全部使用合成资料、假凭据和本地 HTTP 假上游；没有真实 DeepSeek 请求，也没有计费验证。
