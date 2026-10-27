import type { JiraProvider, RuleGroup, TicketSnapshot } from "@/domain/entities";

/** 优先采用快照中的不可变站点；旧快照必须保留原规则组才能确认来源。 */
export function jiraProviderForSnapshot(snapshot: Pick<TicketSnapshot, "jiraProvider">, group?: Pick<RuleGroup, "jiraProvider">): JiraProvider | undefined {
  const provider = snapshot.jiraProvider ?? (group ? group.jiraProvider ?? "default" : undefined);
  if (!provider) throw new Error("原规则组已删除，无法确认 Jira 来源；请恢复原配置后再操作");
  return provider === "bosch" ? "bosch" : undefined;
}
