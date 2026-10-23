# AI 整理适配器（D 主责）

把已保存的展品名称、约略年代和带来源标识的讲述片段整理成展签草稿。模块只调用模型并校验输出，不读写数据库、不确认、不发布。

## 用法

```ts
import { AiError, CurationInputError, createCurationService } from "./index.js";

const curation = createCurationService({
  apiKey: process.env.AI_API_KEY ?? "",
  baseUrl: process.env.AI_BASE_URL, // 例如 https://api.openai.com/v1
  model: process.env.AI_MODEL ?? "",
  timeoutMs: 20_000,
});

const draft = await curation.generateDraft({
  sourceVersion: exhibit.version, // 调用前读到的版本
  exhibitName: exhibit.name,
  era: exhibit.era,
  segments: narrative.segments, // [{ id: "S1", text: "..." }]
});
```

`draft.sourceVersion` 原样带回调用前的版本。**C 在采纳草稿时必须重新检查当前版本；不匹配则拒绝采纳。** 适配器不保存草稿，也不能代替物主或制作人员确认。

## 输出约束

- `label`：60 至 120 个非空白字符，单段。
- `questions`：最多 2 个，每个最多 80 个非空白字符。
- `sourceSegmentIds`：至少 1 个，且必须来自输入片段。
- 只使用输入事实；保留“约、可能、记不清”等不确定性；不补造人物、年份、关系、事件和情绪。
- 片段之间说法矛盾时不自行选择或调和，保留“说法不一/记不清”的边界，并通过追问提示人工核对。
- 结构化校验通过不等于事实正确，仍需人工审阅。

## 错误契约

| 来源 | 映射 |
| --- | --- |
| `CurationInputError` | 400 `VALIDATION_ERROR` |
| `AiError` 且 `code === "AI_TIMEOUT"` | 504 `AI_TIMEOUT` |
| `AiError` 且 `code === "AI_UNAVAILABLE"` | 502 `AI_UNAVAILABLE` |

错误消息不包含讲述原文、模型原始输出或密钥。`AiError.cause` 仅供服务端诊断，不能返回给客户端或写入普通日志。AI 失败时调用方必须保留已保存的素材与讲述，允许人工继续。

## C 需要接入的部分

1. 在根 `package.json` 增加 `zod`；在服务端环境配置 `AI_API_KEY`、`AI_MODEL`，可选 `AI_BASE_URL`。启动时校验必填配置，不把密钥写入客户端、Git 或日志。
2. 在受保护的 AI 路由中读取**已保存**的展品与讲述版本，调用 `generateDraft`，把草稿连同 `sourceVersion`、模型名、生成时间保存为整理草稿（不要覆盖已确认展签）。
3. 采纳时再次检查当前版本与来源片段；不匹配返回 409 `VERSION_CONFLICT`，不自动覆盖。
4. 把 `AiError` / `CurationInputError` 映射到共享错误契约；不要把 provider 原始响应透传。
5. 真实调用至少成功一次后再把 A21 标记为通过。当前测试只覆盖本地假上游，真实 provider 调用尚未执行。

## 依赖与验证

- 运行时：`zod`（代码使用 `z.object(...).strict()`，Zod 3/4 均可用）。
- 测试：`vitest`，`src/server/integrations/ai/__tests__/ai.test.ts` 共 12 个用例；`real-provider.test.ts` 默认跳过，设置 `AI_API_KEY`、`AI_MODEL`（可选 `AI_BASE_URL`、`AI_JSON_MODE=false`）后运行会发起一次真实调用并产生费用。
- 已验证：正常 JSON、代码围栏 JSON、长度越界、追问超过 2 个、未知来源 ID、HTTP 500、非法 JSON、超时、输入上限、缺少密钥、请求体不含密钥。
- 测试环境：Node.js 20.19.0、Zod 4.6.7、Vitest 2.1.9。
- 未执行：真实模型调用（等待可用 key）、流式输出、自动重试、语音转写。首版不需要流式；自动重试会增加重复调用，暂不加入。
- 真实调用命令：`npx vitest run src/server/integrations/ai/__tests__/real-provider.test.ts`。成功一次后把 A21 的真实调用部分标记为通过。
- 模型输出不保证事实正确，E 仍需按内容样例核对事实边界。
