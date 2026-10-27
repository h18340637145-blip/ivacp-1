import { describe, expect, it } from "vitest";
import type { FilterRun } from "@/domain/entities";
import {
  FILTER_RUN_TIMEOUT_MS,
  buildChartBackfillPath,
  buildProcessDispatchPlan,
  buildReviewAnalysisContext,
  buildSourceSummary,
  canCommentResult,
  defaultCommentBody,
  detectCarModelFromSummary,
  expireFilterRun,
  extractCarModelFromTitle,
  extractConclusionForComment,
  filterRunToSourceState,
  isExpiredActiveFilterRun,
  isValidIssueKey,
  latestBy,
  matchRuleGroupsByModel,
  sanitizeChartPathSegment,
} from "@/domain/issue-source/jira-workflow";

function run(partial: Partial<FilterRun>): FilterRun {
  return {
    id: "r1",
    source: "jira",
    ruleGroupId: "g1",
    query: "q",
    status: "completed",
    issueCount: 3,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...partial,
  };
}

describe("filter run lifecycle", () => {
  it("expires only active runs past the timeout", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const now = createdAt.getTime() + FILTER_RUN_TIMEOUT_MS + 1;
    expect(isExpiredActiveFilterRun({ status: "running", createdAt }, now)).toBe(true);
    expect(isExpiredActiveFilterRun({ status: "pending", createdAt }, now)).toBe(true);
    expect(isExpiredActiveFilterRun({ status: "completed", createdAt }, now)).toBe(false);
    expect(isExpiredActiveFilterRun({ status: "running", createdAt }, createdAt.getTime() + 1000)).toBe(false);
  });

  it("marks expired runs with recovery error", () => {
    const expired = expireFilterRun(run({ status: "running" }));
    expect(expired.status).toBe("expired");
    expect(expired.error).toContain("超时");
    expect(expired.completedAt).toBeInstanceOf(Date);
  });

  it("maps runs to source state", () => {
    expect(filterRunToSourceState(undefined, false).status).toBe("disabled");
    expect(filterRunToSourceState(undefined, true).status).toBe("idle");
    expect(filterRunToSourceState(run({ status: "pending" }), true).status).toBe("running");
    expect(filterRunToSourceState(run({}), true)).toMatchObject({ status: "completed", issueCount: 3 });
  });

  it("builds summary from latest runs", () => {
    const summary = buildSourceSummary({ jql: "project = A", meegleMql: "" }, { jira: run({}) });
    expect(summary.jira.status).toBe("completed");
    expect(summary.meegle.configured).toBe(false);
  });

  it("picks the latest item", () => {
    const a = { at: new Date("2025-01-01") };
    const b = { at: new Date("2025-02-01") };
    expect(latestBy([a, b], (item) => item.at)).toBe(b);
    expect(latestBy([], (item: { at: Date }) => item.at)).toBeUndefined();
  });
});

describe("process dispatch", () => {
  it("dispatches completed sources with issues", () => {
    const plan = buildProcessDispatchPlan({
      jira: { configured: true, status: "completed", issueCount: 2 },
      meegle: { configured: true, status: "completed", issueCount: 0 },
    });
    expect(plan).toEqual([{ source: "jira", action: "runJiraSnapshots" }]);
    expect(
      buildProcessDispatchPlan({
        jira: { configured: true, status: "failed", issueCount: 2 },
        meegle: { configured: true, status: "completed", issueCount: 1 },
      }),
    ).toEqual([{ source: "meegle", action: "runMeegleAssignments" }]);
  });
});

describe("analyze by key", () => {
  it("extracts model from brackets", () => {
    expect(extractCarModelFromTitle("[T1L_FL1] 空调无法开启")).toBe("T1L_FL1");
    expect(extractCarModelFromTitle("【E0Y】 屏幕黑屏")).toBe("E0Y");
    expect(extractCarModelFromTitle("无车型")).toBe("");
  });

  it("matches rule groups by model (equal or contained)", () => {
    const groups = [
      { id: "a", model_to_files: { T1L_FL1_8255: {} } },
      { id: "b", model_to_files: { e0y: {} } },
      { id: "c", model_to_files: {} },
    ] as never as Array<{ id: string; model_to_files: Record<string, never> }>;
    expect(matchRuleGroupsByModel(groups, "T1L_FL1").map((g) => g.id)).toEqual(["a"]);
    expect(matchRuleGroupsByModel(groups, "E0Y").map((g) => g.id)).toEqual(["b"]);
    expect(matchRuleGroupsByModel(groups, "")).toEqual([]);
  });

  it("validates issue keys", () => {
    expect(isValidIssueKey(" chery-123 ")).toBe(true);
    expect(isValidIssueKey("123")).toBe(false);
  });
});

describe("review and comment", () => {
  it("builds review context with comments", () => {
    const context = buildReviewAnalysisContext(
      { description: "desc", comments: [{ author: "张三", created: "2025-01-01", body: "hi" }] },
      "sig",
    );
    expect(context.issueDescription).toBe("desc");
    expect(context.commentsText).toBe("【评论 1】 张三 2025-01-01\nhi");
    expect(context.signalSummary).toBe("sig");
    expect(context.rawDataText).toContain('"description": "desc"');
  });

  it("extracts conclusion section", () => {
    expect(extractConclusionForComment("过程...\n一致性结论：一致")).toBe("一致性结论：一致");
    expect(extractConclusionForComment("分析结论: 不一致")).toBe("分析结论: 不一致");
    expect(extractConclusionForComment("全文")).toBe("全文");
  });

  it("chooses default body and comment eligibility", () => {
    expect(defaultCommentBody({ reviewStatus: "rejected", manualCorrectResult: "正确", replyText: "x" })).toBe("正确");
    expect(defaultCommentBody({ reviewStatus: "approved", replyText: "a\n分析结论：ok" })).toBe("分析结论：ok");
    expect(canCommentResult({ reviewStatus: "approved", commentStatus: "not_started" })).toBe(true);
    expect(canCommentResult({ reviewStatus: "approved", commentStatus: "succeeded" })).toBe(false);
    expect(canCommentResult({ reviewStatus: "rejected", commentStatus: "failed" })).toBe(false);
    expect(canCommentResult({ reviewStatus: "rejected", manualCorrectResult: "x", commentStatus: "failed" })).toBe(true);
    expect(canCommentResult({ reviewStatus: "pending", commentStatus: "not_started" })).toBe(false);
  });

  it("builds chart backfill path", () => {
    expect(sanitizeChartPathSegment('a/b:c*"d')).toBe("a_b_c__d");
    const group = { id: "g1", name: "奇瑞/组", model_to_files: { T1L: {} } } as never;
    expect(buildChartBackfillPath({ group, ticketKey: "K-1", title: "[t1l] x", result: { chartImage: "/img.png" } })).toBe(
      "/img.png",
    );
    expect(buildChartBackfillPath({ group, ticketKey: "K-1", title: "x", result: {} })).toBeUndefined();
    expect(
      buildChartBackfillPath({ group, ticketKey: "K-1", title: "[t1l] x", result: { traceData: {} as never } }),
    ).toBe("/api/charts/log/奇瑞_组/T1L/K-1/can_signals.png");
    expect(detectCarModelFromSummary("none", { T1L: {} })).toBe("");
  });
});
