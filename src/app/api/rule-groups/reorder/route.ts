import { z } from "zod";
import { badRequest, json, parseJson, requireSession, route } from "@/server/http/route";
import { rethrowAsBadRequest } from "@/server/rule-groups/http";
import { reorderRuleGroups } from "@/server/rule-groups/store";

export const runtime = "nodejs";

const ReorderSchema = z.object({ ids: z.unknown().optional() });

export const PUT = route(async (request) => {
  requireSession(request, "admin");
  const body = await parseJson(request, ReorderSchema);
  const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === "string") : [];
  if (ids.length === 0) throw badRequest("缺少排序 ID 列表");
  try {
    return json({ ruleGroups: await reorderRuleGroups(ids) });
  } catch (error) {
    rethrowAsBadRequest(error, "规则组排序失败");
  }
}, "规则组排序失败");
