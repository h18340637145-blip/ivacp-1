import { z } from "zod";
import { json, parseJson, route } from "@/server/http/route";
import { reviewConclusion } from "@/server/pipeline/review/service";
export const runtime = "nodejs";
const schema = z.object({
  conclusion: z.string().trim().min(1), issueSummary: z.string(), issueKey: z.string().min(1),
  ruleGroupId: z.string().optional(), ruleGroupName: z.string().optional(), artifactRef: z.string().optional(),
  analysisContext: z.object({ issueDescription: z.string().optional(), commentsText: z.string().optional(), rawDataText: z.string().optional(), signalSummary: z.string().optional() }).optional(),
  samples: z.array(z.object({ wrongConclusion: z.string(), correctConclusion: z.string(), errorReason: z.string() })).optional(),
});
export const POST = route(async (request) => json(await reviewConclusion(await parseJson(request, schema), request.signal)), "AI 复核失败");
