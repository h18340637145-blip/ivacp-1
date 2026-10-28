import "fake-indexeddb/auto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { IvacpDatabase } from "@/shared/db/database";
import { loadLocalStatistics } from "@/features/statistics/load-local-statistics";
const { databaseName } = vi.hoisted(() => ({ databaseName: `statistics-${Date.now()}` }));
vi.mock("@/shared/db/database", async importOriginal => {
  const actual = await importOriginal<typeof import("@/shared/db/database")>();
  return { ...actual, db: new actual.IvacpDatabase(databaseName) };
});
let database: IvacpDatabase;
beforeAll(async () => { database = new IvacpDatabase(databaseName); await database.open(); });
afterAll(async () => { await database.delete(); });
it("本地统计从同一只读事务读取快照和分配，刷新重读保留跨项目票数", async () => {
  // 只写统计需要的字段，模拟已有浏览器记录而不触发分析服务。
  await database.table("snapshots").bulkPut([
    { id: "s1", source: "meegle", projectKey: "p1", workItemTypeKey: "issue", workItemId: 42 },
    { id: "s2", source: "meegle", projectKey: "p2", workItemTypeKey: "issue", workItemId: 42 },
  ]);
  await database.table("processResults").bulkPut(["s1", "s2"].map((snapshotId, index) => ({
    id: `r${index}`, source: "meegle", ticketKey: "42", snapshotId,
    createdAt: new Date("2026-01-01T00:00:00Z"), reviewStatus: "pending",
  })));
  const range = { year: 2026, startMonth: 1, endMonth: 12 };
  expect((await loadLocalStatistics(range)).meegle.processedTickets).toBe(2);
  database.close(); await database.open();
  expect((await loadLocalStatistics(range)).meegle.processedTickets).toBe(2);
});
