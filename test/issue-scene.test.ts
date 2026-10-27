import { describe, expect, it } from "vitest";
import {
  applyIssueSceneReplyTag,
  buildIssueScenePromptBlock,
  detectIssueScene,
  filterBySameScene,
} from "@/domain/analysis/issue-scene";
import { toExportRecord } from "@/domain/labeling/schema";

const bench = { issueKey: "A-1", issueSummary: "【T1YA-8255】【台架】【中控】驾驶模式没有下发信号" };
const vehicle = { issueKey: "A-2", issueSummary: "【T1L_FL1】【实车】空调温度显示异常" };
const unknown = { issueKey: "A-3", issueSummary: "【T1P】车辆设置页面闪退" };
const noSummary = { issueKey: "A-4", issueSummary: undefined };

describe("issue scene", () => {
  it("detects 台架 / 实车 from title, first marker wins", () => {
    expect(detectIssueScene(bench.issueSummary)).toBe("bench");
    expect(detectIssueScene(vehicle.issueSummary)).toBe("vehicle");
    expect(detectIssueScene(unknown.issueSummary)).toBeUndefined();
    expect(detectIssueScene(undefined)).toBeUndefined();
    expect(detectIssueScene("【实车】复现，台架未复现")).toBe("vehicle");
  });

  it("recalls only same-scene samples; unknown scene keeps all", () => {
    const all = [bench, vehicle, unknown, noSummary];
    const summaryOf = (sample: typeof bench | typeof noSummary) => sample.issueSummary;
    expect(filterBySameScene("bench", all, summaryOf).map((s) => s.issueKey)).toEqual(["A-1"]);
    expect(filterBySameScene("vehicle", all, summaryOf).map((s) => s.issueKey)).toEqual(["A-2"]);
    expect(filterBySameScene(undefined, all, summaryOf)).toHaveLength(4);
  });

  it("builds scene-specific prompt guidance", () => {
    expect(buildIssueScenePromptBlock(undefined)).toBe("");
    expect(buildIssueScenePromptBlock("bench")).toContain("请测试确认是否模拟信号上报");
    expect(buildIssueScenePromptBlock("vehicle")).toContain("vehicle 通路正常");
  });

  it("prefixes conclusion with scene tag once", () => {
    expect(applyIssueSceneReplyTag("结论：信号未下发", "bench")).toBe("【台架问题】\n结论：信号未下发");
    expect(applyIssueSceneReplyTag("  【实车问题】\n结论", "vehicle")).toBe("【实车问题】\n结论");
    expect(applyIssueSceneReplyTag("结论", undefined)).toBe("结论");
    expect(applyIssueSceneReplyTag("", "bench")).toBe("");
  });

  it("labeling export carries scene", () => {
    const record = toExportRecord(
      { itemId: "jira:1", source: "jira", issueKey: "A-1", scene: "bench", aiConclusion: "x" },
      { itemId: "jira:1", verdict: "correct", errorCodes: [], purposes: ["few_shot_positive"], correctedConclusion: "", difficulty: "medium", note: "", labeler: "u", revision: 1, updatedAt: "2026-10-21T00:00:00Z" },
    );
    expect(record?.scene).toBe("bench");
  });
});
