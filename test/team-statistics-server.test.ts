import { describe, expect, it } from "vitest";
import { serializeRecord } from "@/domain/storage/serialization";
import { buildTeamStatistics } from "@/domain/analysis/team-statistics";
import { groupStatisticsRows } from "@/server/statistics/team-statistics";

const range = { year: 2026, startMonth: 1, endMonth: 12 };
const now = new Date("2026-06-01T00:00:00Z");

describe("团队统计镜像行映射", () => {
  it("按账号分组，还原 Date 并以抽取列补齐 source / ticketKey", () => {
    const grouped = groupStatisticsRows({
      processResults: [
        // mysql2 已解析的 JSON 对象（Date 仍是 {$date}）
        { owner: "alice", record_id: "r1", source: "jira", ticket_key: "A-1", data: { createdAt: { $date: "2026-03-01T02:00:00.000Z" }, reviewStatus: "approved", dwellMs: 3600000, tokenUsage: 1200, handoverAt: { $date: "2026-03-02T02:00:00.000Z" }, manualReviewedAt: null } },
        // 字符串形式
        { owner: "bob", record_id: "r2", source: "meegle", ticket_key: "900", data: serializeRecord({ createdAt: new Date("2026-04-01T00:00:00Z"), reviewStatus: "rejected", manualReviewedAt: new Date("2026-04-02T00:00:00Z") }) },
        // createdAt 缺失时回退 record_created_at
        { owner: "bob", record_id: "r3", source: "meegle", ticket_key: "901", record_created_at: new Date("2026-05-01T00:00:00Z"), data: "{}" },
        { owner: "carol", record_id: "x", source: null, ticket_key: "Z", data: "{}" },
      ],
      analysisHistories: [
        { owner: "alice", record_id: "h1", source: "jira", ticket_key: "A-1", data: { sourceResultId: "r0", resultCreatedAt: { $date: "2026-02-01T00:00:00.000Z" }, reviewStatus: "rejected" } },
      ],
    });
    expect([...grouped.keys()].sort()).toEqual(["alice", "bob"]);
    const alice = grouped.get("alice")!;
    expect(alice.processResults[0]).toMatchObject({ id: "r1", source: "jira", ticketKey: "A-1", reviewStatus: "approved", dwellMs: 3600000, tokenUsage: 1200 });
    expect(alice.processResults[0].createdAt).toBeInstanceOf(Date);
    expect(alice.processResults[0].handoverAt).toBeInstanceOf(Date);
    expect(alice.analysisHistories[0]).toMatchObject({ sourceResultId: "r0", source: "jira", ticketKey: "A-1", reviewStatus: "rejected" });
    const bob = grouped.get("bob")!;
    expect(bob.processResults[0].manualReviewedAt).toBeInstanceOf(Date);
    expect((bob.processResults[1].createdAt as Date).toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(bob.processResults[1].reviewStatus).toBe("pending");

    const team = buildTeamStatistics(grouped, now, range);
    expect(team.members.map((member) => member.owner)).toEqual(["alice", "bob"]);
    expect(team.total.jira).toMatchObject({ processedTickets: 1, successfulRuns: 2, approved: 1 });
    expect(team.total.meegle).toMatchObject({ processedTickets: 2, rejected: 1, pending: 1 });
  });
});
