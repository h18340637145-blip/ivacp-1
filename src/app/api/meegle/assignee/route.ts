import { z } from "zod";
import { badRequest, json, parseJson, requireSession, route } from "@/server/http/route";
import { updateMeegleAssignee } from "@/server/meegle/assignee";

export const runtime = "nodejs";

const schema = z.object({
  projectKey: z.string().optional(),
  workItemTypeKey: z.string().optional(),
  workItemId: z.string().optional(),
  expectedCurrentUserKeys: z.array(z.string()).optional(),
  targetUserKey: z.string().optional(),
  detailReceipt: z.string().optional(),
  authorization: z.string().optional(),
});

/** 修改飞书工单经办人（需 /api/meegle/authorize 签发的写授权） */
export const POST = route(async (request) => {
  requireSession(request);
  const body = await parseJson(request, schema);
  const projectKey = body.projectKey?.trim();
  const workItemId = body.workItemId?.trim();
  const targetUserKey = body.targetUserKey?.trim();
  if (!projectKey || body.workItemTypeKey !== "issue" || !workItemId || !targetUserKey || !body.detailReceipt) {
    throw badRequest("飞书工单身份、当前经办人、目标经办人和详情凭据均为必填项");
  }
  return json(await updateMeegleAssignee({
    projectKey,
    workItemId,
    targetUserKey,
    expectedCurrentUserKeys: body.expectedCurrentUserKeys ?? [],
    detailReceipt: body.detailReceipt,
    authorization: body.authorization,
  }));
}, "更新飞书经办人失败，请稍后重试");
