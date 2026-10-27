import { z } from "zod";
import { badRequest, json, parseJson, requireSession, route } from "@/server/http/route";
import { listMeegleTransitions, transitionMeegleState } from "@/server/meegle/workflow";

export const runtime = "nodejs";

function assertIdentity(projectKey?: string | null, workItemTypeKey?: string | null, workItemId?: string | null): asserts projectKey is string {
  if (!projectKey || !workItemTypeKey || !workItemId) throw badRequest("projectKey、workItemTypeKey 和 workItemId 均为必填项");
  if (workItemTypeKey !== "issue") throw badRequest("不支持的工作项类型");
}

/** 列出可流转状态：?projectKey=&workItemTypeKey=issue&workItemId= */
export const GET = route(async (request) => {
  requireSession(request);
  const params = request.nextUrl.searchParams;
  const projectKey = params.get("projectKey");
  const workItemTypeKey = params.get("workItemTypeKey");
  const workItemId = params.get("workItemId");
  assertIdentity(projectKey, workItemTypeKey, workItemId);
  return json(await listMeegleTransitions({ projectKey, workItemTypeKey: workItemTypeKey!, workItemId: workItemId! }));
}, "获取飞书可流转状态失败");

const transitionSchema = z.object({
  projectKey: z.string().optional(),
  workItemTypeKey: z.string().optional(),
  workItemId: z.string().optional(),
  resultId: z.string().optional(),
  transitionId: z.string().optional(),
  analysisReceipt: z.string().optional(),
  authorization: z.string().optional(),
});

/** 执行状态流转（需写授权） */
export const POST = route(async (request) => {
  requireSession(request);
  const body = await parseJson(request, transitionSchema);
  const { projectKey, workItemTypeKey, workItemId, transitionId, resultId, analysisReceipt } = body;
  assertIdentity(projectKey, workItemTypeKey, workItemId);
  if (!transitionId || !resultId || !analysisReceipt) throw badRequest("transitionId、resultId 和 analysisReceipt 均为必填项");
  return json(await transitionMeegleState({
    projectKey, workItemId: workItemId!, resultId, transitionId, analysisReceipt, authorization: body.authorization,
  }));
}, "飞书状态流转失败");
