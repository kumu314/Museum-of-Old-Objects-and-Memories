import { createServer, type IncomingHttpHeaders } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  AiError,
  CurationInputError,
  createCurationService,
  type CurationInput,
} from "@/server/integrations/ai";

const VALID_LABEL =
  "这只旧茶杯是爷爷当年跑运输时随身带着的物件，杯身有一道细小的磕痕。关于具体购买年份和地点，家里人记不清了，只能确认它大约陪伴了爷爷很多年。";

const INPUT: CurationInput = {
  sourceVersion: "v3",
  exhibitName: "旧茶杯",
  era: "约八十年代",
  segments: [
    { id: "S1", text: "爷爷跑运输时一直带着这个杯子。" },
    { id: "S2", text: "哪年买的记不清了，大概是八十年代。" },
  ],
};

type Reply = {
  status: number;
  body: unknown;
  delayMs?: number;
};

type CapturedRequest = {
  body: unknown;
  headers: IncomingHttpHeaders;
};

type ServerHandle = {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
};

function startServer(reply: Reply | ((body: unknown) => Reply)): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const requests: CapturedRequest[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        if (chunks.reduce((total, item) => total + item.byteLength, 0) > 1_000_000) {
          request.destroy();
        }
      });
      request.on("end", () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          parsed = null;
        }
        requests.push({ body: parsed, headers: request.headers });
        const current = typeof reply === "function" ? reply(parsed) : reply;
        const send = (): void => {
          if (response.writableEnded) {
            return;
          }
          response.statusCode = current.status;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(current.body));
        };
        if (current.delayMs !== undefined) {
          setTimeout(send, current.delayMs);
        } else {
          send();
        }
      });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("测试服务器没有取得端口"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function chatReply(content: string, status = 200): Reply {
  return {
    status,
    body: {
      choices: [
        {
          message: {
            role: "assistant",
            content,
          },
        },
      ],
    },
  };
}

function validContent(
  overrides: Partial<{
    label: string;
    questions: string[];
    sourceSegmentIds: string[];
  }> = {},
): string {
  return JSON.stringify({
    label: VALID_LABEL,
    questions: ["这只杯子大约是什么年代买到的？"],
    sourceSegmentIds: ["S1", "S2"],
    ...overrides,
  });
}

let handle: ServerHandle | undefined;

afterEach(async () => {
  if (handle !== undefined) {
    await handle.close();
    handle = undefined;
  }
});

function serviceFor(baseUrl: string, timeoutMs = 2_000) {
  return createCurationService({
    apiKey: "test-key",
    baseUrl,
    model: "test-model",
    timeoutMs,
  });
}

describe("AI curation adapter", () => {
  it("returns a validated draft and echoes the source version", async () => {
    handle = await startServer(chatReply(validContent()));
    const draft = await serviceFor(handle.baseUrl).generateDraft(INPUT);

    expect(draft.sourceVersion).toBe("v3");
    expect(draft.label).toBe(VALID_LABEL);
    expect(draft.questions).toEqual(["这只杯子大约是什么年代买到的？"]);
    expect(draft.sourceSegmentIds).toEqual(["S1", "S2"]);
    expect(draft.model).toBe("test-model");
    expect(Number.isNaN(Date.parse(draft.generatedAt))).toBe(false);
  });

  it("sends a bounded JSON-mode request without leaking the key into the body", async () => {
    handle = await startServer(chatReply(validContent()));
    await serviceFor(handle.baseUrl).generateDraft(INPUT);

    const captured = handle.requests[0];
    expect(captured).toBeDefined();
    if (captured === undefined) {
      throw new Error("没有捕获请求");
    }

    expect(captured.headers.authorization).toBe("Bearer test-key");
    expect(captured.body).toMatchObject({
      model: "test-model",
      temperature: 0.2,
      max_tokens: 2000,
      stream: false,
      response_format: { type: "json_object" },
    });
    expect(JSON.stringify(captured.body)).not.toContain("test-key");
  });

  it("uses a bounded configurable output budget", async () => {
    handle = await startServer(chatReply(validContent()));
    const service = createCurationService({
      apiKey: "test-key",
      baseUrl: handle.baseUrl,
      model: "test-model",
      maxOutputTokens: 1234,
    });
    await service.generateDraft(INPUT);
    expect(handle.requests[0]?.body).toMatchObject({ max_tokens: 1234 });
  });

  it("reports a truncated model response as AI_UNAVAILABLE", async () => {
    handle = await startServer({
      status: 200,
      body: {
        choices: [
          {
            message: { role: "assistant", content: "" },
            finish_reason: "length",
          },
        ],
      },
    });

    let caught: unknown;
    try {
      await serviceFor(handle.baseUrl).generateDraft(INPUT);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AiError);
    if (!(caught instanceof AiError)) {
      throw new Error("没有捕获 AiError");
    }
    expect(caught.code).toBe("AI_UNAVAILABLE");
    expect(caught.message).toContain("截断");
  });

  it("accepts a fenced JSON response", async () => {
    handle = await startServer(chatReply("```json\n" + validContent() + "\n```"));
    const draft = await serviceFor(handle.baseUrl).generateDraft(INPUT);
    expect(draft.label).toBe(VALID_LABEL);
  });

  it("rejects a label shorter than 60 characters", async () => {
    const shortLabel = "短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短";
    handle = await startServer(chatReply(validContent({ label: shortLabel })));
    await expect(serviceFor(handle.baseUrl).generateDraft(INPUT)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 502,
    });
  });

  it("rejects more than two follow-up questions", async () => {
    handle = await startServer(
      chatReply(validContent({ questions: ["问题一", "问题二", "问题三"] })),
    );
    await expect(serviceFor(handle.baseUrl).generateDraft(INPUT)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("rejects a source id that was not provided", async () => {
    handle = await startServer(chatReply(validContent({ sourceSegmentIds: ["S9"] })));
    await expect(serviceFor(handle.baseUrl).generateDraft(INPUT)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("maps an upstream HTTP error to AI_UNAVAILABLE", async () => {
    handle = await startServer({ status: 500, body: { error: "boom" } });
    await expect(serviceFor(handle.baseUrl).generateDraft(INPUT)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 502,
    });
  });

  it("maps invalid JSON to AI_UNAVAILABLE without echoing the narrative", async () => {
    const privateNarrative = "这是一段不应该出现在错误消息里的私密讲述";
    handle = await startServer(chatReply("not json at all"));
    const service = serviceFor(handle.baseUrl);

    let caught: unknown;
    try {
      await service.generateDraft({
        ...INPUT,
        segments: [{ id: "S1", text: privateNarrative }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AiError);
    if (!(caught instanceof AiError)) {
      throw new Error("没有捕获 AiError");
    }
    expect(caught.code).toBe("AI_UNAVAILABLE");
    expect(caught.message).not.toContain(privateNarrative);
    if (typeof caught.cause === "string") {
      expect(caught.cause).not.toContain(privateNarrative);
    }
    if (caught.cause instanceof Error) {
      expect(caught.cause.message).not.toContain(privateNarrative);
    }
  });

  it("maps a slow provider to AI_TIMEOUT", async () => {
    handle = await startServer({ ...chatReply(validContent()), delayMs: 300 });
    await expect(
      serviceFor(handle.baseUrl, 50).generateDraft(INPUT),
    ).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      status: 504,
    });
  });

  it("rejects invalid input before calling the provider", async () => {
    handle = await startServer(chatReply(validContent()));
    const service = serviceFor(handle.baseUrl);

    await expect(
      service.generateDraft({ ...INPUT, segments: [] }),
    ).rejects.toBeInstanceOf(CurationInputError);
    expect(handle.requests).toHaveLength(0);
  });

  it("rejects oversized input before calling the provider", async () => {
    handle = await startServer(chatReply(validContent()));
    const service = createCurationService({
      apiKey: "test-key",
      baseUrl: handle.baseUrl,
      model: "test-model",
      timeoutMs: 2_000,
      maxInputChars: 10,
    });

    await expect(service.generateDraft(INPUT)).rejects.toBeInstanceOf(CurationInputError);
    expect(handle.requests).toHaveLength(0);
  });

  it("refuses to create a service without an API key", () => {
    expect(() => createCurationService({ apiKey: "  ", model: "test-model" })).toThrow(
      "AI API key 未配置",
    );
  });
});
