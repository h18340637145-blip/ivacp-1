import { json, parseJson, requireSession, route } from "@/server/http/route";
import { RuleGroupBodySchema, rethrowAsBadRequest } from "@/server/rule-groups/http";
import { createRuleGroup, readRuleGroups } from "@/server/rule-groups/store";

export const runtime = "nodejs";

export const GET = route(async (request) => {
  requireSession(request, "analyst");
  return json({ ruleGroups: await readRuleGroups() });
}, "规则组读取失败");

export const POST = route(async (request) => {
  requireSession(request, "admin");
  const body = await parseJson(request, RuleGroupBodySchema);
  try {
    const ruleGroup = await createRuleGroup(body);
    return json({ ruleGroup }, { status: 201 });
  } catch (error) {
    rethrowAsBadRequest(error, "规则组创建失败");
  }
}, "规则组创建失败");
