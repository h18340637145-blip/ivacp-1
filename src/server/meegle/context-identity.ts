import type { MeegleWorkItemIdentity } from "@/domain/meegle/work-item-detail";
import { badRequest } from "@/server/http/route";

export function contextIdentity(params: URLSearchParams): MeegleWorkItemIdentity {
  const projectKey = params.get("projectKey") ?? "";
  const workItemId = params.get("workItemId") ?? "";
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectKey) || params.get("workItemTypeKey") !== "issue" || !/^\d{1,32}$/.test(workItemId)) {
    throw badRequest("projectKey、workItemTypeKey=issue 和数字 workItemId 均为必填项");
  }
  return { projectKey, workItemTypeKey: "issue", workItemId };
}
