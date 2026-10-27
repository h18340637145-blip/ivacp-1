import { normalizeAssigneeUserKeys } from "@/domain/meegle/assignee";
import { HttpError, badRequest } from "@/server/http/route";
import {
  assigneeWriteClaims,
  commentWriteClaims,
  createMeegleWriteAuthorization,
  transitionWriteClaims,
  verifyMeegleAnalysisReceipt,
  verifyMeegleDetailReceipt,
} from "@/server/meegle/write-authorization";

export interface MeegleAuthorizeRequest {
  action?: "comment" | "transition" | "assignee";
  projectKey?: string;
  workItemTypeKey?: string;
  workItemId?: string;
  resultId?: string;
  body?: string;
  chartImagePath?: string;
  artifactRef?: string;
  transitionId?: string;
  analysisReceipt?: string;
  expectedCurrentUserKeys?: string[];
  targetUserKey?: string;
  detailReceipt?: string;
  assigneeRoleKey?: string;
  updatedAt?: string;
}

function forbidden(error: unknown): HttpError {
  return new HttpError(403, error instanceof Error ? error.message : String(error));
}

/**
 * 签发 2 分钟有效的飞书写操作授权（评论回填 / 状态流转 / 改经办人）。
 * 评论与流转需服务端签发的分析凭据，改经办人需工单详情凭据。
 */
export function authorizeMeegleWrite(claims: MeegleAuthorizeRequest): { authorization: string } {
  const { projectKey, workItemId } = claims;
  if (!claims.action || !projectKey || claims.workItemTypeKey !== "issue" || !workItemId) {
    throw badRequest("飞书写操作授权请求无效");
  }

  if (claims.action === "assignee") {
    const targetUserKey = claims.targetUserKey?.trim();
    const expectedCurrentUserKeys = normalizeAssigneeUserKeys(claims.expectedCurrentUserKeys ?? []);
    if (!targetUserKey || !claims.detailReceipt) throw badRequest("经办人、当前经办人和详情凭据均为必填项");
    try {
      verifyMeegleDetailReceipt(claims.detailReceipt, {
        projectKey,
        workItemTypeKey: "issue",
        workItemId,
        assigneeRoleKey: claims.assigneeRoleKey ?? "",
        assigneeUserKeys: expectedCurrentUserKeys,
        updatedAt: claims.updatedAt ?? "",
      });
    } catch (error) {
      throw forbidden(error);
    }
    return {
      authorization: createMeegleWriteAuthorization(assigneeWriteClaims({
        projectKey, workItemId, expectedCurrentUserKeys, targetUserKey, detailReceipt: claims.detailReceipt,
      })),
    };
  }

  if (claims.action !== "comment" && claims.action !== "transition") throw badRequest("不支持的飞书写操作");
  const { resultId, analysisReceipt } = claims;
  if (!resultId || !analysisReceipt) throw badRequest("飞书写操作授权请求无效");
  if (claims.action === "comment" && !claims.body?.trim()) throw badRequest("评论内容不能为空");
  if (claims.action === "transition" && !claims.transitionId) throw badRequest("transitionId 为必填项");
  try {
    verifyMeegleAnalysisReceipt(analysisReceipt, {
      projectKey,
      workItemTypeKey: "issue",
      workItemId,
      artifactRef: claims.artifactRef,
    });
  } catch (error) {
    throw forbidden(error);
  }
  const signed = claims.action === "comment"
    ? commentWriteClaims({
      projectKey, workItemId, resultId, body: claims.body ?? "",
      chartImagePath: claims.chartImagePath, artifactRef: claims.artifactRef, analysisReceipt,
    })
    : transitionWriteClaims({ projectKey, workItemId, resultId, transitionId: claims.transitionId ?? "", analysisReceipt });
  return { authorization: createMeegleWriteAuthorization(signed) };
}
