import { z } from "zod";
import { badRequest, json, parseJson, requireSession, route } from "@/server/http/route";
import { fetchMeegleContext } from "@/server/meegle/context";

export const runtime = "nodejs";

const schema = z.object({
  projectKey: z.string().optional(),
  workItemTypeKey: z.string().optional(),
  workItemId: z.string().optional(),
});

/** 抓取飞书工单完整上下文（处理前快照） */
export const POST = route(async (request) => {
  requireSession(request);
  const { projectKey, workItemTypeKey, workItemId } = await parseJson(request, schema);
  if (!projectKey || !workItemTypeKey || !workItemId) throw badRequest("projectKey、workItemTypeKey 和 workItemId 均为必填项");
  if (workItemTypeKey !== "issue") throw badRequest(`不支持的工作项类型: ${workItemTypeKey}`);
  return json(await fetchMeegleContext({ projectKey, workItemTypeKey, workItemId }));
}, "获取飞书工单上下文失败");
