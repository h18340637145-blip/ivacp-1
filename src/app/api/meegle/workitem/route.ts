import { badRequest, json, requireSession, route } from "@/server/http/route";
import { loadMeegleWorkItem } from "@/server/meegle/work-item";

export const runtime = "nodejs";

/** 飞书工单详情：?projectKey=&workItemTypeKey=issue&workItemId= */
export const GET = route(async (request) => {
  requireSession(request);
  const params = request.nextUrl.searchParams;
  const projectKey = params.get("projectKey");
  const workItemId = params.get("workItemId");
  if (!projectKey || params.get("workItemTypeKey") !== "issue" || !workItemId) {
    throw badRequest("projectKey、workItemTypeKey=issue 和 workItemId 均为必填项");
  }
  const { body, status } = await loadMeegleWorkItem(projectKey, workItemId);
  return json(body, { status });
}, "获取飞书工单详情失败");
