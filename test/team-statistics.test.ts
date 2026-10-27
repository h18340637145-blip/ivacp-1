import { describe, expect, it } from "vitest";
import { calculateAnnualStatistics } from "@/domain/analysis/annual-statistics";
import { buildStatisticsRuns, emptyRawStatisticsTables, type RawStatisticsTables } from "@/domain/analysis/statistics-records";
import { buildTeamStatistics } from "@/domain/analysis/team-statistics";

const H = 3600_000;
const now = new Date(2026, 9, 20, 12);

function tables(overrides: Partial<RawStatisticsTables>): RawStatisticsTables {
  return { ...emptyRawStatisticsTables(), ...overrides };
}

const alice = tables({
  processResults: [
    { id: "r1", source: "jira", ticketKey: "CHER-1", createdAt: "2026-07-10T08:00:00.000Z", reviewStatus: "approved", dwellMs: 2 * H },
    { id: "r2", source: "jira", ticketKey: "CHER-2", createdAt: "2026-07-11T08:00:00.000Z", reviewStatus: "rejected", dwellMs: 6 * H },
    { id: "r3", source: "jira", ticketKey: "CHER-3", createdAt: "2026-07-12T08:00:00.000Z", reviewStatus: "pending" },
  ],
});
const bob = tables({
  processResults: [
    { id: "m1", source: "meegle", ticketKey: "11", createdAt: "2026-08-01T08:00:00.000Z", reviewStatus: "approved", manualReviewedAt: "2026-08-02T00:00:00.000Z", dwellMs: 1 * H },
  ],
});
const range = { year: 2026, startMonth: 1, endMonth: 12 };

describe("团队统计", () => {
  it("提取记录与直接计算一致（历史记录不覆盖正式结果）", () => {
    const runs = buildStatisticsRuns(tables({
      processResults: alice.processResults,
      analysisHistories: [{ sourceResultId: "r1", source: "jira", ticketKey: "CHER-1", resultCreatedAt: "2026-07-10T08:00:00.000Z", reviewStatus: "rejected" }],
    }));
    const report = calculateAnnualStatistics(runs, now, range);
    expect(report.jira.processedTickets).toBe(3);
    expect(report.jira.approved).toBe(1);
  });

  it("合计等于各成员之和，并重算通过率、覆盖率与加权平均流转", () => {
    const team = buildTeamStatistics(new Map([["bob", bob], ["alice", alice]]), now, range);
    expect(team.members.map((member) => member.owner)).toEqual(["alice", "bob"]);
    const { total } = team;
    expect(total.processedTickets).toBe(4);
    expect(total.successfulRuns).toBe(4);
    expect(total.jira).toMatchObject({ processedTickets: 3, approved: 1, rejected: 1, pending: 1, rate: 50 });
    expect(total.meegle).toMatchObject({ processedTickets: 1, approved: 1, rate: 100, coverage: 100 });
    // 默认 4 小时填充：alice 三张票 2/6/4 小时，bob 一张 1 小时；恰为 4 小时的票不计入平均
    expect(total.dwell.maxDwellMs).toBe(6 * H);
    expect(total.dwell.minDwellMs).toBe(1 * H);
    expect(total.dwell.avgDwellMs).toBeCloseTo((2 + 6 + 1) / 3 * H);
    expect(total.dwell.avgSampleCount).toBe(3);
  });

  it("没有任何记录的成员不出现在明细中，空团队返回空合计", () => {
    const team = buildTeamStatistics(new Map([["idle", emptyRawStatisticsTables()]]), now, range);
    expect(team.members).toEqual([]);
    expect(team.total.processedTickets).toBe(0);
    expect(team.total.jira.rate).toBeNull();
    expect(team.total.dwell.avgDwellMs).toBeNull();
  });

  it("统计范围之外的记录不计入", () => {
    const team = buildTeamStatistics(new Map([["alice", alice]]), now, { year: 2026, startMonth: 8, endMonth: 9 });
    expect(team.total.processedTickets).toBe(0);
  });
});

