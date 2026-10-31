import { configurationFixture } from "./helpers/configuration-fixture";
import { versionVhalFixture } from "./helpers/version-vhal-fixture";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/pipeline/docupedia-archive", () => ({ scheduleSuccessArchiveToDocupedia: vi.fn() }));
import * as qwen from "@/server/ai/qwen";
import { finishSuccess, finishEarly } from "@/server/pipeline/process/finish";
import { createPipelineMetrics } from "@/server/pipeline/metrics";
import type { ProcessContext } from "@/server/pipeline/process/context";
import type { EvidenceBundle } from "@/server/pipeline/process/evidence-stage";
const directories: string[] = [];
beforeEach(() => { vi.spyOn(qwen, "currentQwenTokenUsage").mockReturnValue(123); });
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function context(): Promise<ProcessContext> {
 const logRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ivacp-finish-")); directories.push(logRoot);
 return { request: { runId: "confirmed-run" }, issueKey: "meegle-1", ruleGroupId: "g", groupDirName: "g", carModel: "", summary: "问题", issueScene: undefined, logRoot, startTime: Date.now(), stages: {}, artifactRef: "signed", analysisReceipt: "receipt", metrics: createPipelineMetrics({ issueKey: "meegle-1", ruleGroupId: "g", ruleGroupName: "g", summary: "问题", carModel: "", attachRoot: logRoot, logRoot }), logger: { log: vi.fn(), flush: vi.fn(async () => undefined) } } as unknown as ProcessContext;
}
const evidence = { versionVhalCheck: versionVhalFixture(), canPlotResult: { image: "", summary: "信号摘要", error: "", trace_data: { State: { x: ["2026-10-27 09:00:00"], y: [1] } }, ticks: { State: { ticks: [1], labels: ["有效"] } } }, reviewEvidence: { props: [], signalTokens: [], propertyIds: [] } } as unknown as EvidenceBundle;
describe("success recovery gate", () => {
 it("persists the complete early-success response behind the same success gate", async () => {
  const ctx = await context(); ctx.stages.GENERATING_REPLY = "完成";
  const response = await finishEarly(ctx, { replyText: "摘要", status: "success", mode: "no_attachments" });
  expect(response.analysisRunId).toBe("confirmed-run");
  expect(response.analysisGroupName).toBe("g");
  const stored = JSON.parse(await fs.readFile(path.join(ctx.logRoot, "process-response.json"), "utf8"));
  expect(stored).toMatchObject({ issueKey: ctx.issueKey, replyText: "摘要", model: process.env.QWEN_MODEL ?? "", mode: "no_attachments", stages: ctx.stages, tokenUsage: 123 });
  expect(response).toMatchObject({ replyText: "摘要", artifactRef: "signed", analysisReceipt: "receipt" });
  expect(JSON.parse(await fs.readFile(path.join(ctx.logRoot, "pipeline-metrics.json"), "utf8"))).toMatchObject({ status: "success", responseArtifactVersion: 1 });
 });
 it("cannot publish early-success metrics when stages cannot be persisted", async () => {
  const ctx = await context(); await fs.mkdir(path.join(ctx.logRoot, "stages.json"));
  await expect(finishEarly(ctx, { replyText: "摘要", status: "success", mode: "no_attachments" })).rejects.toThrow();
  await expect(fs.access(path.join(ctx.logRoot, "pipeline-metrics.json"))).rejects.toThrow();
 });
 it("saves complete recoverable response before marking the run successful", async () => {
  const ctx = await context(); ctx.configurationResolution=configurationFixture();
  await finishSuccess(ctx, { reply: "结论", classified: { mode: "can_only", reason: "" }, evidence, aiStages: { requirements: "需求" } });
  const stored = JSON.parse(await fs.readFile(path.join(ctx.logRoot, "process-response.json"), "utf8"));
  expect(stored).toMatchObject({ issueKey: "meegle-1", replyText: "结论", versionVhalCheck: evidence.versionVhalCheck,configurationResolution:configurationFixture(), traceData: evidence.canPlotResult.trace_data, ticks: evidence.canPlotResult.ticks });
  expect(stored.artifactRef).toBeUndefined(); expect(stored.analysisReceipt).toBeUndefined();
  expect(JSON.parse(await fs.readFile(path.join(ctx.logRoot, "pipeline-metrics.json"), "utf8"))).toMatchObject({ status: "success", responseArtifactVersion: 1 });
 });
 it("does not write a success marker if the recoverable response cannot be saved", async () => {
  const ctx = await context(); await fs.mkdir(path.join(ctx.logRoot, "process-response.json"));
  await expect(finishSuccess(ctx, { reply: "结论", classified: { mode: "can_only", reason: "" }, evidence, aiStages: {} })).rejects.toThrow();
  await expect(fs.access(path.join(ctx.logRoot, "pipeline-metrics.json"))).rejects.toThrow();
 });
});
