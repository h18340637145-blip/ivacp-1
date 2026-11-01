import { notFound, requireSession, route } from "@/server/http/route";
import { contextIdentity } from "@/server/meegle/context-identity";
import { meegleContextCache } from "@/server/meegle/context-view";

export const runtime = "nodejs";
export const GET = route(async request => {
  requireSession(request);
  const identity = contextIdentity(request.nextUrl.searchParams);
  const image = await meegleContextCache.readImage(identity, request.nextUrl.searchParams.get("imageId") ?? "");
  if (!image) throw notFound("图片尚未缓存或已不可用，请刷新原票详情重试");
  return new Response(new Uint8Array(image.bytes), { headers: {
    "Content-Type": image.mime, "Content-Length": String(image.bytes.length),
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}, "读取工单缓存图片失败");
