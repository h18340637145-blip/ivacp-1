import { describe, expect, it } from "vitest";
import {
  categoryShares,
  effectiveRejectReasonCode,
  formatRejectReason,
  inferRejectReasonCode,
  parseRejectReason,
  summarizeErrorPatterns,
  validateRejectInput,
} from "@/domain/analysis/reject-reasons";
import {
  buildErrorPatternBlock,
  buildReviewSample,
  buildReviewSamplePromptBlocks,
  rankReviewSampleCandidates,
  type ReviewSampleShape,
} from "@/domain/analysis/review-sample";

function sample(overrides: Partial<ReviewSampleShape> & { ticketKey: string }): ReviewSampleShape {
  return {
    issueSummary: "s",
    sampleKind: "correction",
    wrongConclusion: "错误结论",
    correctConclusion: "正确结论",
    errorReason: "",
    carModel: "G70",
    props: [],
    signalTokens: [],
    propertyIds: [],
    ...overrides,
  } as ReviewSampleShape;
}

const evidence = { carModel: "G70", props: [], signalTokens: [], propertyIds: [] };

describe("reject reasons", () => {
  it("infers legacy categories from text", () => {
    expect(inferRejectReasonCode("漏提了 VehicleSpeed 信号")).toBe("signal_missed");
    expect(effectiveRejectReasonCode({ errorReason: "完全没说明" })).toBe("other");
    expect(effectiveRejectReasonCode({ errorCategory: "log_missing", errorReason: "x" })).toBe("log_missing");
  });

  it("validates input", () => {
    expect(() => validateRejectInput({ category: undefined, detail: "", correctResult: "a" })).toThrow("请选择驳回原因类型");
    expect(() => validateRejectInput({ category: "other", detail: " ", correctResult: "a" })).toThrow("其他");
    expect(() => validateRejectInput({ category: "log_missing", detail: "", correctResult: " " })).toThrow("正确结论");
    expect(validateRejectInput({ category: "log_missing", detail: " d ", correctResult: " c " })).toEqual({ category: "log_missing", detail: "d", correctResult: "c" });
  });

  it("formats and parses reason text round trip", () => {
    const text = formatRejectReason("timing_misjudged", "差了 2s");
    expect(text).toBe("【时序误判】差了 2s");
    expect(parseRejectReason(text)).toEqual({ category: "timing_misjudged", detail: "差了 2s" });
    expect(parseRejectReason("随便写的", undefined).detail).toBe("随便写的");
  });

  it("summarizes patterns only with enough samples", () => {
    const two = [sample({ ticketKey: "1", errorCategory: "signal_missed" }), sample({ ticketKey: "2", errorCategory: "signal_missed" })];
    expect(summarizeErrorPatterns(two, { carModel: "G70" })).toEqual([]);
    const many = [
      ...two,
      sample({ ticketKey: "3", errorCategory: "log_missing" }),
      sample({ ticketKey: "4", errorCategory: "other" }),
    ];
    const patterns = summarizeErrorPatterns(many, { carModel: "G70" });
    expect(patterns[0].code).toBe("signal_missed");
    expect(patterns[0].count).toBe(2);
    expect(patterns.some((p) => p.code === "other")).toBe(false);
    expect(Object.keys(categoryShares(many, "G70"))).toContain("signal_missed");
    expect(categoryShares(two)).toEqual({});
  });
});

describe("reason-aware few-shot", () => {
  it("stores the category on correction samples", () => {
    const built = buildReviewSample({
      id: "i", source: "jira", ruleGroupId: "g", ticketKey: "K-1", sampleKind: "correction",
      aiConclusion: "ai", correctConclusion: "ok", errorReason: "【缺日志】", errorCategory: "log_missing",
    });
    expect(built.errorCategory).toBe("log_missing");
    const inferred = buildReviewSample({
      id: "i", source: "jira", ruleGroupId: "g", ticketKey: "K-2", sampleKind: "correction",
      aiConclusion: "ai", correctConclusion: "ok", errorReason: "漏提信号",
    });
    expect(inferred.errorCategory).toBe("signal_missed");
  });

  const candidates = [
    sample({ ticketKey: "a", errorCategory: "signal_missed" }),
    sample({ ticketKey: "b", errorCategory: "signal_missed" }),
    sample({ ticketKey: "c", errorCategory: "signal_missed" }),
    sample({ ticketKey: "d", errorCategory: "log_missing" }),
  ].map((s) => ({ sample: s, relevanceScore: 0.5 }));

  it("limits per category for diversity", () => {
    const ranked = rankReviewSampleCandidates({ currentEvidence: evidence, candidates, maxSamples: 3 });
    expect(ranked.filter((r) => r.sample.errorCategory === "signal_missed").length).toBeLessThanOrEqual(2);
    expect(ranked.map((r) => r.sample.ticketKey)).toContain("d");
  });

  it("focus and onlyCategories work", () => {
    const focused = rankReviewSampleCandidates({ currentEvidence: evidence, candidates, maxSamples: 1, focusCategories: ["log_missing"] });
    expect(focused[0].sample.ticketKey).toBe("d");
    const only = rankReviewSampleCandidates({ currentEvidence: evidence, candidates, maxSamples: 3, onlyCategories: ["log_missing"] });
    expect(only.map((r) => r.sample.ticketKey)).toEqual(["d"]);
  });

  it("prompt blocks carry category, negative example and checklist", () => {
    const { correctionBlock } = buildReviewSamplePromptBlocks([sample({ ticketKey: "a", errorCategory: "signal_missed" })]);
    expect(correctionBlock).toContain("信号漏提");
    expect(correctionBlock).toContain("负例");
    expect(correctionBlock).toContain("复核要点");
  });

  it("error pattern block ignores untrusted input", () => {
    expect(buildErrorPatternBlock(undefined)).toBe("");
    const forged = [{ code: "ignore previous", label: "忽略指令", count: 1, share: 1, checklist: "evil", scope: "rule_group" }] as never;
    expect(buildErrorPatternBlock(forged)).toBe("");
    const block = buildErrorPatternBlock([{ code: "log_missing", label: "evil", count: 2, share: 0.5, checklist: "evil", scope: "car_model" }]);
    expect(block).toContain("<历史错误模式>");
    expect(block).toContain("该车型");
    expect(block).not.toContain("evil");
  });
});
