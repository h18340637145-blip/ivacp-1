import { describe, expect, it } from "vitest";
import {
  buildSampleEmbeddingText,
  cosineSimilarity,
  titleSimilarity,
  toFewShotSample,
} from "@/domain/analysis/few-shot-scoring";
import type { ReviewSample } from "@/domain/entities";

function sample(partial: Partial<ReviewSample>): ReviewSample {
  return {
    id: "s1",
    source: "jira",
    ruleGroupId: "g1",
    ticketKey: "K-1",
    sampleKind: "correction",
    wrongConclusion: "错",
    correctConclusion: "对",
    errorReason: "【信号误判】原因",
    createdAt: new Date(),
    ...partial,
  } as ReviewSample;
}

describe("few-shot scoring", () => {
  it("computes title overlap", () => {
    expect(titleSimilarity("空调 无法 开启", "空调 无法 关闭")).toBeCloseTo(2 / 3);
    expect(titleSimilarity("", "x")).toBe(0);
    expect(titleSimilarity("Hello, World", "hello world")).toBe(1);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("builds embedding text from fingerprint and conclusions", () => {
    const text = buildSampleEmbeddingText(
      sample({ evidenceFingerprintText: "FP", approvedConclusion: "确认", wrongConclusion: "w".repeat(600) }),
    );
    expect(text.split("\n")[0]).toBe("FP");
    expect(text).toContain("错误原因：【信号误判】原因");
    expect(text).toContain(`错误结论：${"w".repeat(500)}`);
    expect(text).not.toContain("w".repeat(501));
    expect(text).toContain("人工确认结论：确认");
  });

  it("maps to few-shot payload", () => {
    const shot = toFewShotSample(sample({ issueSummary: "标题", correctConclusion: "c".repeat(3000) }), 0.8);
    expect(shot.issueKey).toBe("K-1");
    expect(shot.ticketKey).toBe("K-1");
    expect(shot.correctConclusion).toHaveLength(2000);
    expect(shot.relevanceScore).toBe(0.8);
    expect(shot.sampleKind).toBe("correction");
    const approved = toFewShotSample(sample({ sampleKind: "approved" }), 0.5);
    expect(approved.errorCategory).toBeUndefined();
  });
});
