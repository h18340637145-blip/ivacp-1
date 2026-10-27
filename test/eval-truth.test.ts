import { describe, expect, it } from "vitest";
import {
  buildEvalEntryFromSample,
  extractVerdictKeywords,
  mergeEvalSet,
  pickLatestSamplePerTicket,
  ticketDirNameFromIssueKey,
  type EvalSetEntry,
} from "@/domain/analysis/eval-truth";
import type { ReviewSample } from "@/domain/entities";

const base: ReviewSample = {
  id: "s1",
  source: "meegle",
  ruleGroupId: "g1",
  ticketKey: "7109625485",
  sampleKind: "correction",
  wrongConclusion: "错",
  correctConclusion: "信号ICC_CWCWorkingStsSet已下设1，vehicle已经透传，请按需求确认原因并转对应模块分析，谢谢",
  errorReason: "r",
  createdAt: new Date("2026-09-01T00:00:00Z"),
};
const context = { ruleGroupDir: "chery D01-8255", carModelDir: "D01" };

describe("eval truth export", () => {
  it("把飞书票号折叠为评测目录名", () => {
    expect(ticketDirNameFromIssueKey("meegle-6a31-issue-7109625485")).toBe("meegle-7109625485");
    expect(ticketDirNameFromIssueKey("FL3-2483")).toBe("FL3-2483");
  });

  it("从固定措辞提取关键判断", () => {
    expect(extractVerdictKeywords("请确认对手件是否正常搭载，请转对手件分析")).toEqual(["转对手件"]);
    expect(extractVerdictKeywords("依次从应用->Framework再转给VHAL分析")).toEqual(["再转给VHAL分析"]);
  });

  it("改判样本生成含信号与关键判断的条目", () => {
    const entry = buildEvalEntryFromSample(base, context);
    expect(entry).toMatchObject({
      issueKey: "meegle-7109625485",
      expectedKeywords: ["转对应模块"],
      expectedSignals: ["ICC_CWCWorkingStsSet"],
      source: "mysql-review-sample",
    });
  });

  it("没有可校验信号或关键判断的样本不导出", () => {
    const sample = { ...base, sampleKind: "approved" as const, approvedConclusion: "链路正常", correctConclusion: "" };
    expect(buildEvalEntryFromSample(sample, context)).toBeNull();
  });

  it("样本信号必须出现在结论中", () => {
    const entry = buildEvalEntryFromSample({ ...base, signalTokens: ["ICC_CWCWORKINGSTSSET", "NOT_IN_TEXT"] }, context);
    expect(entry?.expectedSignals).toEqual(["ICC_CWCWORKINGSTSSET"]);
  });

  it("合并时手写条目优先，过期导出条目被刷新", () => {
    const manual: EvalSetEntry = { ruleGroupDir: "g", carModelDir: "c", issueKey: "A-1", expectedKeywords: ["手写"] };
    const stale: EvalSetEntry = { ruleGroupDir: "g", carModelDir: "c", issueKey: "B-1", source: "mysql-review-sample" };
    const merged = mergeEvalSet(
      [manual, stale],
      [
        { ruleGroupDir: "g", carModelDir: "c", issueKey: "A-1", source: "mysql-review-sample" },
        { ruleGroupDir: "g", carModelDir: "c", issueKey: "C-1", source: "mysql-review-sample" },
      ],
    );
    expect(merged.map((item) => item.issueKey)).toEqual(["A-1", "C-1"]);
    expect(merged[0].expectedKeywords).toEqual(["手写"]);
  });

  it("同一张票只取最新样本", () => {
    const latest = pickLatestSamplePerTicket([base, { ...base, id: "s2", createdAt: new Date("2026-09-05T00:00:00Z") }]);
    expect(latest.map((item) => item.id)).toEqual(["s2"]);
  });
});
