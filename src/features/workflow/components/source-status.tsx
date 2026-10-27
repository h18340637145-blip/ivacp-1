import type { RuleGroupSourceSummary } from "@/domain/issue-source/contracts";
import { StatusBadge } from "@/shared/ui";

export function SourceStatus({ summary }: { summary: RuleGroupSourceSummary }) {
  return <div className="space-y-2" aria-label="来源筛票状态">
    {(["jira", "meegle"] as const).map((source) => (
      <div key={source} className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">{source === "jira" ? "Jira" : "飞书项目"}</span><span className="inline-flex items-center gap-2"><span className="tabular">{summary[source].issueCount} 票</span><StatusBadge status={summary[source].status} /></span></div>
        {summary[source].error ? <p role="alert" className="break-words text-xs text-destructive">{summary[source].error}</p> : null}
      </div>
    ))}
  </div>;
}
