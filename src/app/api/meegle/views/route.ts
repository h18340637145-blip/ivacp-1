import { z } from "zod";
import { json, parseQuery, requireSession, route } from "@/server/http/route";
import { runMeegleJson } from "@/server/meegle/cli";
import { meegleDefaultProjectKey } from "@/server/meegle/config";

export const runtime = "nodejs";

const schema = z.object({
  keyword: z.string().optional(),
  scope: z.string().optional(),
});

/** 按关键字搜索飞书视图 */
export const GET = route(async (request) => {
  requireSession(request);
  const query = parseQuery(request, schema);
  const views = await runMeegleJson<unknown>([
    "view", "search",
    "--project-key", meegleDefaultProjectKey(),
    "--view-scope", query.scope || "issue",
    "--key-word", query.keyword || "个人",
  ]);
  return json({ views });
}, "搜索飞书视图失败");
