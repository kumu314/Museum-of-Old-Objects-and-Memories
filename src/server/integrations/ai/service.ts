import { z } from "zod";
import { AiError, CurationInputError } from "./errors.js";
import { buildCurationUserMessage, CURATION_SYSTEM_PROMPT } from "./prompt.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_TIMEOUT_MS,
  MAX_LABEL_CHARS,
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS,
  MAX_SEGMENTS,
  MIN_LABEL_CHARS,
  type CurationDraft,
  type CurationInput,
  type CurationSegment,
  type CurationService,
  type CurationServiceConfig,
} from "./types.js";

const modelOutputSchema = z
  .object({
    label: z.string(),
    questions: z.array(z.string()),
    sourceSegmentIds: z.array(z.string()),
  })
  .strict();

const MAX_PROVIDER_RESPONSE_CHARS = 200_000;
const MAX_MODEL_CONTENT_CHARS = 20_000;

type ModelOutput = z.infer<typeof modelOutputSchema>;

type ResolvedConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxInputChars: number;
  jsonMode: boolean;
};

function resolveConfig(config: CurationServiceConfig): ResolvedConfig {
  const apiKey = config.apiKey.trim();
  if (apiKey.length === 0) {
    throw new Error("AI API key 未配置");
  }

  const model = config.model.trim();
  if (model.length === 0) {
    throw new Error("AI 模型名未配置");
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error("AI base URL 必须是 http(s) 地址");
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error("AI 超时时间必须在 1 至 120000 毫秒之间");
  }

  const maxInputChars = config.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  if (!Number.isInteger(maxInputChars) || maxInputChars <= 0 || maxInputChars > 50_000) {
    throw new Error("AI 输入上限必须是 1 至 50000 的整数");
  }

  return {
    apiKey,
    model,
    baseUrl,
    timeoutMs,
    maxInputChars,
    jsonMode: config.jsonMode ?? true,
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasControlCharacters(value: string, allowLineBreaks: boolean): boolean {
  const pattern = allowLineBreaks
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  return pattern.test(value);
}

function validateInput(input: CurationInput, maxInputChars: number): CurationInput {
  const sourceVersion = input.sourceVersion.trim();
  if (sourceVersion.length === 0 || sourceVersion.length > 128) {
    throw new CurationInputError("来源版本不能为空且不能超过 128 个字符");
  }
  if (hasControlCharacters(sourceVersion, false)) {
    throw new CurationInputError("来源版本包含非法控制字符");
  }

  const exhibitName = input.exhibitName.trim();
  if (exhibitName.length === 0 || exhibitName.length > 100) {
    throw new CurationInputError("展品名称不能为空且不能超过 100 个字符");
  }
  if (hasControlCharacters(exhibitName, false)) {
    throw new CurationInputError("展品名称包含非法控制字符");
  }

  const era = input.era.trim();
  if (era.length === 0 || era.length > 100) {
    throw new CurationInputError("约略年代不能为空且不能超过 100 个字符");
  }
  if (hasControlCharacters(era, false)) {
    throw new CurationInputError("约略年代包含非法控制字符");
  }

  if (input.segments.length === 0) {
    throw new CurationInputError("至少需要一段原始讲述");
  }
  if (input.segments.length > MAX_SEGMENTS) {
    throw new CurationInputError(`原始讲述片段不能超过 ${MAX_SEGMENTS} 段`);
  }

  const seenIds = new Set<string>();
  const segments: CurationSegment[] = [];
  let totalChars = exhibitName.length + era.length;

  for (const segment of input.segments) {
    const id = segment.id.trim();
    if (id.length === 0 || id.length > 64) {
      throw new CurationInputError("来源片段标识不能为空且不能超过 64 个字符");
    }
    if (hasControlCharacters(id, false) || /\s/.test(id)) {
      throw new CurationInputError("来源片段标识不能包含空白或控制字符");
    }
    if (seenIds.has(id)) {
      throw new CurationInputError(`来源片段标识重复：${id}`);
    }
    seenIds.add(id);

    if (segment.text.trim().length === 0) {
      throw new CurationInputError(`来源片段 ${id} 的讲述为空`);
    }
    if (hasControlCharacters(segment.text, true)) {
      throw new CurationInputError(`来源片段 ${id} 包含非法控制字符`);
    }

    totalChars += segment.text.length;
    segments.push({ id, text: segment.text });
  }

  if (totalChars > maxInputChars) {
    throw new CurationInputError(
      `整理输入超过 ${maxInputChars} 个字符，请拆分后再试或手工整理`,
    );
  }

  return {
    sourceVersion,
    exhibitName,
    era,
    segments,
  };
}

function extractJsonText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) {
    return fenced[1]?.trim() ?? null;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

function sanitizedIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}:${issue.code}`)
    .join(";");
}

function parseModelOutput(raw: string, allowedIds: ReadonlySet<string>): ModelOutput {
  const jsonText = extractJsonText(raw);
  if (jsonText === null) {
    throw new AiError("AI_UNAVAILABLE", "模型没有返回可解析的 JSON，已保留原文，请重试或手工整理");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new AiError("AI_UNAVAILABLE", "模型返回的 JSON 无法解析，已保留原文，请重试或手工整理");
  }

  const parsed = modelOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new AiError("AI_UNAVAILABLE", "模型返回的结构不符合约定，已保留原文，请重试或手工整理", {
      cause: new Error(sanitizedIssues(parsed.error)),
    });
  }

  const label = normalizeText(parsed.data.label);
  const labelLength = Array.from(label.replace(/\s/g, "")).length;
  if (labelLength < MIN_LABEL_CHARS || labelLength > MAX_LABEL_CHARS) {
    throw new AiError(
      "AI_UNAVAILABLE",
      `模型返回的展签长度为 ${labelLength} 字，不在 ${MIN_LABEL_CHARS} 至 ${MAX_LABEL_CHARS} 字范围内，请重试或手工整理`,
    );
  }

  if (parsed.data.questions.length > MAX_QUESTIONS) {
    throw new AiError(
      "AI_UNAVAILABLE",
      `模型返回了 ${parsed.data.questions.length} 个追问，超过 ${MAX_QUESTIONS} 个上限，请重试或手工整理`,
    );
  }

  const questions: string[] = [];
  const seenQuestions = new Set<string>();
  for (const question of parsed.data.questions) {
    const normalized = normalizeText(question);
    const length = Array.from(normalized.replace(/\s/g, "")).length;
    if (length === 0 || length > MAX_QUESTION_CHARS) {
      throw new AiError("AI_UNAVAILABLE", "模型返回的追问为空或过长，请重试或手工整理");
    }
    if (seenQuestions.has(normalized)) {
      throw new AiError("AI_UNAVAILABLE", "模型返回了重复的追问，请重试或手工整理");
    }
    seenQuestions.add(normalized);
    questions.push(normalized);
  }

  if (parsed.data.sourceSegmentIds.length === 0) {
    throw new AiError("AI_UNAVAILABLE", "模型没有标注来源片段，请重试或手工整理");
  }

  const sourceSegmentIds: string[] = [];
  const seenSourceIds = new Set<string>();
  for (const sourceId of parsed.data.sourceSegmentIds) {
    if (!allowedIds.has(sourceId)) {
      throw new AiError("AI_UNAVAILABLE", "模型返回了不存在的来源片段标识，请重试或手工整理");
    }
    if (seenSourceIds.has(sourceId)) {
      throw new AiError("AI_UNAVAILABLE", "模型返回了重复的来源片段标识，请重试或手工整理");
    }
    seenSourceIds.add(sourceId);
    sourceSegmentIds.push(sourceId);
  }

  return {
    label,
    questions,
    sourceSegmentIds,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractContent(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0];
  if (!isRecord(first)) {
    return null;
  }

  if (isRecord(first.message)) {
    const content = first.message.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content;
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const part of content) {
        if (isRecord(part) && typeof part.text === "string" && part.text.length > 0) {
          parts.push(part.text);
        }
      }
      if (parts.length > 0) {
        return parts.join("");
      }
    }
  }

  if (typeof first.text === "string" && first.text.trim().length > 0) {
    return first.text;
  }

  return null;
}

export function createCurationService(config: CurationServiceConfig): CurationService {
  const resolved = resolveConfig(config);
  const endpoint = `${resolved.baseUrl}/chat/completions`;

  return {
    async generateDraft(input: CurationInput): Promise<CurationDraft> {
      const validated = validateInput(input, resolved.maxInputChars);
      const allowedIds = new Set(validated.segments.map((segment) => segment.id));

      const body: Record<string, unknown> = {
        model: resolved.model,
        messages: [
          { role: "system", content: CURATION_SYSTEM_PROMPT },
          { role: "user", content: buildCurationUserMessage(validated) },
        ],
        temperature: 0.2,
        max_tokens: 700,
        stream: false,
      };
      if (resolved.jsonMode) {
        body.response_format = { type: "json_object" };
      }

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, resolved.timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resolved.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new AiError(
            "AI_UNAVAILABLE",
            `模型服务返回 HTTP ${response.status}，已保留原文，请重试或手工整理`,
          );
        }

        const rawResponse = await response.text();
        if (rawResponse.length > MAX_PROVIDER_RESPONSE_CHARS) {
          throw new AiError("AI_UNAVAILABLE", "模型响应过大，已保留原文，请重试或手工整理");
        }

        let payload: unknown;
        try {
          payload = JSON.parse(rawResponse);
        } catch {
          throw new AiError("AI_UNAVAILABLE", "模型服务返回了无法解析的响应，请重试或手工整理");
        }

        const content = extractContent(payload);
        if (content === null) {
          throw new AiError("AI_UNAVAILABLE", "模型没有返回可用内容，已保留原文，请重试或手工整理");
        }
        if (content.length > MAX_MODEL_CONTENT_CHARS) {
          throw new AiError("AI_UNAVAILABLE", "模型返回内容过长，已保留原文，请重试或手工整理");
        }

        const output = parseModelOutput(content, allowedIds);
        return {
          sourceVersion: validated.sourceVersion,
          label: output.label,
          questions: output.questions,
          sourceSegmentIds: output.sourceSegmentIds,
          model: resolved.model,
          generatedAt: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof AiError) {
          throw error;
        }
        if (timedOut) {
          throw new AiError(
            "AI_TIMEOUT",
            "模型调用超时，已保留原文，请重试或手工整理",
            { cause: error },
          );
        }
        throw new AiError(
          "AI_UNAVAILABLE",
          "模型服务暂时不可用，已保留原文，请重试或手工整理",
          { cause: error },
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
