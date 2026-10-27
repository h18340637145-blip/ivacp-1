import { runMeegleJson } from "@/server/meegle/cli";
import { meegleOperatorUserKey } from "@/server/meegle/config";
import { transitionWriteClaims, verifyMeegleWriteAuthorization } from "@/server/meegle/write-authorization";

export interface MeegleTransitionList {
  transitions: unknown[];
  state_key?: string;
  state_name?: string;
}

/** 列出工作项当前状态可流转的目标状态 */
export async function listMeegleTransitions(identity: {
  projectKey: string;
  workItemTypeKey: string;
  workItemId: string;
}): Promise<MeegleTransitionList> {
  const data = await runMeegleJson<{ transition?: unknown[]; state_key?: string; state_name?: string }>([
    "workflow", "list-state-transitions",
    "--project-key", identity.projectKey,
    "--work-item-id", identity.workItemId,
    "--work-item-type", identity.workItemTypeKey,
    "--user-key", meegleOperatorUserKey(),
  ]);
  const transitions = Array.isArray(data?.transition) ? data.transition : [];
  return { transitions, state_key: data?.state_key, state_name: data?.state_name };
}

/** 校验写授权后执行状态流转 */
export async function transitionMeegleState(input: {
  projectKey: string;
  workItemId: string;
  resultId: string;
  transitionId: string;
  analysisReceipt: string;
  authorization?: string;
}): Promise<{ success: true; data: unknown }> {
  verifyMeegleWriteAuthorization(input.authorization, transitionWriteClaims(input));
  const data = await runMeegleJson<unknown>([
    "workflow", "transition-state",
    "--project-key", input.projectKey,
    "--work-item-id", input.workItemId,
    "--transition-id", input.transitionId,
  ]);
  return { success: true, data };
}
