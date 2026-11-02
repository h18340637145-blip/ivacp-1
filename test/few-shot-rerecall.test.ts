import { describe, expect, it } from "vitest";
import { recallFewShotAfterEvidence } from "@/domain/analysis/few-shot-rerecall";
import type { EvidencePacket } from "@/domain/analysis/evidence-packet";
import type { FewShotSample } from "@/domain/analysis/process-contracts";

function shot(partial: Partial<FewShotSample>): FewShotSample {
  return {
    issueKey: "K-1",
    issueSummary: "标题",
    sampleKind: "correction",
    wrongConclusion: "错",
    correctConclusion: "对",
    errorReason: "【信号误判】原因",
    ...partial,
  };
}

const packet = {
  carModel: "unknown",
  matchedProps: [
    { prop: "HVAC_TEMP", sourceTokens: ["HVAC_TempSet"], signals: [], propertyId: { decimal: 16, hex: "0x10" } },
  ],
} as unknown as EvidencePacket;

// 零向量（余弦相似度恒为 0）确保单测离线、确定，不依赖真实 embedding 服务
const noVector: Parameters<typeof recallFewShotAfterEvidence>[0]["embed"] = async (input) => ({ model: "stub", embeddings: input.map(() => []) });
const base = { summary: "空调无响应", selfKeys: ["SELF-1"], evidencePacket: packet, embed: noVector };

describe("post-evidence recall", () => {
  it("recovers a sample missed by the initial recall from the pool", async () => {
    const missed = shot({ issueKey: "K-9", sampleId: "m", issueSummary: "完全无关的标题", signalTokens: ["HVAC_TempSet"] });
    const unrelated = shot({ issueKey: "K-8", sampleId: "u", issueSummary: "车窗异响", signalTokens: ["Win_Sig"] });
    const result = await recallFewShotAfterEvidence({ ...base, initial: [unrelated], pool: [missed, unrelated], poolMeta: { eligible: 2, sent: 2, truncated: false } });
    expect(result.samples[0].ticketKey).toBe("K-9");
    expect(result.audit.mode).toBe("pool");
    expect(result.audit.selected[0].routes).toContain("identifier");
  });

  it("recalls via the server-side post-evidence vector route when embeddings match", async () => {
    const semantic = shot({ issueKey: "K-7", sampleId: "v", issueSummary: "语义相关但无共享标识符的案例", signalTokens: [] });
    const unrelated = shot({ issueKey: "K-6", sampleId: "w", issueSummary: "不相关案例", signalTokens: [] });
    const embed: Parameters<typeof recallFewShotAfterEvidence>[0]["embed"] = async (input) => ({
      model: "stub",
      embeddings: input.map((text) => (text.includes("语义相关") ? [1, 0] : text === "空调无响应" ? [1, 0] : [0, 1])),
    });
    const result = await recallFewShotAfterEvidence({ ...base, embed, initial: [], pool: [semantic, unrelated] });
    expect(result.samples.map((item) => item.ticketKey)).toEqual(["K-7"]);
    expect(result.audit.routeCounts.vector).toBe(1);
    expect(result.audit.selected[0].routes).toContain("vector");
  });

  it("degrades gracefully and keeps other routes when the embedding call fails", async () => {
    const identifierHit = shot({ issueKey: "K-5", sampleId: "f", signalTokens: ["HVAC_TempSet"] });
    const failingEmbed: Parameters<typeof recallFewShotAfterEvidence>[0]["embed"] = async () => {
      throw new Error("Embedding 服务不可用");
    };
    const result = await recallFewShotAfterEvidence({ ...base, embed: failingEmbed, initial: [], pool: [identifierHit] });
    expect(result.samples.map((item) => item.ticketKey)).toEqual(["K-5"]);
    expect(result.audit.routeCounts.vector).toBe(0);
    expect(result.audit.degradations.join()).toContain("向量召回不可用");
  });

  it("excludes the current ticket and does not trust client scores", async () => {
    const own = shot({ issueKey: "SELF-1", sampleId: "o", signalTokens: ["HVAC_TempSet"] });
    const other = shot({ issueKey: "K-2", sampleId: "x", signalTokens: ["HVAC_TempSet"], relevanceScore: 0.01 });
    const result = await recallFewShotAfterEvidence({ ...base, initial: [], pool: [own, other] });
    expect(result.samples.map((item) => item.ticketKey)).toEqual(["K-2"]);
    expect(result.audit.excluded.self).toBe(1);
  });

  it("falls back to reranking initial samples without a pool and records truncation", async () => {
    const initial = shot({ issueKey: "K-3", sampleId: "i", issueSummary: "空调无响应" });
    const result = await recallFewShotAfterEvidence({ ...base, initial: [initial], pool: undefined, poolMeta: { eligible: 300, sent: 100, truncated: true } });
    expect(result.audit.mode).toBe("fallback");
    expect(result.samples).toHaveLength(1);
    expect(result.audit.degradations.join()).toContain("截断");
  });

  it("returns empty without forcing cases", async () => {
    const result = await recallFewShotAfterEvidence({ ...base, initial: [], pool: [shot({ sampleId: "z", issueSummary: "车窗异响", signalTokens: ["Win"] })] });
    expect(result.samples).toEqual([]);
  });
});
