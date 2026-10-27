import type { SourceStatistics } from "@/domain/analysis/annual-statistics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import { dwellText, percentText, tokenText } from "../format";
import { ReviewBar } from "./review-bar";

interface SourceSummaryProps {
  title: string;
  description: string;
  stats: SourceStatistics;
  rateLabel: string;
}

/** 单一来源（Jira / 飞书项目）的完整指标 */
export function SourceSummary({ title, description, stats, rateLabel }: SourceSummaryProps) {
  const metrics: Array<[string, string | number]> = [
    ["处理票数", stats.processedTickets],
    ["成功分析次数", stats.successfulRuns],
    ["复核通过", stats.approved],
    ["复核驳回", stats.rejected],
    ["未复核", stats.pending],
    ["无法确认人工复核", stats.unconfirmed],
    [rateLabel, percentText(stats.rate)],
    ["复核覆盖率", percentText(stats.coverage)],
    ["最大流转时间", dwellText(stats.maxDwellMs)],
    ["最小流转时间", dwellText(stats.minDwellMs)],
    ["平均流转时间", dwellText(stats.avgDwellMs)],
    ["最大 Token", tokenText(stats.maxTokens)],
    ["每张票平均 Token", tokenText(stats.avgTokens)],
    ["工作时间转入票数", stats.workHoursHandovers],
    ["非工作时间转入票数", stats.offHoursHandovers],
  ];
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ReviewBar stats={stats} label={title} />
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-1.5 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
