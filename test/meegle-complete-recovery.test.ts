import { configurationFixture } from "./helpers/configuration-fixture";
import { versionVhalFixture, versionVhalVsFixture } from "./helpers/version-vhal-fixture";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { recoverMeegleRun } from "@/server/meegle/recovery";
import { hasCompleteMeegleSuccess } from "@/server/meegle/run-artifacts";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const logBase = await fs.mkdtemp(path.join(os.tmpdir(), "ivacp-recovery-")); dirs.push(logBase);
  const identity = { runId: "immutable-run", issueKey: "meegle-99", projectKey: "p", workItemId: "99", workItemTypeKey: "issue" as const, ruleGroupName: "group" };
  const dir = path.join(logBase, "group", "unknown", "meegle-99", "immutable-run"); await fs.mkdir(dir, { recursive: true });
  const data = { issueKey: identity.issueKey, replyText: "完整结论", model: "qwen", mode: "can_only", elapsedMs: 100, tokenUsage: 1234, stages: { DONE: "完成" }, traceData: { SOC: { x: ["2026-10-27 12:00:00"], y: [89] } }, ticks: { SOC: { ticks: [89], labels: ["89%"] } } };
  await Promise.all([
    fs.writeFile(path.join(dir, "pipeline-metrics.json"), JSON.stringify({ status: "success", issueKey: identity.issueKey, responseArtifactVersion: 1, tokenUsage: 1234 })),
    fs.writeFile(path.join(dir, "final_reply.md"), "完整结论"),
    fs.writeFile(path.join(dir, "stages.json"), JSON.stringify({ stages: data.stages })),
    fs.writeFile(path.join(dir, "process-response.json"), JSON.stringify(data)),
  ]);
  return { logBase, identity, dir, data };
}
it("从同一run完整响应恢复曲线、ticks、模型、Token并重签凭据", async () => {
  const f = await fixture();
  const recovered = await recoverMeegleRun(f.identity, { logBase: f.logBase, fetchHandoverAt: async () => undefined });
  expect(recovered).toMatchObject({ replyText: f.data.replyText, model: "qwen", tokenUsage: 1234, traceData: f.data.traceData, ticks: f.data.ticks });
  expect(recovered).toHaveProperty("artifactRef"); expect(recovered).toHaveProperty("analysisReceipt");
});
it("新版本success marker没有完整响应文件时不可恢复", async () => {
  const f = await fixture(); await fs.rm(path.join(f.dir, "process-response.json"));
  expect(await hasCompleteMeegleSuccess(f.dir, f.identity.issueKey)).toBe(false);
  expect(await recoverMeegleRun(f.identity, { logBase: f.logBase, fetchHandoverAt: async () => undefined })).toEqual({ recoverable: false });
});
it("其他工单或内容不匹配的响应不能恢复到当前run", async () => {
  const f = await fixture(); await fs.writeFile(path.join(f.dir, "process-response.json"), JSON.stringify({ ...f.data, issueKey: "meegle-100" }));
  expect(await recoverMeegleRun(f.identity, { logBase: f.logBase, fetchHandoverAt: async () => undefined })).toEqual({ recoverable: false });
});

it.each([versionVhalFixture, versionVhalVsFixture])("recovers structured version checks from the same successful run: %s", async makeCheck=>{
 const f=await fixture(); const check=makeCheck();
 await fs.writeFile(path.join(f.dir,"process-response.json"),JSON.stringify({...f.data,versionVhalCheck:check,configurationResolution:configurationFixture()}));
 expect(await recoverMeegleRun(f.identity,{logBase:f.logBase,fetchHandoverAt:async()=>undefined})).toMatchObject({versionVhalCheck:check,configurationResolution:configurationFixture()});
});
