import type { RuleGroup } from "@/domain/entities";

export type IssueSource = "jira" | "meegle";

export type SourceRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "expired"
  | "disabled";

export interface RuleGroupSourceState {
  configured: boolean;
  status: SourceRunStatus;
  issueCount: number;
  error?: string;
  updatedAt?: Date;
}

export interface RuleGroupSourceSummary {
  jira: RuleGroupSourceState;
  meegle: RuleGroupSourceState;
}

export function getConfiguredSources(
  group: Pick<RuleGroup, "jql" | "meegleMql"> & Partial<Pick<RuleGroup, "jiraProvider">>
): IssueSource[] {
  const sources: IssueSource[] = [];
  if (group.jql?.trim()) sources.push("jira");
  if (group.jiraProvider !== "bosch" && group.meegleMql?.trim()) sources.push("meegle");
  return sources;
}

export function getRuleGroupProcessEligibility(
  summary: RuleGroupSourceSummary
): boolean {
  return getProcessSources(summary).length > 0;
}

export function getProcessSources(
  summary: RuleGroupSourceSummary
): IssueSource[] {
  return (["jira", "meegle"] as const).filter((source) => {
    const state = summary[source];
    return state.status === "completed" && state.issueCount > 0;
  });
}

export function mergeRuleGroupSourceState(
  current: RuleGroupSourceSummary,
  source: IssueSource,
  next: Partial<RuleGroupSourceState>
): RuleGroupSourceSummary {
  return {
    ...current,
    [source]: {
      ...current[source],
      ...next,
    },
  };
}

export function createRuleGroupSourceSummary(
  group: Pick<RuleGroup, "jql" | "meegleMql">
): RuleGroupSourceSummary {
  const sources = new Set(getConfiguredSources(group));
  const createState = (source: IssueSource): RuleGroupSourceState => ({
    configured: sources.has(source),
    status: sources.has(source) ? "idle" : "disabled",
    issueCount: 0,
  });

  return {
    jira: createState("jira"),
    meegle: createState("meegle"),
  };
}
