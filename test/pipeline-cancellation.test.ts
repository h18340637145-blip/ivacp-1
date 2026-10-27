import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runCommandCapture } from "@/server/pipeline/download";
import { trackPipelineChild, withAnalysisRun } from "@/server/pipeline/process/runtime";
import { registerAnalysisRun, requestAnalysisRunStop } from "@/server/artifacts/analysis-run-registry";

describe("pipeline cancellation", () => {
 it("terminates an actual command when the request aborts", async () => {
  const controller = new AbortController();
  const started = Date.now();
  await withAnalysisRun(undefined, async () => {
   const running = runCommandCapture(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
   const timer = setTimeout(() => controller.abort(), 30);
   try { await expect(running).rejects.toThrow(); }
   finally { clearTimeout(timer); }
  }, controller.signal);
  expect(Date.now() - started).toBeLessThan(2_000);
 });
 it("terminates child processes when a Jira request disconnects", async () => {
  const controller = new AbortController();
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
  await withAnalysisRun(undefined, async () => {
   trackPipelineChild(child);
   controller.abort();
   expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  }, controller.signal);
 });
 it("registers children for the Meegle stop API and releases completed children", async () => {
  const identity = { runId: `test-${Date.now()}`, source: "meegle" as const, issueKey: "meegle-1" };
  const handle = registerAnalysisRun(identity);
  try {
   const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
   await withAnalysisRun(handle, async () => {
    trackPipelineChild(child); child.emit("close"); requestAnalysisRunStop(identity);
    expect(child.kill).not.toHaveBeenCalled(); expect(handle.signal.aborted).toBe(true);
   });
  } finally { handle.dispose(); }
 });
});
