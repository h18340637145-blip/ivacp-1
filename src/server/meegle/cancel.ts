import {
  requestAnalysisRunStop,
  type AnalysisRunIdentity,
  type StopAnalysisRunResult,
} from "@/server/artifacts/analysis-run-registry";
import { HttpError, badRequest, notFound } from "@/server/http/route";
import { meegleLogBase } from "@/server/meegle/config";
import {
  hasCompleteMeegleSuccess,
  isSafeMeegleRunIdentity,
  locateMeegleRunDirectory,
  readMeegleCancellation,
  writeMeegleCancellation,
} from "@/server/meegle/run-artifacts";
import { meeglePipelineIssueKey } from "@/server/meegle/types";

/** 取消 / 恢复共用的运行身份 */
export interface MeegleRunRequest {
  runId: string;
  issueKey: string;
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
  ruleGroupName: string;
}

export interface MeegleCancelResult {
  status: "stopped";
  runId: string;
  active: boolean;
  stoppedAt: string;
}

type StopOperation = (identity: AnalysisRunIdentity) => StopAnalysisRunResult;

export interface MeegleCancelOptions {
  logBase?: string;
  requestStop?: StopOperation;
}

function stopKnownRun(identity: AnalysisRunIdentity): StopAnalysisRunResult {
  try {
    return requestAnalysisRunStop(identity);
  } catch (error) {
    // 服务重启后注册表中已无该运行：视为已停止
    if (error instanceof Error && error.message === `未找到分析运行: ${identity.runId}`) {
      return { status: "stopped", active: false, alreadyStopped: false };
    }
    throw error;
  }
}

export function isValidMeegleRunRequest(body: Partial<MeegleRunRequest>): body is MeegleRunRequest {
  return typeof body.runId === "string"
    && typeof body.issueKey === "string"
    && typeof body.projectKey === "string" && Boolean(body.projectKey.trim())
    && body.workItemTypeKey === "issue"
    && typeof body.workItemId === "string"
    && typeof body.ruleGroupName === "string" && Boolean(body.ruleGroupName.trim())
    && body.issueKey === meeglePipelineIssueKey(body.workItemId)
    && isSafeMeegleRunIdentity(body.issueKey);
}

/** 停止飞书分析运行并写入 cancelled.json（幂等：重复取消返回首次停止时间） */
export async function cancelMeegleRun(
  body: Partial<MeegleRunRequest>,
  options: MeegleCancelOptions = {},
): Promise<MeegleCancelResult> {
  const logBase = options.logBase ?? meegleLogBase();
  const requestStop = options.requestStop ?? stopKnownRun;
  if (!isValidMeegleRunRequest(body)) throw badRequest("飞书分析运行身份无效");

  let runDirectory: string | undefined;
  try {
    runDirectory = await locateMeegleRunDirectory(logBase, body);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : String(error));
  }
  if (!runDirectory) throw notFound("未找到分析运行");
  if (await hasCompleteMeegleSuccess(runDirectory, body.issueKey)) {
    throw new HttpError(409, "分析运行已完成，无法取消", { status: "completed" });
  }

  try {
    const stopped = requestStop({ runId: body.runId, source: "meegle", issueKey: body.issueKey });
    const requested = {
      runId: body.runId,
      issueKey: body.issueKey,
      stoppedAt: new Date().toISOString(),
      active: stopped.active,
    };
    await writeMeegleCancellation(runDirectory, requested);
    const cancellation = await readMeegleCancellation(runDirectory) ?? requested;
    return { status: "stopped", runId: body.runId, active: stopped.active, stoppedAt: cancellation.stoppedAt };
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : String(error));
  }
}
