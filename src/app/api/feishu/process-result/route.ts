import { z } from "zod";
import { notifyProcessResult } from "@/server/feishu/process-result";
import { json, parseJson, route } from "@/server/http/route";
export const runtime = "nodejs";
const schema = z.object({
  source: z.enum(["jira", "meegle"]).optional(), ruleGroupName: z.string().min(1), issueKey: z.string().min(1), issueUrl: z.string().optional(),
  issueSummary: z.string().min(1), issueDescription: z.string().optional(), status: z.enum(["success", "failed"]), replyText: z.string().optional(), failureReason: z.string().optional(), chartImagePath: z.string().optional(), origin: z.string().optional(), processedAt: z.string().optional(),
});
export const POST = route(async (request) => json(await notifyProcessResult(await parseJson(request, schema))), "发送飞书通知失败");
