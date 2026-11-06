import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { calculateAnnualStatistics } from "@/domain/analysis/annual-statistics";
import { buildStatisticsAttempts, buildStatisticsRuns, type RawStatisticsTables } from "@/domain/analysis/statistics-records";
import { buildTeamStatistics } from "@/domain/analysis/team-statistics";
import { buildStatisticsReport } from "@/domain/analysis/weekly-report";
import { groupStatisticsRows } from "@/server/statistics/team-statistics";
import { IvacpDatabase } from "@/shared/db/database";
import { loadLocalStatistics } from "@/features/statistics/load-local-statistics";

const { databaseName } = vi.hoisted(() => ({ databaseName: `statistics-attempts-${Date.now()}` }));
vi.mock("@/shared/db/database", async importOriginal => {
  const actual = await importOriginal<typeof import("@/shared/db/database")>();
  return { ...actual, db: new actual.IvacpDatabase(databaseName) };
});

const range = { year: 2026, startMonth: 9, endMonth: 9 };
const now = new Date("2026-10-01T00:00:00Z");
const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T04:00:00Z`);

function tables(): RawStatisticsTables {
  return {
    snapshots: [
      { id: "s1", source: "meegle", projectKey: "p", workItemTypeKey: "issue", workItemId: 7 },
      { id: "s2", source: "meegle", projectKey: "p", workItemTypeKey: "issue", workItemId: 7 },
    ],
    processTasks: [
      // J-1 分析两次：第一次失败，第二次成功
      { id: "t1", source: "jira", ticketKey: "J-1", createdAt: at(1) },
      { id: "t2", source: "jira", ticketKey: "J-1", createdAt: at(2) },
      // J-2 仅失败
      { id: "t3", source: "jira", ticketKey: "J-2", createdAt: at(3) },
      // 区间外的失败不计
      { id: "t4", source: "jira", ticketKey: "J-3", createdAt: new Date("2026-08-15T04:00:00Z") },
      // 飞书同一工作项两个快照，失败两次
      { id: "t5", source: "meegle", ticketKey: "7", snapshotId: "s1", createdAt: at(4) },
      { id: "t6", source: "meegle", ticketKey: "7", snapshotId: "s2", createdAt: at(5) },
    ],
    processResults: [
      { id: "r2", processTaskId: "t2", source: "jira", ticketKey: "J-1", createdAt: at(2), reviewStatus: "pending" },
      // 无对应任务的旧结果补计一次开始
      { id: "r9", source: "jira", ticketKey: "J-9", createdAt: at(6), reviewStatus: "approved" },
    ],
    analysisHistories: [
      // 与结果 r2 同一任务的历史不重复计入
      { sourceResultId: "r2", sourceProcessTaskId: "t2", source: "jira", ticketKey: "J-1", resultCreatedAt: at(2), reviewStatus: "pending" },
    ],
  };
}

describe("开始分析票数与分析次数", () => {
  it("包含失败与重复分析，按票去重计票数，不改变成功口径", () => {
    const raw = tables();
    const stats = calculateAnnualStatistics(buildStatisticsRuns(raw), now, range, buildStatisticsAttempts(raw));
    expect(stats.jira).toMatchObject({ processedTickets: 2, successfulRuns: 2, startedTickets: 3, startedRuns: 4 });
    expect(stats.meegle).toMatchObject({ processedTickets: 0, successfulRuns: 0, startedTickets: 1, startedRuns: 2 });
    expect(stats).toMatchObject({ startedTickets: 4, startedRuns: 6 });
    const report = buildStatisticsReport({ title: "统计", total: stats });
    expect(report).toContain("开始分析票数（含失败）：**4**，分析次数（含重复与失败）：**6**");
    expect(report).toContain("| Jira | 2 | 2 | 3 | 4 |");
  });

  it("团队统计按成员求和，仅有失败分析的成员也列出", () => {
    const failedOnly: RawStatisticsTables = { processResults: [], analysisHistories: [],
      processTasks: [{ id: "x1", source: "jira", ticketKey: "J-1", createdAt: at(1) }] };
    const team = buildTeamStatistics(new Map([["alice", tables()], ["bob", failedOnly]]), now, range);
    expect(team.members.map(member => member.owner)).toEqual(["alice", "bob"]);
    expect(team.total).toMatchObject({ startedTickets: 5, startedRuns: 7, processedTickets: 2 });
    expect(team.total.jira).toMatchObject({ startedTickets: 4, startedRuns: 5 });
  });

  it("镜像行解析任务与结果的任务关联", () => {
    const grouped = groupStatisticsRows({
      processTasks: [{ owner: "alice", record_id: "t1", source: "jira", ticket_key: "J-1", data: { createdAt: { $date: at(1).toISOString() } } }],
      processResults: [{ owner: "alice", record_id: "r1", source: "jira", ticket_key: "J-1", data: { processTaskId: "t1", createdAt: { $date: at(1).toISOString() }, reviewStatus: "pending" } }],
      analysisHistories: [],
    });
    const raw = grouped.get("alice")!;
    expect(raw.processResults[0].processTaskId).toBe("t1");
    const stats = calculateAnnualStatistics(buildStatisticsRuns(raw), now, range, buildStatisticsAttempts(raw));
    expect(stats.jira).toMatchObject({ startedTickets: 1, startedRuns: 1, successfulRuns: 1 });
  });
});

describe("本地 IndexedDB 统计", () => {
  let database: IvacpDatabase;
  beforeAll(async () => { database = new IvacpDatabase(databaseName); await database.open(); });
  afterAll(async () => { await database.delete(); });

  it("读取失败任务，刷新重读后保留", async () => {
    await database.table("processTasks").bulkPut([
      { id: "t1", source: "jira", ticketKey: "J-1", ruleGroupId: "g", snapshotId: "x", status: "failed", createdAt: at(1) },
      { id: "t2", source: "jira", ticketKey: "J-1", ruleGroupId: "g", snapshotId: "y", status: "failed", createdAt: at(2) },
    ]);
    expect((await loadLocalStatistics(range)).jira).toMatchObject({ startedTickets: 1, startedRuns: 2, processedTickets: 0 });
    database.close(); await database.open();
    expect((await loadLocalStatistics(range))).toMatchObject({ startedTickets: 1, startedRuns: 2 });
  });
});
