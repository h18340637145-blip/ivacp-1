import type { SourceStatistics } from "@/domain/analysis/annual-statistics";
import { Tooltip } from "@/shared/ui";
import { cn } from "@/shared/lib/cn";
import { reviewSegments, type ReviewSegment } from "../format";

const SEGMENT_CLASS: Record<ReviewSegment["key"], string> = {
  approved: "bg-success",
  rejected: "bg-destructive",
  pending: "bg-warning",
  unconfirmed: "bg-purple",
};

/** 复核构成堆叠条：图例 + 悬停提示；精确数字见下方指标表（表格替代） */
export function ReviewBar({ stats, label }: { stats: SourceStatistics; label: string }) {
  const segments = reviewSegments(stats);
  const summary = segments.map((segment) => `${segment.label} ${segment.value}`).join("，");
  return (
    <figure className="space-y-2">
      <div
        role="img"
        aria-label={`${label}复核构成：处理 ${stats.processedTickets} 张，${summary}`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3"
      >
        {stats.processedTickets > 0
          ? segments
              .filter((segment) => segment.value > 0)
              .map((segment) => (
                <Tooltip key={segment.key} content={`${segment.label}：${segment.value} 张（${(segment.ratio * 100).toFixed(1)}%）`}>
                  <span
                    tabIndex={0}
                    className={cn("h-full outline-none focus-visible:opacity-80", SEGMENT_CLASS[segment.key])}
                    style={{ width: `${segment.ratio * 100}%` }}
                  />
                </Tooltip>
              ))
          : null}
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {segments.map((segment) => (
            <li key={segment.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-sm", SEGMENT_CLASS[segment.key])} />
              {segment.label}
              <span className="tabular text-foreground">{segment.value}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
