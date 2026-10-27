import { HttpError, json, parseJson, route } from "@/server/http/route";
import { processIssue } from "@/server/pipeline/process/orchestrator";
import { asProcessRequest, processRequestSchema } from "@/server/pipeline/process/request";
export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = route(async (request) => {
  const body = asProcessRequest(await parseJson(request, processRequestSchema));
  try { return json(await processIssue(body, body.source === "meegle" ? undefined : request.signal)); }
  catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(499, "分析已取消");
    throw error;
  }
}, "工单分析失败");
