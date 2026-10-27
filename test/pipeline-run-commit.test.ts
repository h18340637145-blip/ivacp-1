import { beforeEach, describe, expect, it } from "vitest";
import { registerAnalysisRun, requestAnalysisRunStopAfterCommit, resetAnalysisRunRegistryForTests } from "@/server/artifacts/analysis-run-registry";
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const identity = { runId: "commit-test", source: "meegle" as const, issueKey: "meegle-1" };
beforeEach(resetAnalysisRunRegistryForTests);
describe("run final state arbitration", () => {
 it("waits for a successful in-flight publish then rejects stop as completed", async () => {
  const handle = registerAnalysisRun(identity); const entered = deferred(); const release = deferred();
  try {
   const publishing = handle.commitSuccess(async () => { entered.resolve(); await release.promise; });
   await entered.promise; let stopped = false;
   const stop = requestAnalysisRunStopAfterCommit(identity).then(() => { stopped = true; }, (error: unknown) => error);
   await Promise.resolve(); expect(stopped).toBe(false); expect(handle.signal.aborted).toBe(false);
   release.resolve(); await publishing;
   expect(await stop).toMatchObject({ name: "AnalysisRunCompletedError" }); expect(handle.signal.aborted).toBe(false);
  } finally { handle.dispose(); }
 });
 it("allows stopping after an unsuccessful publish without marking the run complete", async () => {
  const handle = registerAnalysisRun(identity); const entered = deferred(); const release = deferred();
  try {
   const publishing = handle.commitSuccess(async () => { entered.resolve(); await release.promise; throw new Error("disk failed"); });
   const failure = publishing.catch((error: unknown) => error);
   await entered.promise;
   const stop = requestAnalysisRunStopAfterCommit(identity);
   release.resolve(); expect(await failure).toMatchObject({ message: "disk failed" });
   expect(await stop).toMatchObject({ status: "stopped" }); expect(handle.signal.aborted).toBe(true);
  } finally { handle.dispose(); }
 });
});
