import { z } from "zod";
import { json, parseJson, requireSession, route } from "@/server/http/route";
import { autoAssignMeegleWorkItems } from "@/server/meegle/auto-assign";

export const runtime = "nodejs";

const schema = z.object({
  ruleGroups: z.array(z.object({
    id: z.string(),
    name: z.string(),
    model_to_files: z.record(z.string(), z.unknown()).optional(),
  })),
  filterRuleGroupId: z.string().optional(),
  manualAssignments: z.array(z.object({
    projectKey: z.string(),
    workItemTypeKey: z.string(),
    workItemId: z.number(),
  })).optional(),
});

/** 模型识别“我的待办”工作项的车型/项目/平台并自动归属规则组 */
export const POST = route(async (request) => {
  requireSession(request);
  return json(await autoAssignMeegleWorkItems(await parseJson(request, schema)));
}, "飞书自动分配失败");
