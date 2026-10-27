import { z } from "zod";
import { json, parseJson, requireSession, route } from "@/server/http/route";
import { analyzeMeegleWorkItem, internalOrigin, type MeegleAnalyzeRequest } from "@/server/meegle/analyze";

export const runtime = "nodejs";

const idSchema = z.union([z.string(), z.number()]).transform(String);

const schema = z.object({
  workItemId: idSchema.refine(Boolean, "workItemId 为必填项"),
  workItemName: z.string().min(1, "workItemName 为必填项"),
  description: z.string().optional(),
  projectName: z.string().optional(),
  stateName: z.string().optional(),
  // 规则组配置原样透传给处理流水线，由流水线自行校验
  prompts: z.record(z.string(), z.unknown()).optional(),
  basePaths: z.record(z.string(), z.unknown()).optional(),
  modelToFiles: z.record(z.string(), z.unknown()).optional(),
  ruleGroupId: z.string().optional(),
  ruleGroupName: z.string().optional(),
  runId: z.string().optional(),
  projectKey: z.string().optional(),
  workItemTypeKey: z.string().optional(),
  rawData: z.record(z.string(), z.unknown()).optional(),
});

/** 飞书工单分析：组装上下文后转交 /api/issues/process 完整流水线 */
export const POST = route(async (request) => {
  requireSession(request);
  const body = await parseJson(request, schema);
  const result = await analyzeMeegleWorkItem(body as MeegleAnalyzeRequest, {
    origin: internalOrigin(request.headers),
    cookie: request.headers.get("cookie") || "",
  });
  return json(result);
}, "飞书工单分析失败");
