import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as registry from "@/server/artifacts/analysis-run-registry";
import { cancelMeegleRun } from "@/server/meegle/cancel";
import { finishEarly } from "@/server/pipeline/process/finish";
import { withAnalysisRun } from "@/server/pipeline/process/runtime";
import { createPipelineMetrics } from "@/server/pipeline/metrics";
import type { ProcessContext } from "@/server/pipeline/process/context";
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const roots: string[] = [];
beforeEach(registry.resetAnalysisRunRegistryForTests);
afterEach(async () => { vi.restoreAllMocks(); registry.resetAnalysisRunRegistryForTests(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe("cancel racing with final metrics publication", () => {
 it.each([false, true])("arbitrates stop while the success metrics write is blocked (disk failure=%s)", async (diskFailure) => {
  const logBase = await fs.mkdtemp(path.join(os.tmpdir(), "ivacp-final-race-")); roots.push(logBase);
  const identity = { runId: "race-run", source: "meegle" as const, issueKey: "meegle-1" };
  const logRoot = path.join(logBase, "g", "unknown", identity.issueKey, identity.runId); await fs.mkdir(logRoot, { recursive: true });
  const handle = registry.registerAnalysisRun(identity); handle.setLogRoot(logRoot);
  const ctx = { issueKey: identity.issueKey, ruleGroupId: "g", groupDirName: "g", carModel: "", logRoot, stages: {}, startTime: Date.now(),
   metrics: createPipelineMetrics({ issueKey: identity.issueKey, ruleGroupId: "g", ruleGroupName: "g", carModel: "", summary: "", logRoot, attachRoot: logRoot }),
   logger: { log: vi.fn(), flush: vi.fn(async () => undefined) },
  } as unknown as ProcessContext;
  const entered = deferred(); const release = deferred(); const realWrite = fs.writeFile.bind(fs);
  vi.spyOn(fs, "writeFile").mockImplementation(async (file, data, options) => {
   if (path.basename(String(file)) === "pipeline-metrics.json.pending") { entered.resolve(); await release.promise; if (diskFailure) throw new Error("disk failed"); }
   return realWrite(file, data, options);
  });
  const stopSpy = vi.spyOn(registry, "requestAnalysisRunStopAfterCommit");
  const publishing = withAnalysisRun(handle, () => finishEarly(ctx, { replyText: "最终结论", status: "success", mode: "no_attachments" }));
  const finishOutcome = publishing.then((value) => ({ value }), (error: unknown) => ({ error }));
  try {
   await entered.promise;
   let stopSettled = false;
   const stopping = cancelMeegleRun({ ...identity, projectKey: "project", workItemTypeKey: "issue", workItemId: "1", ruleGroupName: "g" }, { logBase });
   const stopOutcome = stopping.then((value) => { stopSettled = true; return { value }; }, (error: unknown) => { stopSettled = true; return { error }; });
   await vi.waitFor(() => expect(stopSpy).toHaveBeenCalled());
   expect(stopSettled).toBe(false); expect(handle.signal.aborted).toBe(false);
   await expect(fs.access(path.join(logRoot, "cancelled.json"))).rejects.toThrow();
   release.resolve();
   const [finish, stop] = await Promise.all([finishOutcome, stopOutcome]);
   if (diskFailure) {
    expect(finish).toMatchObject({ error: { message: "disk failed" } }); expect(stop).toMatchObject({ value: { status: "stopped" } });
    await expect(fs.access(path.join(logRoot, "pipeline-metrics.json"))).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(path.join(logRoot, "cancelled.json"), "utf8"))).toHaveProperty("runId", identity.runId);
   } else {
    expect(finish).toMatchObject({ value: { replyText: "最终结论" } }); expect(stop).toMatchObject({ error: { status: 409, extra: { status: "completed" } } });
    expect(JSON.parse(await fs.readFile(path.join(logRoot, "pipeline-metrics.json"), "utf8")).status).toBe("success");
    await expect(fs.access(path.join(logRoot, "cancelled.json"))).rejects.toThrow();
   }
  } finally { release.resolve(); await finishOutcome; handle.dispose(); }
 });
});
