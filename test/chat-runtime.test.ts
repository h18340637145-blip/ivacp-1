import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ saved: [] as Array<Record<string, unknown>>, prepare: vi.fn(), stream: vi.fn(), remember: vi.fn() }));
vi.mock("@/features/chat/lib/conversation", () => ({
  listChatMessages: async () => [], saveChatMessage: async (message: Record<string, unknown>) => { state.saved.push(message); },
  clearChatMessages: async () => { state.saved.length = 0; }, prepareContext: state.prepare, streamChat: state.stream,
}));
vi.mock("@/features/chat/lib/memory-service", () => ({ rememberExchange: state.remember }));
import { clearChatHistory, getChatRun, startChatRun, stopChatRun, subscribeChatRun } from "@/features/chat/lib/chat-runtime";
beforeEach(() => { state.saved = []; state.prepare.mockReset(); state.stream.mockReset(); state.remember.mockReset(); state.prepare.mockResolvedValue({ context: [], memories: [] }); state.stream.mockResolvedValue("完整回复"); state.remember.mockResolvedValue(undefined); });
it("重订阅仍显示进行中的运行，同用户重复发送被阻止，其他账号独立", async () => {
  let release!: () => void; state.prepare.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ context: [], memories: [] }); }));
  const first = startChatRun("runtime-alice", "问题");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const changed = vi.fn(); const unsubscribe = subscribeChatRun("runtime-alice", changed); unsubscribe();
  const unsubscribeAgain = subscribeChatRun("runtime-alice", changed);
  expect(getChatRun("runtime-alice").busy).toBe(true);
  await startChatRun("runtime-alice", "重复问题"); await expect(clearChatHistory("runtime-alice")).rejects.toThrow(/生成/);
  await startChatRun("runtime-bob", "独立问题"); release(); await first; unsubscribeAgain();
  expect(state.stream).toHaveBeenCalledTimes(2); expect(state.saved.filter(row => row.userId === "runtime-alice")).toHaveLength(2); expect(changed).toHaveBeenCalled();
});
it("停止检索后晚到上下文不启动模型，也不保存助手记录", async () => {
  let release!: () => void; state.prepare.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ context: [], memories: [] }); }));
  const run = startChatRun("runtime-cancel", "问题"); await vi.waitFor(() => expect(release).toBeTypeOf("function")); stopChatRun("runtime-cancel"); release(); await run;
  expect(state.stream).not.toHaveBeenCalled(); expect(state.saved).toHaveLength(1); expect(getChatRun("runtime-cancel")).toMatchObject({ busy: false, notice: null });
});
it("停止后晚到成功流不能保存或抽取记忆", async () => {
  let release!: () => void; state.stream.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve("晚到回复"); }));
  const run = startChatRun("runtime-late", "问题"); await vi.waitFor(() => expect(release).toBeTypeOf("function")); stopChatRun("runtime-late"); release(); await run;
  expect(state.saved).toHaveLength(1); expect(state.remember).not.toHaveBeenCalled(); expect(getChatRun("runtime-late").busy).toBe(false);
});
