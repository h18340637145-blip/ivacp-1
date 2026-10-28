import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ connection: { query: vi.fn(), release: vi.fn(), destroy: vi.fn() }, getConnection: vi.fn() }));
vi.mock("@/server/db/mysql", () => ({ getPool: async () => ({ getConnection: state.getConnection }), isMysqlConfigured: () => true }));
import { templateAction } from "@/server/templates/route-helpers";
import { withTemplateLock } from "@/server/templates/template-lock";
beforeEach(() => {
  state.getConnection.mockReset().mockResolvedValue(state.connection); state.connection.release.mockReset(); state.connection.destroy.mockReset();
  state.connection.query.mockReset().mockImplementation(async (sql: string) => [[sql.includes("WEIGHT_STRING") ? { weight: "same" } : sql.includes("GET_LOCK") ? { acquired: 1 } : { released: 1 }]]);
});
it("锁名与数据库标识大小写一致，回调仅使用持锁连接并正确释放", async () => {
  const operation = vi.fn(async connection => { expect(connection).toBe(state.connection); return "完成"; });
  expect(await withTemplateLock("a", operation)).toBe("完成"); expect(state.getConnection).toHaveBeenCalledTimes(1); expect(state.connection.query.mock.calls.map(([sql]) => sql)).toEqual(["SELECT HEX(WEIGHT_STRING(? COLLATE utf8mb4_unicode_ci AS CHAR(64))) AS weight", "SELECT GET_LOCK(?, 10) AS acquired", "SELECT RELEASE_LOCK(?) AS released"]); expect(Buffer.byteLength(state.connection.query.mock.calls[1][1][0])).toBeLessThanOrEqual(64); expect(state.connection.query.mock.calls[1][1]).toEqual(state.connection.query.mock.calls[2][1]); expect(state.connection.release).toHaveBeenCalledOnce(); expect(state.connection.destroy).not.toHaveBeenCalled();
});
it("获取锁超时不运行操作，返回503并把未持锁连接归还", async () => {
  state.connection.query.mockImplementation(async (sql: string) => [[sql.includes("WEIGHT_STRING") ? { weight: "same" } : { acquired: 0 }]]); const operation = vi.fn();
  await expect(templateAction(() => withTemplateLock("a", operation), "发布失败", 400)).rejects.toMatchObject({ status: 503 }); expect(operation).not.toHaveBeenCalled(); expect(state.connection.release).toHaveBeenCalledOnce(); expect(state.connection.query).toHaveBeenCalledTimes(2);
});
it("获取锁时通信失败，锁状态未知则销毁连接", async () => {
  state.connection.query.mockImplementation(async (sql: string) => { if (sql.includes("WEIGHT_STRING")) return [[{ weight: "same" }]]; throw new Error("连接断开"); }); await expect(withTemplateLock("a", vi.fn())).rejects.toThrow("连接断开"); expect(state.connection.destroy).toHaveBeenCalledOnce(); expect(state.connection.release).not.toHaveBeenCalled();
});
it("业务失败仍释放锁并保留原错误", async () => {
  const error = new Error("业务失败"); await expect(withTemplateLock("a", async () => { throw error; })).rejects.toBe(error); expect(state.connection.query).toHaveBeenCalledTimes(3); expect(state.connection.release).toHaveBeenCalledOnce();
});
it.each(["error", "not-held"])("释放异常%s时销毁连接，不把已提交操作误报失败", async mode => {
  state.connection.query.mockImplementation(async (sql: string) => {
    if (sql.includes("WEIGHT_STRING")) return [[{ weight: "same" }]];
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (mode === "error") throw new Error("释放断开"); return [[{ released: 0 }]];
  });
  expect(await withTemplateLock("a", async () => "已提交")).toBe("已提交"); expect(state.connection.destroy).toHaveBeenCalledOnce(); expect(state.connection.release).not.toHaveBeenCalled();
});
