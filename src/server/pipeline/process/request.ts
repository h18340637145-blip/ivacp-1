import { REJECT_REASON_CODES } from "@/domain/analysis/reject-reasons";
import { z } from "zod";
import type { ProcessRequest } from "@/server/pipeline/types";
const modelFile = z.object({
  aliases: z.array(z.string()).optional(),
  json: z.union([z.string(), z.array(z.string())]).transform((value) => Array.isArray(value) ? JSON.stringify(value) : value),
  dbc: z.union([z.string(), z.array(z.string())]).transform((value) => {
    if (Array.isArray(value)) return value;
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((file) => typeof file === "string")) return parsed as string[];
    } catch { /* 兼容单个文件名。 */ }
    return [value];
  }),
  proto: z.string(),
});
export const processRequestSchema = z.object({
  issueKey: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/, "工单标识无效"),
  summary: z.string(), rawData: z.record(z.string(), z.unknown()),
  prompts: z.object({ REQUIREMENT_EXTRACT_SYSTEM: z.string().optional(), EXTRACT_SIGNALS_SYSTEM: z.string().optional(), LOG_SUMMARY_SYSTEM: z.string().optional(), ANDROID_QNX_LOG_SUMMARY_SYSTEM: z.string().optional(), CONSISTENCY_SYSTEM: z.string().optional(), COMPARE_CANTRACE: z.string().optional() }),
  basePaths: z.object({ json_dir: z.string(), dbc_dir: z.string(), proto_dir: z.string() }).optional(),
  modelToFiles: z.record(z.string(), modelFile).optional(), expand: z.string().optional(),
  ruleGroupId: z.string().trim().min(1), ruleGroupName: z.string().trim().min(1).optional(),
  source: z.enum(["jira", "meegle"]).optional(), jiraProvider: z.enum(["default", "bosch"]).optional(),
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).optional(),
  fewShotSamples: z.array(z.object({ issueKey: z.string(), ticketKey: z.string().optional(), issueSummary: z.string(), sampleKind: z.enum(["correction", "approved"]).optional(), approvedConclusion: z.string().optional(), wrongConclusion: z.string(), correctConclusion: z.string(), errorReason: z.string(), errorCategory: z.enum(REJECT_REASON_CODES).optional(), carModel: z.string().optional(), props: z.array(z.string()).optional(), signalTokens: z.array(z.string()).optional(), propertyIds: z.array(z.string()).optional(), relevanceScore: z.number().optional() })).optional(),
  errorPatterns: z.array(z.object({ code: z.enum(REJECT_REASON_CODES), label: z.string(), count: z.number().nonnegative(), share: z.number().min(0).max(1), checklist: z.string(), scope: z.enum(["car_model", "rule_group"]) })).optional(),
}).superRefine((body, ctx) => {
  if (body.source === "meegle" && (!body.issueKey.startsWith("meegle-") || typeof body.rawData.projectKey !== "string" || typeof body.rawData.workItemId !== "string" || body.issueKey !== `meegle-${body.rawData.workItemId}`)) {
    ctx.addIssue({ code: "custom", message: "飞书工单身份与 issueKey 不匹配" });
  }
});

export function asProcessRequest(body: z.infer<typeof processRequestSchema>): ProcessRequest {
  return body;
}
