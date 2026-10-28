import { describe, expect, it } from "vitest";
import { calculateAnnualStatistics } from "@/domain/analysis/annual-statistics";
import { buildStatisticsRuns, emptyRawStatisticsTables } from "@/domain/analysis/statistics-records";
import { buildTeamStatistics } from "@/domain/analysis/team-statistics";
import { groupStatisticsRows } from "@/server/statistics/team-statistics";

const now = new Date("2026-10-20T00:00:00Z");
const range = { year: 2026, startMonth: 1, endMonth: 12 };
const result = (id: string, snapshotId: string, assignmentId = id) => ({
  id, snapshotId, assignmentId, source: "meegle" as const, ticketKey: "42",
  createdAt: "2026-09-01T00:00:00Z", reviewStatus: "approved" as const, manualReviewedAt: "2026-09-02T00:00:00Z",
});
const identity = (id: string, projectKey: string, workItemTypeKey = "issue") => ({
  id, source: "meegle" as const, projectKey, workItemTypeKey, workItemId: 42,
});

describe("飞书统计完整身份", () => {
  it("跨项目、跨类型同号分别计票，同一票多次运行只增加分析次数", () => {
    const tables = { ...emptyRawStatisticsTables(),
      snapshots: [identity("s1", "p1"), identity("s2", "p2"), identity("s3", "p1", "task"), identity("s4", "p1")],
      processResults: [result("r1", "s1"), result("r2", "s2"), result("r3", "s3"), result("r4", "s4")],
    };
    const report = calculateAnnualStatistics(buildStatisticsRuns(tables), now, range);
    expect(report.meegle).toMatchObject({ processedTickets: 3, successfulRuns: 4, approved: 3 });
  });

  it("历史使用原快照，缺快照回退分配；无完整身份的不同分配不误合并", () => {
    const tables = { ...emptyRawStatisticsTables(),
      snapshots: [identity("old", "p1"), { ...identity("incomplete", ""), workItemId: undefined }],
      assignments: [identity("a1", "p1"), identity("a2", "p2")],
      analysisHistories: [{ source: "meegle" as const, sourceResultId: "old-r", sourceSnapshotId: "old", assignmentId: "a2", ticketKey: "42", resultCreatedAt: "2026-08-01T00:00:00Z", reviewStatus: "rejected" as const }],
      processResults: [result("r1", "missing", "a1"), result("r2", "incomplete", "a2"), result("r3", "missing", "unknown1"), result("r4", "missing", "unknown2")],
    };
    const runs = buildStatisticsRuns(tables);
    expect(runs[0].ticketKey).toBe(runs[1].ticketKey);
    const report = calculateAnnualStatistics(runs, now, range);
    expect(report.meegle).toMatchObject({ processedTickets: 4, successfulRuns: 5, approved: 4 });
  });

  it("团队镜像按账号关联快照与分配，并与本地口径一致", () => {
    const rows = {
      processResults: ["alice", "bob"].flatMap(owner => [
        { owner, record_id: "r1", source: "meegle", ticket_key: "42", data: result("r1", "s1", "a1") },
        { owner, record_id: "r2", source: "meegle", ticket_key: "42", data: result("r2", "missing", "a2") },
      ]),
      analysisHistories: [],
      snapshots: ["alice", "bob"].map(owner => ({ owner, record_id: "s1", source: "meegle", ticket_key: "42", data: identity("s1", owner) })),
      assignments: ["alice", "bob"].map(owner => ({ owner, record_id: "a2", source: "meegle", ticket_key: "42", data: identity("a2", owner === "alice" ? owner : `${owner}-other`) })),
    };
    const team = buildTeamStatistics(groupStatisticsRows(rows), now, range);
    expect(team.total.meegle).toMatchObject({ processedTickets: 3, successfulRuns: 4 });
    expect(team.members.map(member => member.statistics.meegle.processedTickets)).toEqual([1, 2]);
  });
});
