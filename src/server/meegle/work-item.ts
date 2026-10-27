import {
  loadMeegleWorkItemDetail,
  type MeegleWorkItemDetail,
  type MeegleWorkItemDetailErrors,
} from "@/domain/meegle/work-item-detail";
import { getMeegleWorkItem, listMeegleComments, resolveMeegleUsersWithStatus } from "@/server/meegle/cli";
import { createMeegleDetailReceipt } from "@/server/meegle/write-authorization";

export interface MeegleWorkItemResponse {
  detail: MeegleWorkItemDetail | null;
  errors: MeegleWorkItemDetailErrors;
  /** 改经办人时用于证明“看到的当前经办人”的签名凭据 */
  detailReceipt?: string;
}

/** 读取工单详情（字段、经办人、评论及作者），附带经办人详情凭据；上游失败时 status=502 */
export async function loadMeegleWorkItem(projectKey: string, workItemId: string): Promise<{ body: MeegleWorkItemResponse; status: number }> {
  const result = await loadMeegleWorkItemDetail(
    { projectKey, workItemTypeKey: "issue", workItemId },
    {
      getWorkItem: () => getMeegleWorkItem(projectKey, workItemId),
      listComments: () => listMeegleComments(projectKey, workItemId),
      resolveUsers: resolveMeegleUsersWithStatus,
      logError: (scope, error) => {
        console.error(`[Meegle work item detail] ${scope} failed`, error);
      },
    },
  );
  const assigneeRole = result.detail?.assigneeRole;
  const detailReceipt = result.detail && assigneeRole?.key
    ? createMeegleDetailReceipt({
      projectKey,
      workItemTypeKey: "issue",
      workItemId,
      assigneeRoleKey: assigneeRole.key,
      assigneeUserKeys: assigneeRole.members.map((member) => member.key),
      updatedAt: result.detail.updatedAt,
    })
    : undefined;
  return { body: { detail: result.detail, errors: result.errors, detailReceipt }, status: result.status };
}
