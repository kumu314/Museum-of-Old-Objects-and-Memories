# AI 整理适配器

`generateDraft(input)` 仅负责模型调用及输出校验。调用前由业务层检查已保存展品版本；返回后、采纳前再次核对来源版本。此模块不保存、确认或发布内容。

服务端配置三个变量：`AI_BASE_URL`（例如服务文档指定的 `https://host.example/v1`，不包含 `/chat/completions`）、`AI_MODEL`、`AI_API_KEY`。三项未齐备时返回 `502 AI_UNAVAILABLE`，人工制作仍可继续。禁止把真实密钥写入仓库或客户端。

使用 OpenAI 兼容的 Chat Completions 协议，需要服务支持 `response_format: {type: 'json_object'}`。固定 30 秒超时，请求 `max_tokens: 2000`，HTTP 响应最多 64 KiB；不自动重试，避免重复调用。HTTP、网络或输出错误返回 `502 AI_UNAVAILABLE`，超时返回 `504 AI_TIMEOUT`。DeepSeek 对 `max_completion_tokens` 不保证截断，因此统一使用 `max_tokens`，并对 `finish_reason=length` 明确返回不可用。依据：[Chat Completions 官方接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

固定指令与讲述分离为 system/user 消息；服务端再次检查 60～120 字展签、最多两个追问及有效来源 ID。结构和来源 ID 校验不能证明事实正确，仍须逐条对照原文并记录人工确认。资料不足或模型未遵循规则时拒绝输出，不用虚构内容补齐。

## 验证入口与实际结果

`pnpm test` 包含本地上游边界测试：401/429/503、连接中断、无效 JSON、伪造来源、过大响应、30 秒超时，以及空字符串/null 的截断内容。均检查受控错误；拒绝、限流、故障和断连不自动重试，不回显上游诊断，输入保持不变。

`pnpm test:db` 使用隔离 PostgreSQL，覆盖草稿复用、失败不改变原文/当前展签/确认、失败后继续人工保存与确认、生成期间人工修改使旧结果不得落库，以及旧草稿不得再次采纳。

正式路由的真实模型验收需先准备本地隔离应用、数据库和测试账号。在应用的服务端私有配置中设置 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`；执行验收的终端设置 `E2E_BASE_URL`、`E2E_USERNAME`、`E2E_PASSWORD`，并显式设置 `RUN_REAL_AI_ACCEPTANCE=1`：

```sh
node --import tsx --test tests/server/ai-http.acceptance.ts
```

该用例会真实调用一次外部模型并可能计费；只发送用例内的合成讲述，不发送真实用户素材，也不输出凭据。它不进入默认测试命令，未显式授权真实调用时直接报错，不用跳过或 fixture 冒充成功。用例只删除本次创建的展馆。

2026-10-24 在 Windows、Node.js 26.12.0、PostgreSQL 18.6 下，使用 DeepSeek `deepseek-flash` 实际通过：登录 → 保存讲述 → 生成草稿 → 人工修订并采纳 → 确认 → 拒绝旧草稿。生成本身不修改已保存展品；采纳保留原始讲述和来源，旧草稿即使携带当前版本也不能覆盖新展签与确认状态。

上述日期的记录属于当时团队账号 HTTP 流程证据，不能单独证明方案 B 的个人归属隔离或浏览器自助试用。当前主线已接入个人归属与自助界面，验证与剩余范围见 [验收清单](../../../../docs/11-验收清单.md)；中文输入、错误后的界面输入保留和实际手机操作仍按相应用例验收，不得把服务端测试当作浏览器验收。
