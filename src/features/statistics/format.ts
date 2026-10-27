import type { AnnualStatistics, SourceStatistics } from "@/domain/analysis/annual-statistics";

/** 流转时间：「X 天 Y 小时 Z 分」，与统计报告口径一致 */
export function dwellText(ms: number | null): string {
  if (ms === null) return "暂无数据";
  const totalMinutes = Math.round(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes} 分`;
}

export function tokenText(value: number | null): string {
  return value === null ? "暂无数据" : Math.round(value).toLocaleString("zh-CN");
}

/** rate / coverage 已是百分数（0–100） */
export function percentText(value: number | null): string {
  return value === null ? "暂无数据" : `${value.toFixed(2)}%`;
}

export function rangeLabel(range: { startMonth: number; endMonth: number }): string {
  return range.startMonth === 1 && range.endMonth === 12 ? "全年" : `${range.startMonth}–${range.endMonth} 月`;
}

/** 成员复核覆盖率 =（通过 + 驳回）÷ 处理票数 */
export function memberCoverage(statistics: AnnualStatistics): number | null {
  const reviewed = statistics.jira.approved + statistics.jira.rejected + statistics.meegle.approved + statistics.meegle.rejected;
  return statistics.processedTickets ? (reviewed / statistics.processedTickets) * 100 : null;
}

export interface ReviewSegment {
  key: "approved" | "rejected" | "pending" | "unconfirmed";
  label: string;
  value: number;
  /** 占处理票数的比例（0–1） */
  ratio: number;
}

/** 来源复核构成（处理票数 = 通过 + 驳回 + 未复核 + 无法确认），用于堆叠条形图 */
export function reviewSegments(stats: SourceStatistics): ReviewSegment[] {
  const total = stats.processedTickets;
  const items: Array<[ReviewSegment["key"], string, number]> = [
    ["approved", "复核通过", stats.approved],
    ["rejected", "复核驳回", stats.rejected],
    ["pending", "未复核", stats.pending],
    ["unconfirmed", "无法确认人工复核", stats.unconfirmed],
  ];
  return items.map(([key, label, value]) => ({ key, label, value, ratio: total ? value / total : 0 }));
}

/** 服务端返回的 JSON 中 generatedAt 为字符串，还原为 Date */
export function reviveStatistics(statistics: AnnualStatistics): AnnualStatistics {
  return { ...statistics, generatedAt: new Date(statistics.generatedAt) };
}
