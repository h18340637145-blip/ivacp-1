import { EventEmitter } from "node:events";
import { trackPipelineChild } from "@/server/pipeline/process/runtime";
import { requestAnalysisRunStop, resetAnalysisRunRegistryForTests } from "@/server/artifacts/analysis-run-registry";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let plotFixture: { child: EventEmitter & { kill: (signal?: NodeJS.Signals | number) => unknown }; promise: Promise<unknown> } | undefined;
let failUpperSummary = false;
let stopVersion = false;
let cancelDuringRequirements: (() => void) | undefined;
const ctx = { issueKey: "meegle-123", summary: "测试", rawData: {}, ruleGroupId: "g", groupDirName: "g", carModel: "", request: { source: "meegle" }, logRoot: "/tmp/pipeline-test", logger: { log: vi.fn(), flush: vi.fn() }, metrics: { counts: {}, promptStats: {}, stageDurationsMs: {} }, stages: {}, startTime: Date.now() };
vi.mock("@/server/pipeline/process/context", () => ({ createProcessContext: async () => ctx }));
vi.mock("@/server/pipeline/process/prepare", () => ({ prepareIssueData: async () => ({ liveAttachments: [], commentsText: "评论" }), loadModelConfig: async () => { calls.push("load-config"); return {}; }, stageCommentAttachments: async () => ({ attachments: [], stagedPaths: new Map() }), commentStagingRoot: () => "/tmp/no-such-pipeline-staging" }));
vi.mock("@/server/pipeline/jira-attachments", () => ({ classifyAttachments: () => ({ mode: "both", reason: "ok" }), processImageAttachments: async () => "" }));
vi.mock("@/server/handover/handover", () => ({ fetchMeegleHandoverAt: async () => new Date("2026-10-27T01:00:00Z") }));
vi.mock("@/server/jira/connection", () => ({ getJiraConnection: () => ({ username: "test" }) }));
vi.mock("@/server/pipeline/paths-logging", () => ({ saveStepLog: vi.fn() }));
vi.mock("@/server/pipeline/metrics", () => ({ finalizePipelineMetrics: vi.fn(), savePipelineMetrics: vi.fn() }));
vi.mock("@/server/pipeline/process/fetch-attachments", () => ({ downloadAndExtractAttachments: async () => { calls.push("download"); return { canTracePath: "trace.asc", extractDir: "" }; } }));
vi.mock("@/server/pipeline/process/effective-configuration", () => ({ selectEffectiveConfiguration: async () => { calls.push("select-config"); return {summary:"配置审计"}; } }));
vi.mock("@/server/pipeline/log-versions", () => ({ extractLogVersions: async () => [] }));
vi.mock("@/server/pipeline/process/signals-stage", () => ({
 runRequirementStep: async () => { calls.push("requirements"); cancelDuringRequirements?.(); return "需求"; },
 runSignalExtractStep: async (_ctx: unknown, input: { aiRequirements: string }) => { expect(input.aiRequirements).toBe("需求"); calls.push("signals"); return "信号"; },
 matchSignalsToConfig: async () => { calls.push("mapping"); return {}; },
 readCanTracePreview: async () => { calls.push("can"); return { canTraceText: "", parsingStarted: null }; },
 startCanSignalPlot: () => { if (plotFixture) trackPipelineChild(plotFixture.child); return plotFixture?.promise ?? null; },
}));
vi.mock("@/server/pipeline/process/version-vhal-stage", () => ({ runVersionVhalCheck: async () => { calls.push("version-check"); return { summary: "检查摘要", stopReason: stopVersion ? "version_mismatch" : undefined }; } }));
vi.mock("@/server/pipeline/process/log-summary-stage", () => ({ buildUpperBundle: () => "", runUpperSummaryStep: async () => { if (failUpperSummary) throw new Error("Step3 failed"); return ""; }, runAndroidQnxStep: async () => { calls.push("step4"); return ""; } }));
vi.mock("@/server/pipeline/process/evidence-stage", () => ({ collectEvidence: async () => ({ androidLog: "", qnxLog: "" }) }));
vi.mock("@/server/pipeline/process/conclusion-stage", () => ({ runFinalConclusion: async () => "结论", refineFinalReply: async () => "结论" }));
vi.mock("@/server/pipeline/process/version-extract", () => ({ appendBoschMainVersion: async (reply: string) => reply }));
vi.mock("@/server/pipeline/process/finish", () => ({ finishSuccess: async (_ctx: unknown, args: { reply: string }) => ({ replyText: args.reply }), saveStagesJson: vi.fn() }));
vi.mock("@/server/pipeline/process/early-exit", () => ({}));
vi.mock("@/server/ai/qwen", () => ({ runQwenRequest: (fn: () => unknown) => fn() }));
import { processIssue } from "@/server/pipeline/process/orchestrator";
import type { ProcessRequest } from "@/server/pipeline/types";
const request = { issueKey: "meegle-123", summary: "测试", rawData: {}, prompts: {}, ruleGroupId: "g", source: "meegle", runId: "run-123" } as ProcessRequest;
describe("shared pipeline", () => {
 beforeEach(() => { resetAnalysisRunRegistryForTests(); plotFixture = undefined; failUpperSummary = false; stopVersion = false; calls.splice(0); cancelDuringRequirements = undefined; });
 it("terminates and waits for unfinished plotting when Step3 fails", async () => {
  let resolvePlot!: (value: unknown) => void;
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
  plotFixture = { child, promise: new Promise((resolve) => { resolvePlot = resolve; }) }; failUpperSummary = true;
  let settled = false;
  const result = processIssue(request).finally(() => { settled = true; });
  const assertion = result.then(() => undefined, (error: unknown) => error);
  try {
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith("SIGTERM"));
    expect(settled).toBe(false);
  } finally { child.emit("close"); resolvePlot({ image: "", summary: "", error: "stopped" }); }
  expect(await assertion).toMatchObject({ message: "Step3 failed" }); expect(settled).toBe(true);
 });
 it("executes requirement, signal mapping, then CAN parsing in order", async () => {
  expect((await processIssue(request)).replyText).toBe("结论");
  expect(calls).toEqual(["download", "select-config", "load-config", "requirements", "signals", "mapping", "can", "version-check", "step4"]);
 });
 it.each(["jira", "meegle"] as const)("%s stops after version mismatch without starting Step4", async source => {
  stopVersion = true;
  const r = await processIssue({ ...request, source });
  expect(r.replyText).toContain("检查摘要");
  expect(calls).toContain("version-check"); expect(calls).not.toContain("step4");
 });
 it("returns Meegle handover time to callers of the shared API", async () => {
  const result = await processIssue({ ...request, rawData: { projectKey: "p", workItemId: "123" } });
  expect(result.handoverAt).toBe("2026-10-27T01:00:00.000Z");
 });
 it("does not start signal extraction after cancellation during requirements", async () => {
  const controller = new AbortController();
  cancelDuringRequirements = () => controller.abort();
  await expect(processIssue({ ...request, source: "jira", runId: "run-cancel" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toEqual(["download", "select-config", "load-config", "requirements"]);
 });
 it("continues Meegle analysis after the HTTP connection disconnects", async () => {
  const controller = new AbortController();
  cancelDuringRequirements = () => controller.abort();
  expect((await processIssue(request, controller.signal)).replyText).toBe("结论");
  expect(calls).toEqual(["download", "select-config", "load-config", "requirements", "signals", "mapping", "can", "version-check", "step4"]);
 });
 it("honors an explicit registry stop for a running Meegle analysis", async () => {
  cancelDuringRequirements = () => { requestAnalysisRunStop({ source: "meegle", issueKey: request.issueKey, runId: request.runId! }); };
  await expect(processIssue(request)).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toEqual(["download", "select-config", "load-config", "requirements"]);
 });
 it("does not start processing when cancelled", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(processIssue({ ...request, source: "jira" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toEqual([]);
 });
});
