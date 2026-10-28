import { expect, it, vi } from "vitest";
import { TerminalClient } from "@/features/terminal/terminal-client";
import { TerminalSessionManager, type TerminalChannel } from "../terminal-gateway/session-manager";
const context = { project: { projectName: "test", mainPath: "~/work", scriptPath: "scripts", branches: [] }, branch: { name: "main", repos: [] } };
it("只读扫描超时后继续交互并允许重试，不关闭PTY或发送排队写操作", () => {
  vi.useFakeTimers();
  try {
    const send = vi.fn(), emit = vi.fn(), fatal = vi.fn();
    const client = new TerminalClient("test", send, emit, () => {}, fatal);
    client.receive(JSON.stringify({ type: "connected", targetId: "test", sessionId: "s" }));
    client.setContext(context);
    client.enqueue({ type: "signalConfigFiles" });
    const old = send.mock.calls[0][0].requestId;
    client.enqueue({ type: "gitAdd", repoPath: "repo", files: ["a"] });
    vi.advanceTimersByTime(30001);
    expect(fatal).not.toHaveBeenCalled();
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ type: "status", status: "error", message: expect.stringContaining("超时") }));
    client.input("echo alive\r");
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "input" }));
    expect(client.enqueue({ type: "signalConfigFiles" })).toBe(true);
    client.receive(JSON.stringify({ type: "signalConfigFiles", sessionId: "s", requestId: old, configs: [], contextKey: JSON.stringify(context) }));
    expect(send.mock.calls.some(([m]) => m.type === "gitAdd")).toBe(false);
    client.dispose();
  } finally { vi.useRealTimers(); }
});
it("自动Git刷新合并连续Enter，断开取消尚未开始的刷新", async () => {
  vi.useFakeTimers();
  try {
    const channel = { write: vi.fn(), setWindow: vi.fn(), close: vi.fn(), on() { return this; } } as TerminalChannel;
    const run = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
    const manager = new TerminalSessionManager({ targets: [{ id: "test", name: "test", description: "", environment: "test", riskLevel: "normal", guardMode: "soft", host: "unused", port: 22, username: "test" }], connectSsh: async () => channel, runRemoteCommand: run, uploadRemoteFile: async () => {}, send: () => {}, audit: async () => {} });
    const sessionId = await manager.connect({ type: "connect", targetId: "test", cols: 80, rows: 24 });
    const ctx = { ...context, branch: { name: "main", repos: [{ repoName: "repo", repoPath: "repo", branchName: "main" }] } };
    for (let i = 0; i < 5; i++) await manager.inputMessage({ type: "input", sessionId, data: "echo test\r", projectContext: ctx });
    await vi.advanceTimersByTimeAsync(1201);
    expect(run).toHaveBeenCalledTimes(1);
    await manager.inputMessage({ type: "input", sessionId, data: "echo test\r", projectContext: ctx });
    manager.disconnectAll("test_done");
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
