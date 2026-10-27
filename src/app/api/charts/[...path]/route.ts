import { readChart } from "@/server/charts/files";
import { requireSession, route } from "@/server/http/route";
export const runtime = "nodejs";
export const GET = route<{ path: string[] }>(async (request, { params }) => {
  requireSession(request);
  const { path } = await params;
  const bytes = await readChart(`/api/charts/${path.join("/")}`);
  return new Response(bytes as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}, "读取图片失败");
