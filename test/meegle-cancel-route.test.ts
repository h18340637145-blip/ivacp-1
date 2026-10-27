import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HttpError } from "@/server/http/route";
import { cancelMeegleRun } from "@/server/meegle/cancel";

const identity = {
  runId: "run-old",
  issueKey: "meegle-7073862958",
  projectKey: "test-project",
  workItemTypeKey: "issue" as const,
  workItemId: "7073862958",
  ruleGroupName: "chery-8155-others",
};

// 不使用系统临时目录，产物写在仓库内并在结束后清理
const logBase = path.join(process.cwd(), "test", `.tmp-meegle-cancel-${process.pid}`);
const issueDirectory = path.join(logBase, "chery-8155-others", "T1L_FL2_8155_ICE国内", "meegle-7073862958");
const runDirectory = path.join(issueDirectory, "run-old");
const completeDirectory = path.join(issueDirectory, "run-complete");

afterAll(async () => {
  await fs.rm(logBase, { recursive: true, force: true });
});

async function expectHttpError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(status);
  return error as HttpError;
}

describe("飞书分析运行取消", () => {
  it("部分产物可取消、重复取消幂等、完成运行 409、身份不一致 400", async () => {
    await fs.mkdir(runDirectory, { recursive: true });
    await fs.writeFile(path.join(runDirectory, "step1_requirements.md"), "partial artifact", "utf8");
    await fs.mkdir(completeDirectory, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(completeDirectory, "pipeline-metrics.json"), JSON.stringify({ status: "success", issueKey: identity.issueKey }), "utf8"),
      fs.writeFile(path.join(completeDirectory, "final_reply.md"), "completed reply", "utf8"),
    ]);

    let stopCalls = 0;
    const options = {
      logBase,
      requestStop: () => {
        stopCalls += 1;
        return { status: "stopped" as const, active: false, alreadyStopped: false };
      },
    };

    const stopped = await cancelMeegleRun(identity, options);
    expect({ status: stopped.status, runId: stopped.runId, active: stopped.active })
      .toEqual({ status: "stopped", runId: identity.runId, active: false });
    expect(stopped.stoppedAt).toBeTruthy();
    const cancelled = JSON.parse(await fs.readFile(path.join(runDirectory, "cancelled.json"), "utf8")) as { runId: string; stoppedAt: string };
    expect(cancelled.runId).toBe(identity.runId);
    expect(cancelled.stoppedAt).toBe(stopped.stoppedAt);

    const repeated = await cancelMeegleRun(identity, options);
    expect(repeated.stoppedAt).toBe(stopped.stoppedAt);

    const completed = await expectHttpError(cancelMeegleRun({ ...identity, runId: "run-complete" }, options), 409);
    expect(completed.extra).toEqual({ status: "completed" });

    await expectHttpError(cancelMeegleRun({ ...identity, issueKey: "meegle-123" }, options), 400);
    await expectHttpError(cancelMeegleRun({ ...identity, runId: "run-missing" }, options), 404);
    expect(stopCalls).toBe(2);
  });
});
