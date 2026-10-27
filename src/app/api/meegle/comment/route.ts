import { z } from "zod";
import { HttpError, badRequest, json, parseJson, requireSession, route } from "@/server/http/route";
import { backfillMeegleComment } from "@/server/meegle/comment";
import { commentWriteClaims, verifyMeegleWriteAuthorization } from "@/server/meegle/write-authorization";

export const runtime = "nodejs";

const schema = z.object({
  projectKey: z.string().optional(),
  workItemTypeKey: z.string().optional(),
  workItemId: z.string().optional(),
  resultId: z.string().optional(),
  body: z.string().optional(),
  chartImagePath: z.string().optional(),
  artifactRef: z.string().optional(),
  analysisReceipt: z.string().optional(),
  authorization: z.string().optional(),
});

/** 把复核后的分析结论回填为飞书评论（幂等：同一结果只回填一次） */
export const POST = route(async (request) => {
  requireSession(request);
  const input = await parseJson(request, schema);
  const { projectKey, workItemTypeKey, workItemId, resultId, body } = input;
  if (!projectKey || !workItemTypeKey || !workItemId || !resultId || !body?.trim()) {
    throw badRequest("projectKey、workItemTypeKey、workItemId、resultId 和 body 均为必填项");
  }
  if (workItemTypeKey !== "issue") throw badRequest("不支持的工作项类型");
  if (!input.analysisReceipt) throw badRequest("analysisReceipt 为必填项");
  try {
    verifyMeegleWriteAuthorization(input.authorization, commentWriteClaims({
      projectKey, workItemId, resultId, body,
      chartImagePath: input.chartImagePath, artifactRef: input.artifactRef, analysisReceipt: input.analysisReceipt,
    }));
    return json(await backfillMeegleComment({
      projectKey, workItemId, resultId, body, chartImagePath: input.chartImagePath, artifactRef: input.artifactRef,
    }));
  } catch (error) {
    throw new HttpError(500, error instanceof Error ? error.message : String(error));
  }
}, "飞书评论回填失败");
