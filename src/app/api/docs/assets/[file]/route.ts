import { notFound, route } from "@/server/http/route";
import { readSwaggerAsset } from "@/server/openapi/assets";
export const runtime = "nodejs";
export const GET = route(async (_request, { params }: { params: Promise<{ file: string }> }) => {
  const asset = await readSwaggerAsset((await params).file);
  if (!asset) throw notFound("文档资源不存在");
  return new Response(asset.bytes, { headers: { "Content-Type": asset.type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
});
