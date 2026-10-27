import type { JiraAttachment } from "@/domain/issue-source/jira";

/** 飞书工单附件（评论附件 / 附件插件）沿用 Jira 附件结构，便于直接交给共用的处理流水线 */
export type IssueAttachment = JiraAttachment;

/** 处理流水线中飞书工单的 issueKey（日志目录名、运行登记），与旧版保持一致 */
export function meeglePipelineIssueKey(workItemId: string | number): string {
  return `meegle-${workItemId}`;
}
