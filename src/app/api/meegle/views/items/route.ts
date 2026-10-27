import { z } from "zod";
import { json, parseQuery, requireSession, route } from "@/server/http/route";
import { runMeegleJson } from "@/server/meegle/cli";
import { meegleDefaultProjectKey } from "@/server/meegle/config";

export const runtime = "nodejs";

const schema = z.object({
  viewId: z.string({ error: "viewId 为必填项" }).min(1, "viewId 为必填项"),
  pageNum: z.string().regex(/^\d{1,6}$/, "pageNum 无效").refine((value) => Number(value) >= 1, "pageNum 无效").default("1"),
});

/** 读取飞书视图中的工作项（透传 meegle CLI 响应） */
export const GET = route(async (request) => {
  requireSession(request);
  const { viewId, pageNum } = parseQuery(request, schema);
  return json(await runMeegleJson<unknown>([
    "view", "get", "--project-key", meegleDefaultProjectKey(), "--view-id", viewId, "--page-num", pageNum,
  ]));
}, "读取飞书视图工作项失败");
