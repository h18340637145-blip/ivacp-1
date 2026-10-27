import { HttpError, badRequest, json, notFound, route } from "@/server/http/route";
import { deleteTemplate, getTemplate } from "@/server/templates/team-templates";
import { requireTemplateSession, templateAction } from "@/server/templates/route-helpers";

export const runtime = "nodejs";

/** 读取模板（默认最新版本）：?version=<n> */
export const GET = route<{ key: string }>(async (request, context) => {
  requireTemplateSession(request);
  const { key } = await context.params;
  const versionParam = request.nextUrl.searchParams.get("version");
  const version = versionParam ? Number(versionParam) : undefined;
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) throw badRequest("版本号无效");
  const template = await templateAction(() => getTemplate(decodeURIComponent(key), version));
  if (!template) throw notFound("模板不存在");
  return json({ template });
}, "服务端数据库不可用");

/** 软删除模板全部版本；仅作者或管理员 */
export const DELETE = route<{ key: string }>(async (request, context) => {
  const session = requireTemplateSession(request);
  const { key } = await context.params;
  const result = await templateAction(() =>
    deleteTemplate(decodeURIComponent(key), { username: session.username, isAdmin: session.role === "admin" }),
  );
  if (result === "not_found") throw notFound("模板不存在");
  if (result === "forbidden") throw new HttpError(403, "只有作者或管理员可以删除模板");
  return json({ ok: true });
}, "服务端数据库不可用");
