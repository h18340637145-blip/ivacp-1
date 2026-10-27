import { json, notFound, parseJson, requireSession, route } from "@/server/http/route";
import { RuleGroupBodySchema, rethrowAsBadRequest } from "@/server/rule-groups/http";
import { deleteRuleGroup, getRuleGroup, updateRuleGroup } from "@/server/rule-groups/store";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = route<Params>(async (request, { params }) => {
  requireSession(request, "analyst");
  const { id } = await params;
  const ruleGroup = await getRuleGroup(id);
  if (!ruleGroup) throw notFound("规则组不存在");
  return json({ ruleGroup });
}, "规则组读取失败");

export const PUT = route<Params>(async (request, { params }) => {
  requireSession(request, "admin");
  const { id } = await params;
  const body = await parseJson(request, RuleGroupBodySchema);
  let ruleGroup;
  try {
    ruleGroup = await updateRuleGroup(id, body);
  } catch (error) {
    rethrowAsBadRequest(error, "规则组更新失败");
  }
  if (!ruleGroup) throw notFound("规则组不存在");
  return json({ ruleGroup });
}, "规则组更新失败");

export const DELETE = route<Params>(async (request, { params }) => {
  requireSession(request, "admin");
  const { id } = await params;
  if (!(await deleteRuleGroup(id))) throw notFound("规则组不存在");
  return json({ success: true });
}, "规则组删除失败");
