import { z } from "zod";
import { json, parseJson, requireSession, route } from "@/server/http/route";
import { recoverMeegleRun } from "@/server/meegle/recovery";

export const runtime = "nodejs";

const schema = z.object({
  runId: z.string().optional(),
  issueKey: z.string().optional(),
  projectKey: z.string().optional(),
  workItemTypeKey: z.literal("issue").optional(),
  workItemId: z.string().optional(),
  ruleGroupName: z.string().optional(),
});

/** 从运行产物恢复已成功的飞书分析结果；不可恢复时返回 { recoverable: false } */
export const POST = route(async (request) => {
  requireSession(request);
  return json(await recoverMeegleRun(await parseJson(request, schema)));
}, "恢复飞书分析结果失败");
