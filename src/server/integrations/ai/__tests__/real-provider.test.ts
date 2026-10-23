import { describe, expect, it } from "vitest";
import { createCurationService } from "../index.js";

const apiKey = process.env.AI_API_KEY;
const model = process.env.AI_MODEL;
const baseUrl = process.env.AI_BASE_URL;
const describeReal = apiKey !== undefined && model !== undefined ? describe : describe.skip;

describeReal("real AI provider (set AI_API_KEY and AI_MODEL to run)", () => {
  it(
    "returns a contract-valid draft from a real call",
    async () => {
      const service = createCurationService({
        apiKey: apiKey ?? "",
        model: model ?? "",
        timeoutMs: 30_000,
        jsonMode: process.env.AI_JSON_MODE !== "false",
        ...(baseUrl === undefined ? {} : { baseUrl }),
      });

      const draft = await service.generateDraft({
        sourceVersion: "real-check-v1",
        exhibitName: "旧茶杯",
        era: "约八十年代",
        segments: [
          { id: "S1", text: "爷爷跑运输的时候一直带着这个杯子，杯口有一道磕痕。" },
          { id: "S2", text: "具体哪一年买的记不清了，大概是八十年代，地点也说不准。" },
        ],
      });

      expect(draft.sourceVersion).toBe("real-check-v1");
      expect(Array.from(draft.label.replace(/\s/g, "")).length).toBeGreaterThanOrEqual(60);
      expect(Array.from(draft.label.replace(/\s/g, "")).length).toBeLessThanOrEqual(120);
      expect(draft.questions.length).toBeLessThanOrEqual(2);
      expect(draft.sourceSegmentIds.length).toBeGreaterThan(0);
    },
    45_000,
  );
});
