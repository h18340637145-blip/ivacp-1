import type { TicketSnapshot } from "@/domain/entities";

/** 票号不足以区分飞书项目或 Jira 站点，列表和历史关联必须保留来源身份。 */
export function sameTicketIdentity(left: TicketSnapshot | undefined, right: TicketSnapshot): boolean {
  if (!left || left.source !== right.source || left.ticketKey !== right.ticketKey) return false;
  return left.source === "jira"
    ? (left.jiraProvider ?? "default") === (right.jiraProvider ?? "default")
    : left.projectKey === right.projectKey && left.workItemTypeKey === right.workItemTypeKey;
}
