import { z } from "zod";
import { json, parseJson, requireSession, route } from "@/server/http/route";
import { authorizeMeegleWrite } from "@/server/meegle/authorize";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["comment", "transition", "assignee"]).optional(),
  projectKey: z.string().optional(),
  workItemTypeKey: z.string().optional(),
  workItemId: z.string().optional(),
  resultId: z.string().optional(),
  body: z.string().optional(),
  chartImagePath: z.string().optional(),
  artifactRef: z.string().optional(),
  transitionId: z.string().optional(),
  analysisReceipt: z.string().optional(),
  expectedCurrentUserKeys: z.array(z.string()).optional(),
  targetUserKey: z.string().optional(),
  detailReceipt: z.string().optional(),
  assigneeRoleKey: z.string().optional(),
  updatedAt: z.string().optional(),
});

/** 签发飞书写操作短期授权（评论回填 / 状态流转 / 改经办人） */
export const POST = route(async (request) => {
  requireSession(request);
  return json(authorizeMeegleWrite(await parseJson(request, schema)));
}, "签发飞书写操作授权失败");
