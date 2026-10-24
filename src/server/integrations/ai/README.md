# AI 整理适配器

`generateDraft(input)` 仅负责模型调用及输出校验。调用前由业务层检查已保存展品版本；返回后、采纳前再次核对来源版本。此模块不保存、确认或发布内容。

服务端配置三个变量：`AI_BASE_URL`（例如服务文档指定的 `https://host.example/v1`，不包含 `/chat/completions`）、`AI_MODEL`、`AI_API_KEY`。三项未齐备时返回 `502 AI_UNAVAILABLE`，人工制作仍可继续。禁止把真实密钥写入仓库或客户端。

使用 OpenAI 兼容的 Chat Completions 协议，需要服务支持 `response_format: {type: 'json_object'}`。固定 30 秒超时，请求 `max_tokens: 2000`，HTTP 响应最多 64 KiB；不自动重试，避免重复调用。HTTP、网络或输出错误返回 `502 AI_UNAVAILABLE`，超时返回 `504 AI_TIMEOUT`。DeepSeek 对 `max_completion_tokens` 不保证截断，因此统一使用 `max_tokens`，并对 `finish_reason=length` 明确返回不可用。依据：[Chat Completions 官方接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

固定指令与讲述分离为 system/user 消息；服务端再次检查 60～120 字展签、最多两个追问及有效来源 ID。结构和来源 ID 校验不能证明事实正确，仍须逐条对照原文并记录人工确认。资料不足或模型未遵循规则时拒绝输出，不用虚构内容补齐。

本地 HTTP 测试只证明协议和失败处理。当前用户未提供模型服务配置，未调用外部模型，真实 AI 成功链路尚未验证。
