import { badRequest, json, route } from "@/server/http/route";
import { listTemplates, publishTemplate } from "@/server/templates/team-templates";
import { requireTemplateSession, templateAction } from "@/server/templates/route-helpers";

export const runtime = "nodejs";

/** 团队模板库列表：每个模板的最新版本 */
export const GET = route(async (request) => {
  requireTemplateSession(request);
  return json({ templates: await templateAction(() => listTemplates()) });
}, "服务端数据库不可用");

/** 发布模板（请求体为 RuleGroupTemplate）；新版本 201，配置未变化 200 */
export const POST = route(async (request) => {
  const session = requireTemplateSession(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("请求体不是有效的 JSON");
  }
  const result = await templateAction(
    () => publishTemplate(body, { username: session.username, isAdmin: session.role === "admin" }),
    "模板发布失败",
    400,
  );
  return json(result, { status: result.created ? 201 : 200 });
}, "模板发布失败");
