import { badRequest, json, notFound, route } from "@/server/http/route";
import { markTemplateApplied } from "@/server/templates/team-templates";
import { requireTemplateSession, templateAction } from "@/server/templates/route-helpers";

export const runtime = "nodejs";

/** 记录模板被应用一次：body { version } */
export const POST = route<{ key: string }>(async (request, context) => {
  requireTemplateSession(request);
  const { key } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { version?: unknown };
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) throw badRequest("版本号无效");
  const ok = await templateAction(() => markTemplateApplied(decodeURIComponent(key), version));
  if (!ok) throw notFound("模板不存在");
  return json({ ok: true });
}, "服务端数据库不可用");
