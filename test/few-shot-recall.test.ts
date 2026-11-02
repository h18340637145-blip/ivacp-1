import { describe, expect, it } from "vitest";
import {
  fuseRecallRoutes,
  lexicalSimilarity,
  normalizePropertyId,
  recallByIdentifiers,
  recallByLexical,
} from "@/domain/analysis/few-shot-recall";
import { buildSampleQuestionEmbeddingText } from "@/domain/analysis/few-shot-scoring";
import type { ReviewSample } from "@/domain/entities";

function sample(partial: Partial<ReviewSample>): ReviewSample {
  return {
    id: "s1",
    source: "jira",
    ruleGroupId: "g1",
    ticketKey: "K-1",
    sampleKind: "correction",
    wrongConclusion: "错结论",
    correctConclusion: "对结论",
    errorReason: "原因",
    createdAt: new Date(),
    ...partial,
  } as ReviewSample;
}

describe("few-shot recall", () => {
  it("matches Chinese phrasing without spaces", () => {
    expect(lexicalSimilarity("空调温度设置不生效", "空调温度设定无响应")).toBeGreaterThan(0.2);
    expect(lexicalSimilarity("空调温度设置不生效", "车窗升降异响")).toBe(0);
  });

  it("normalizes hex and decimal property ids", () => {
    expect(normalizePropertyId("0x10")).toBe("16");
    expect(normalizePropertyId("16")).toBe("16");
  });

  it("recalls exact identifiers even when text is unrelated", () => {
    const hit = sample({ id: "a", signalTokens: ["HVAC_TempSet"], propertyIds: ["0x10"], issueSummary: "完全不同的标题" });
    const miss = sample({ id: "b", signalTokens: ["Other_Sig"], issueSummary: "空调温度设置不生效" });
    const result = recallByIdentifiers({ props: [], signalTokens: ["hvac_tempset"], propertyIds: [] }, [hit, miss]);
    expect(result.map((item) => item.sample.id)).toEqual(["a"]);
    const byId = recallByIdentifiers({ props: [], signalTokens: [], propertyIds: ["16"] }, [hit, miss]);
    expect(byId.map((item) => item.sample.id)).toEqual(["a"]);
  });

  it("does not mix identifier namespaces", () => {
    const only = sample({ id: "a", signalTokens: ["16"] });
    expect(recallByIdentifiers({ props: [], signalTokens: [], propertyIds: ["16"] }, [only])).toEqual([]);
  });

  it("recalls lexically and fuses routes with dedupe", () => {
    const a = sample({ id: "a", issueSummary: "空调温度设定无响应" });
    const b = sample({ id: "b", issueSummary: "车窗升降异响" });
    const lexical = recallByLexical("空调温度设置不生效", [a, b]);
    expect(lexical.map((item) => item.sample.id)).toEqual(["a"]);
    const fused = fuseRecallRoutes([
      { name: "identifier", candidates: [{ sample: b, score: 1 }, { sample: a, score: 0.5 }] },
      { name: "lexical", candidates: lexical },
    ]);
    expect(fused).toHaveLength(2);
    expect(fused[0].sample.id).toBe("a");
    expect(fused[0].routes).toEqual(["identifier", "lexical"]);
    expect(fused[0].score).toBeLessThanOrEqual(1);
  });

  it("keeps conclusions out of the question embedding text", () => {
    const text = buildSampleQuestionEmbeddingText(sample({ evidenceFingerprintText: "FP", errorReason: "原因" }));
    expect(text).toBe("FP");
  });
});
