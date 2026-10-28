import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ old: { query: vi.fn() }, current: { query: vi.fn() }, lock: vi.fn() }));
vi.mock("@/server/db/mysql", () => ({ getLegacyPool: async () => state.old, getPool: async () => { throw new Error("迁移模板不能绕过持锁连接"); } }));
vi.mock("@/server/templates/template-lock", () => ({ withTemplateLock: state.lock }));
import { migrateTemplates } from "@/server/migration/legacy-mysql";
beforeEach(() => {
  state.old.query.mockReset().mockImplementation(async (sql: string) => sql.includes("information_schema") ? [[{ total: 1 }]] : [[{ template_key: "legacy", version: 2, name: "旧模板", description: "", tags: "[]", author: "alice", config: "{}", checksum: "hash", apply_count: 3, deleted: 0, created_at: new Date() }]]);
  state.current.query.mockReset().mockResolvedValue([{ affectedRows: 1 }]); state.lock.mockReset().mockImplementation(async (_key, operation) => operation(state.current));
});
it.each([false, true])("旧模板迁移覆盖=%s复用发布/删除门禁，保留版本与原字段，不写旧库", async overwrite => {
  expect(await migrateTemplates(overwrite)).toEqual({ read: 1, written: 1 }); expect(state.lock).toHaveBeenCalledWith("legacy", expect.any(Function));
  const [sql, args] = state.current.query.mock.calls[0]; expect(sql).toContain(overwrite ? "ON DUPLICATE KEY UPDATE" : "INSERT IGNORE"); expect(args.slice(0, 2)).toEqual(["legacy", 2]); expect(args[5]).toBe("alice"); expect(args[8]).toBe(3);
  expect(state.old.query.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
});
