import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpError } from "@/server/http/route";
import { recoverMeegleRun } from "@/server/meegle/recovery";

const identity = {
  runId: "missing-artifact-run",
  issueKey: "meegle-9999999999",
  projectKey: "test-project",
  workItemTypeKey: "issue" as const,
  workItemId: "9999999999",
  ruleGroupName: "missing-artifact-group",
};

const logBase = path.join(process.cwd(), "test", ".tmp-meegle-recovery-missing");

describe("飞书分析运行恢复", () => {
  it("规则组日志目录不存在时为正常 no-op", async () => {
    await expect(recoverMeegleRun(identity, { logBase })).resolves.toEqual({ recoverable: false });
  });

  it("运行身份不一致时拒绝", async () => {
    await expect(recoverMeegleRun({ ...identity, issueKey: "meegle-1" }, { logBase })).rejects.toBeInstanceOf(HttpError);
  });
});
