import { json, requireSession, route } from "@/server/http/route";
import { contextIdentity } from "@/server/meegle/context-identity";
import { meegleContextCache } from "@/server/meegle/context-view";

export const runtime = "nodejs";
export const maxDuration = 120;
export const GET = route(async request => {
  requireSession(request);
  const identity = contextIdentity(request.nextUrl.searchParams);
  return json(await meegleContextCache.get(identity, { refresh: request.nextUrl.searchParams.get("refresh") === "1" }), { headers: { "Cache-Control": "private, no-store" } });
}, "读取飞书工单上下文失败");
