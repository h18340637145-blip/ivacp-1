import { describe, expect, it } from "vitest";
import { calculateAnnualStatistics, type StatisticsRun } from "@/domain/analysis/annual-statistics";
import { isWorkingHoursInChina } from "@/domain/analysis/handover";
import { buildStatisticsRuns, emptyRawStatisticsTables } from "@/domain/analysis/statistics-records";
import { buildTeamStatistics } from "@/domain/analysis/team-statistics";
import { buildMeegleWorkItemUrl } from "@/domain/meegle/work-item-url";

const now = new Date(2026, 9, 20, 12);
const run = (id: string, processedAt: string, extra: Partial<StatisticsRun>): StatisticsRun => ({
  source: "jira", resultId: id, ticketKey: id, processedAt, reviewStatus: "pending", ...extra,
});

describe("接手时段", () => {
  it("周一至周五 9:00–19:00（东八区）为工作时间，其余含周末为非工作时间", () => {
    expect(isWorkingHoursInChina(Date.parse("2026-07-06T01:00:00Z"))).toBe(true); // 周一 09:00
    expect(isWorkingHoursInChina(Date.parse("2026-07-06T10:59:00Z"))).toBe(true); // 周一 18:59
    expect(isWorkingHoursInChina(Date.parse("2026-07-06T11:00:00Z"))).toBe(false); // 周一 19:00
    expect(isWorkingHoursInChina(Date.parse("2026-07-06T00:59:00Z"))).toBe(false); // 周一 08:59
    expect(isWorkingHoursInChina(Date.parse("2026-07-11T02:00:00Z"))).toBe(false); // 周六 10:00
    expect(isWorkingHoursInChina(Date.parse("2026-07-12T02:00:00Z"))).toBe(false); // 周日 10:00
  });
});

describe("Token 与接手时段统计", () => {
  const records = [
    run("a", "2026-07-06T03:00:00Z", { tokenUsage: 1000, handoverAt: "2026-07-06T02:00:00Z" }),
    run("b", "2026-07-07T03:00:00Z", { tokenUsage: 3000, handoverAt: "2026-07-11T02:00:00Z" }),
    run("c", "2026-08-07T03:00:00Z", { tokenUsage: 9000, handoverAt: "2026-08-06T12:00:00Z" }),
    run("d", "2026-07-08T03:00:00Z", {}),
  ];

  it("统计最大/平均 token 与工作/非工作时间接手票数，并支持月份区间", () => {
    const july = calculateAnnualStatistics(records, now, { year: 2026, startMonth: 7, endMonth: 7 });
    expect(july.tokens).toMatchObject({ maxTokens: 3000, avgTokens: 2000, totalTokens: 4000, tokenSampleCount: 2 });
    expect(july.handover).toEqual({ workHoursHandovers: 1, offHoursHandovers: 1, unknownHandovers: 1 });
    const all = calculateAnnualStatistics(records, now, { year: 2026, startMonth: 7, endMonth: 8 });
    expect(all.tokens.maxTokens).toBe(9000);
    expect(all.handover.offHoursHandovers).toBe(2);
  });

  it("同票只取最后一次分析的 token", () => {
    const stats = calculateAnnualStatistics([
      run("x1", "2026-07-06T03:00:00Z", { ticketKey: "T", tokenUsage: 100 }),
      run("x2", "2026-07-07T03:00:00Z", { ticketKey: "T", tokenUsage: 500 }),
    ], now, { year: 2026, startMonth: 1, endMonth: 12 });
    expect(stats.tokens).toMatchObject({ maxTokens: 500, avgTokens: 500, tokenSampleCount: 1 });
  });

  it("团队合并按样本数加权平均 token，并累加时段票数", () => {
    const one = { ...emptyRawStatisticsTables(), processResults: [
      { id: "r1", source: "jira" as const, ticketKey: "A-1", createdAt: "2026-07-06T03:00:00Z", reviewStatus: "pending" as const, tokenUsage: 1000, handoverAt: "2026-07-06T02:00:00Z" },
    ] };
    const two = { ...emptyRawStatisticsTables(), processResults: [
      { id: "r2", source: "jira" as const, ticketKey: "B-1", createdAt: "2026-07-06T03:00:00Z", reviewStatus: "pending" as const, tokenUsage: 5000, handoverAt: "2026-07-06T12:00:00Z" },
      { id: "r3", source: "jira" as const, ticketKey: "B-2", createdAt: "2026-07-06T04:00:00Z", reviewStatus: "pending" as const, tokenUsage: 3000, handoverAt: "2026-07-06T12:30:00Z" },
    ] };
    const { total } = buildTeamStatistics(new Map([["a", one], ["b", two]]), now, { year: 2026, startMonth: 1, endMonth: 12 });
    expect(total.tokens).toMatchObject({ maxTokens: 5000, avgTokens: 3000, tokenSampleCount: 3 });
    expect(total.handover).toEqual({ workHoursHandovers: 1, offHoursHandovers: 2, unknownHandovers: 0 });
  });

  it("历史记录没有 token 与接手时间", () => {
    const runs = buildStatisticsRuns({ ...emptyRawStatisticsTables(), analysisHistories: [
      { sourceResultId: "h1", source: "jira" as const, ticketKey: "H-1", resultCreatedAt: "2026-07-06T03:00:00Z", reviewStatus: "pending" },
    ] });
    const stats = calculateAnnualStatistics(runs, now, { year: 2026, startMonth: 1, endMonth: 12 });
    expect(stats.tokens.maxTokens).toBeNull();
    expect(stats.handover.unknownHandovers).toBe(1);
  });
});

describe("飞书原票链接", () => {
  it("使用空间 simple_name，未配置时回退 projectKey", () => {
    const identity = { projectKey: "abc", workItemTypeKey: "issue", workItemId: 123 };
    expect(buildMeegleWorkItemUrl(identity, { simpleName: "pojw7j" })).toBe("https://project.feishu.cn/pojw7j/issue/detail/123");
    expect(buildMeegleWorkItemUrl(identity, {})).toBe("https://project.feishu.cn/abc/issue/detail/123");
  });
});
