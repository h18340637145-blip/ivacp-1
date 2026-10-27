import { z } from "zod";
import { json, parseQuery, requireSession, route } from "@/server/http/route";
import { runMeegleJson } from "@/server/meegle/cli";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["todo", "done", "overdue", "this_week"], { error: "action 无效" }).default("todo"),
  pageNum: z.string().regex(/^\d{1,6}$/, "pageNum 无效").refine((value) => Number(value) >= 1, "pageNum 无效").default("1"),
});

/** 我的飞书待办（透传 meegle CLI 响应） */
export const GET = route(async (request) => {
  requireSession(request);
  const { action, pageNum } = parseQuery(request, schema);
  return json(await runMeegleJson<unknown>(["mywork", "todo", "--action", action, "--page-num", pageNum]));
}, "获取飞书待办失败");
