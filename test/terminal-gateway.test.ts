import { expect, it, vi } from "vitest";
import { TerminalSessionManager, type TerminalChannel } from "../terminal-gateway/session-manager";
import type { RemoteShellTarget, ServerTerminalMessage, TerminalProjectContext } from "@/domain/terminal/types";
import type { AuditEvent } from "../terminal-gateway/audit-log";
const target: RemoteShellTarget = { id: "test", name: "隔离终端", description: "", environment: "test", riskLevel: "normal", guardMode: "strict", host: "unused.invalid", port: 22, username: "test" };
const context: TerminalProjectContext = { project: { projectName: "测试项目", mainPath: "~/workspace", scriptPath: "script", branches: [] }, branch: { name: "main", repos: [{ repoName: "VHAL", repoPath: "vhal", branchName: "main" }] } };
class Channel implements TerminalChannel {
  closed = false; executed: string[] = []; pending = "";
  closeHandler = () => {};
  write(data: string) { for (const char of data) { if (char === "\x03" || char === "\x15") this.pending = ""; else if (char === "\n" || char === "\r") { if (this.pending) this.executed.push(this.pending); this.pending = ""; } else if (char === "\x7f" || char === "\b") this.pending = this.pending.slice(0, -1); else this.pending += char; } }
  setWindow = vi.fn();
  close() { this.closed = true; this.closeHandler(); }
  on(event: "data" | "close", handler: ((data: Buffer | string) => void) | (() => void)): this { if (event === "close") this.closeHandler = handler as () => void; return this; }
}
function setup(audit?: (event: AuditEvent) => Promise<void>, connect?: () => Promise<TerminalChannel>) {
  const channel = new Channel(), messages: ServerTerminalMessage[] = [], events: AuditEvent[] = [];
  const run = vi.fn<(target: RemoteShellTarget, command: string) => Promise<{ stdout: string; stderr: string; code: number }>>(async () => ({ stdout: "## main\n", stderr: "", code: 0 }));
  const manager = new TerminalSessionManager({ targets: [target], connectSsh: connect ?? (async () => channel), runRemoteCommand: run, uploadRemoteFile: vi.fn(async () => {}), send: message => messages.push(message), audit: async event => { events.push(event); await audit?.(event); } });
  return { manager, channel, messages, events, run };
}
it("多行粘贴逐条检查，拒绝命令不执行也不污染下一条", async () => {
  const { manager, channel, messages, events } = setup();
  const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  await manager.input(sessionId, "echo before\nshutdown\necho after\n");
  expect(channel.executed).toEqual(["echo before", "echo after"]);
  expect(messages.some(message => message.type === "blocked" && message.command === "shutdown")).toBe(true);
  expect(events.filter(event => event.event === "command").map(event => event.command)).toEqual(["echo before", "echo after"]);
});
it("交互输入拒绝Enter时清除已发送到PTY的前缀，退格后按最终命令检查", async () => {
  const { manager, channel } = setup();
  const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  await manager.input(sessionId, "shutdown"); await manager.input(sessionId, "\r"); await manager.input(sessionId, "echo safe\r");
  await manager.input(sessionId, "shutdown\x15echo cleared\r");
  expect(channel.executed).toEqual(["echo safe", "echo cleared"]);
});
it("审计异步延迟时，同会话输入仍按到达顺序写入", async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const { manager, channel } = setup(async event => { if (event.event === "command" && event.command === "echo one") await barrier; });
  const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  const one = manager.input(sessionId, "echo one\n"); const two = manager.input(sessionId, "echo two\n");
  await Promise.resolve(); await Promise.resolve(); release(); await Promise.all([one, two]);
  expect(channel.executed).toEqual(["echo one", "echo two"]);
});
it("浏览器关闭期间晚到的SSH连接立即关闭，不能再注册会话", async () => {
  const channel = new Channel(); let ready!: (channel: TerminalChannel) => void;
  const { manager, messages } = setup(undefined, () => new Promise(resolve => { ready = resolve; }));
  const connecting = manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  manager.disconnectAll("browser_closed"); ready(channel);
  await expect(connecting).rejects.toThrow("关闭");
  expect(channel.closed).toBe(true); expect(messages.some(message => message.type === "connected")).toBe(false);
});
it("git文件参数使用--，避免合法的横杠文件名被解析成命令选项", async () => {
  const { manager, run } = setup();
  const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  await manager.gitAdd({ type: "gitAdd", sessionId, projectContext: context, repoPath: "vhal", files: ["--all"] });
  expect(run.mock.calls[0][1]).toContain("git --literal-pathspecs add -- '--all'");
});
it("空文件列表、越界路径与整个目录不能触发批量撤销或删除", async () => {
  const { manager, run } = setup();
  const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  for (const files of [[], [".."], ["../other"], ["/absolute"], ["."], ["dir/../../escape"]]) {
    await expect(manager.gitCheckout({ type: "gitCheckout", sessionId, projectContext: context, repoPath: "vhal", files })).rejects.toThrow();
  }
  await expect(manager.gitReset({ type: "gitReset", sessionId, projectContext: context, repoPath: "vhal", files: [] })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});
it("文件动作只能作用于当前项目分支声明的仓库", async () => {
  const { manager, run } = setup();
  const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  await expect(manager.gitAdd({ type: "gitAdd", sessionId, projectContext: context, repoPath: "outside", files: ["a.txt"] })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it("结构化动作响应回显请求与完整项目上下文，自动刷新没有请求ID", async () => {
  const { manager, messages } = setup();
  const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  await manager.refreshGitStatus(sessionId, context, "status-1");
  const response = messages.find(message => message.type === "gitStatus");
  expect(response).toMatchObject({ requestId: "status-1", contextKey: expect.stringContaining("~/workspace") });
  await manager.gitAdd({ type: "gitAdd", sessionId, projectContext: context, repoPath: "vhal", files: ["a.txt"], requestId: "add-1" });
  expect(messages.some(message => message.type === "status" && message.requestId === "add-1")).toBe(true);
});

it("审计失败不留下可被下一条输入执行的PTY前缀；连接审计失败关闭通道", async () => {
  let fail = true;
  const { manager, channel } = setup(async event => { if (fail && event.event === "command") throw new Error("审计不可用"); });
  const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
  await expect(manager.input(sessionId, "echo unsafe\n")).rejects.toThrow("审计不可用");
  fail = false; await manager.input(sessionId, "echo safe\n");
  expect(channel.executed).toEqual(["echo safe"]);
  const connection = setup(async () => { throw new Error("连接审计失败"); });
  await expect(connection.manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 })).rejects.toThrow("连接审计失败");
  expect(connection.channel.closed).toBe(true);
});

it("Git pathspec魔法与通配文件名只按字面处理，不得撤销其他文件（隔离仓库）", async () => {
  const fs = await import("node:fs/promises"); const { tmpdir } = await import("node:os"); const path = await import("node:path");
  const { execFile } = await import("node:child_process"); const { promisify } = await import("node:util"); const exec = promisify(execFile);
  const root = await fs.mkdtemp(path.join(tmpdir(), "ivacp-git-pathspec-"));
  try {
    const repo = path.join(root, "vhal"); await fs.mkdir(repo);
    await exec("git", ["init", "--quiet"], { cwd: repo });
    for (const name of ["a.txt", "b.txt", "*.txt"]) await fs.writeFile(path.join(repo, name), "original");
    await exec("git", ["add", "--all"], { cwd: repo });
    await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@invalid", "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "isolated fixture"], { cwd: repo });
    for (const name of ["a.txt", "b.txt", "*.txt"]) await fs.writeFile(path.join(repo, name), "changed");
    const channel = new Channel();
    const manager = new TerminalSessionManager({ targets: [target], connectSsh: async () => channel, runRemoteCommand: async (_target, command) => {
      try { const result = await exec("bash", ["-c", command], { cwd: root }); return { ...result, code: 0 }; }
      catch (error) { const result = error as { stdout?: string; stderr?: string; code?: number }; return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code ?? 1 }; }
    }, uploadRemoteFile: async () => {}, send: () => {}, audit: async () => {} });
    const sessionId = await manager.connect({ type: "connect", targetId: target.id, cols: 80, rows: 24 });
    const localContext = { ...context, project: { ...context.project, mainPath: root } };
    await manager.gitCheckout({ type: "gitCheckout", sessionId, projectContext: localContext, repoPath: "vhal", files: [":/"] });
    expect(await fs.readFile(path.join(repo, "a.txt"), "utf8")).toBe("changed");
    await manager.gitCheckout({ type: "gitCheckout", sessionId, projectContext: localContext, repoPath: "vhal", files: ["*.txt"] });
    expect(await fs.readFile(path.join(repo, "*.txt"), "utf8")).toBe("original");
    expect(await fs.readFile(path.join(repo, "a.txt"), "utf8")).toBe("changed");
    expect(await fs.readFile(path.join(repo, "b.txt"), "utf8")).toBe("changed");
    manager.disconnectAll("test_done");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
