import { expect, it, vi } from "vitest";
import { readTeamStatistics } from "@/server/statistics/team-statistics";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db/mysql", () => ({ getPool: async () => ({ query }) }));
it("镜像查询投影关联字段，读取区间外创建的上下文且仅返回聚合值", async () => {
  query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("table_name = 'processResults'")) return [[1, 2].map(i => ({
      owner: "alice", record_id: `r${i}`, source: "meegle", ticket_key: "42", data: {
        snapshotId: `s${i}`, assignmentId: `a${i}`, createdAt: "2026-09-01T00:00:00Z", reviewStatus: "pending",
      },
    }))];
    if (params[0] === "snapshots") return [[{ owner: "alice", record_id: "s1", source: "meegle", data: { projectKey: "p1", workItemTypeKey: "issue", workItemId: 42 } }]];
    if (params[0] === "assignments") return [[{ owner: "alice", record_id: "a2", source: "meegle", data: { projectKey: "p2", workItemTypeKey: "issue", workItemId: 42 } }]];
    return [[]];
  });
  const result = await readTeamStatistics({ year: 2026, startMonth: 9, endMonth: 9 }, new Date("2026-10-01T00:00:00Z"));
  expect(result.total.meegle.processedTickets).toBe(2);
  const calls = query.mock.calls;
  expect(calls[0][0]).toContain("'$.snapshotId'");
  expect(calls[1][0]).toContain("'$.sourceSnapshotId'");
  for (const [sql] of calls.slice(2)) {
    expect(sql).toContain("source = 'meegle' AND deleted = 0");
    expect(sql).not.toContain("record_created_at");
    expect(sql).not.toContain("replyText");
  }
  expect(JSON.stringify(result)).not.toContain("p1");
});
