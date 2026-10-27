import { buildAssigneeRoleOperate, normalizeAssigneeUserKeys } from "@/domain/meegle/assignee";
import { normalizeMeegleWorkItemDetail } from "@/domain/meegle/work-item-detail";
import { HttpError } from "@/server/http/route";
import { getMeegleWorkItem, resolveMeegleUsers, updateMeegleWorkItemRole } from "@/server/meegle/cli";
import { assigneeWriteClaims, verifyMeegleWriteAuthorization } from "@/server/meegle/write-authorization";

export interface MeegleAssigneeRequest {
  projectKey: string;
  workItemId: string;
  expectedCurrentUserKeys: string[];
  targetUserKey: string;
  detailReceipt: string;
  authorization?: string;
}

/**
 * 修改飞书工单经办人：校验写授权 → 重新读取工单比对当前经办人（乐观锁）→ 校验目标用户 → 更新角色。
 * 当前经办人已是目标用户时返回 changed=false。
 */
export async function updateMeegleAssignee(input: MeegleAssigneeRequest): Promise<{ success: true; changed: boolean }> {
  const { projectKey, workItemId, targetUserKey } = input;
  const expectedCurrentUserKeys = normalizeAssigneeUserKeys(input.expectedCurrentUserKeys);
  try {
    verifyMeegleWriteAuthorization(input.authorization, assigneeWriteClaims({
      projectKey,
      workItemId,
      expectedCurrentUserKeys,
      targetUserKey,
      detailReceipt: input.detailReceipt,
    }));
  } catch (error) {
    throw new HttpError(403, error instanceof Error ? error.message : "飞书写操作授权无效");
  }

  try {
    const workItem = await getMeegleWorkItem(projectKey, workItemId);
    const detail = normalizeMeegleWorkItemDetail({
      identity: { projectKey, workItemTypeKey: "issue", workItemId },
      workItem,
    });
    const assigneeRole = detail.assigneeRole;
    if (!assigneeRole?.key) throw new HttpError(409, "当前工单未找到经办人角色，请刷新后重试");
    const currentUserKeys = normalizeAssigneeUserKeys(assigneeRole.members.map((member) => member.key));
    if (JSON.stringify(currentUserKeys) !== JSON.stringify(expectedCurrentUserKeys)) {
      throw new HttpError(409, "经办人已被其他人修改，请刷新后重新确认");
    }
    const roleOperate = buildAssigneeRoleOperate(assigneeRole.key, currentUserKeys, targetUserKey);
    if (roleOperate.length === 0) return { success: true, changed: false };
    const users = await resolveMeegleUsers([targetUserKey]);
    if (!users.some((user) => user.key === targetUserKey)) throw new HttpError(502, "目标经办人不可用，请重新搜索后确认");
    await updateMeegleWorkItemRole(projectKey, workItemId, roleOperate);
    return { success: true, changed: true };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("[Meegle assignee] update failed", error);
    throw new HttpError(502, "更新飞书经办人失败，请稍后重试");
  }
}
