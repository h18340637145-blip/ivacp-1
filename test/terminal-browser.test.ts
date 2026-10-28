import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page, type WebSocketRoute } from "playwright";
import type { ClientTerminalMessage, ServerTerminalMessage, TerminalProject, TerminalProjectContext } from "@/domain/terminal/types";
import { terminalContextKey } from "@/domain/terminal/context";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
const projects: TerminalProject[] = ["甲项目", "乙项目"].map((projectName, i) => ({ projectName, mainPath: `~/workspace ${i}`, scriptPath: "script", branches: ["main", "release"].map(name => ({ name, repos: [{ repoName: "VHAL", repoPath: "vhal", branchName: name }] })) }));
const targets = ["服务器甲", "服务器乙"].map((name, i) => ({ id: `target-${i}`, name, description: "隔离模拟目标", environment: "test", riskLevel: "normal", guardMode: "strict" }));
describe.skipIf(!baseURL)("远程终端浏览器验收（模拟Gateway）", () => {
  let browser: Browser, context: BrowserContext, page: Page;
  let requests: ClientTerminalMessage[], sockets: WebSocketRoute[], accept: boolean, errors: string[], dialogs: string[], failConnect: boolean, failAction: boolean, failConfig: boolean, stallScan: boolean;
  beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE }); });
  afterAll(async () => { await browser?.close(); });
  afterEach(async () => { await context?.close(); });
  const send = (socket: WebSocketRoute, message: ServerTerminalMessage) => socket.send(JSON.stringify(message));
  function git(socket: WebSocketRoute, sessionId: string, ctx: TerminalProjectContext, requestId?: string, output?: string) {
    send(socket, { type: "gitStatus", sessionId, requestId, contextKey: terminalContextKey(ctx), statuses: ctx.branch.repos.map(repo => ({ ...repo, status: "success", output: output ?? `## ${repo.branchName}\n M modified.txt\nM  staged.txt\n?? new.txt` })) });
  }
  function configs(socket: WebSocketRoute, sessionId: string, ctx: TerminalProjectContext, requestId?: string) {
    send(socket, { type: "signalConfigFiles", sessionId, requestId, contextKey: terminalContextKey(ctx), configs: ctx.branch.repos.map(repo => ({ ...repo, status: "success", files: ["A", "B"].map(label => ({ fileName: `config_${label}.json`, filePath: `tools/json/config_${label}.json`, label })) })) });
  }
  async function start(role: "admin" | "analyst" = "admin") {
    requests = []; sockets = []; accept = true; errors = []; dialogs = []; failConnect = false; failAction = false; failConfig = false; stallScan = false;
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 }, permissions: ["clipboard-read", "clipboard-write"] });
    context.setDefaultTimeout(20_000);
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "terminal-browser-test", displayName: "终端验收", role }), url: baseURL! }]);
    await context.route("**/api/backup/**", route => route.fulfill({ json: { configured: false } }));
    await context.route("**/api/terminal/targets", route => failConfig ? route.fulfill({ status: 500, json: { error: "模拟目标配置读取失败" } }) : route.fulfill({ json: { targets } }));
    await context.route("**/api/terminal/projects", route => route.fulfill({ json: { projects } }));
    await context.routeWebSocket("**", socket => {
      if (new URL(socket.url()).host === new URL(baseURL!).host && new URL(socket.url()).pathname.startsWith("/_next/")) { socket.connectToServer(); return; }
      sockets.push(socket); const sessionId = `session-${sockets.length}`;
      socket.onMessage(raw => {
        const message = JSON.parse(String(raw)) as ClientTerminalMessage; requests.push(message);
        if (message.type === "connect") {
          if (failConnect) return send(socket, { type: "status", status: "error", message: "模拟SSH认证失败" });
          send(socket, { type: "connected", targetId: message.targetId, sessionId }); send(socket, { type: "output", sessionId, data: "mock shell ready\r\n$ " }); return;
        }
        if (message.type === "disconnect") return send(socket, { type: "closed", sessionId, reason: "client_disconnect" });
        if (message.type === "resize") return;
        if (message.type === "input") {
          if (message.data.includes("shutdown")) return send(socket, { type: "blocked", sessionId, command: "shutdown", reason: "blocked_by_strict_guard" });
          return send(socket, { type: "output", sessionId, data: message.data });
        }
        const ctx = message.projectContext, requestId = message.requestId;
        if (failAction) return send(socket, { type: "status", sessionId, requestId, status: "error", message: "模拟操作失败" });
        if (message.type === "signalConfigFiles" && stallScan) return;
        if (message.type === "signalConfigFiles") return configs(socket, sessionId, ctx, requestId);
        if (message.type === "projectGitStatus") return git(socket, sessionId, ctx, requestId);
        if (message.type === "packageFiles" || message.type === "packageChecklist") return send(socket, { type: "fileDownload", sessionId, requestId, contextKey: terminalContextKey(ctx), fileName: message.type === "packageFiles" ? "test-script-files.zip" : "VHAL_SIGNAL_CHECKLIST_s.xls", mimeType: "application/octet-stream", contentBase64: Buffer.from("isolated test file").toString("base64") });
        send(socket, { type: "status", sessionId, requestId, contextKey: terminalContextKey(ctx), status: "info", message: message.type === "uploadFile" ? "上传完成：test-file" : `${message.type} 完成` });
        git(socket, sessionId, ctx, requestId);
        if (message.type === "checkoutSignalConfigFiles") configs(socket, sessionId, ctx, requestId);
      });
    });
    page = await context.newPage(); page.on("pageerror", error => errors.push(error.message)); page.on("dialog", async dialog => { dialogs.push(dialog.message()); if (accept) await dialog.accept(); else await dialog.dismiss(); });
    await page.goto("/terminal");
  }
  const messages = (type: ClientTerminalMessage["type"]) => requests.filter(request => request.type === type);
  async function connect() { await page.getByRole("button", { name: "连接服务器", exact: true }).click(); await page.getByRole("checkbox", { name: "A", exact: true }).waitFor(); await expect.poll(() => page.getByRole("button", { name: "刷新状态", exact: true }).isEnabled()).toBe(true); }
  it("确认连接、多标签保持会话、项目/分支命令、输入和剪贴板、resize及关闭清理", async () => {
    await start(); accept = false; await page.getByRole("button", { name: "连接服务器", exact: true }).click(); expect(sockets.length).toBe(0);
    accept = true; await connect(); expect(messages("connect")).toHaveLength(1);
    await page.getByRole("combobox", { name: "项目", exact: true }).selectOption({ label: "乙项目" });
    await expect.poll(() => requests.some(message => message.type === "input" && message.data.includes("workspace 1"))).toBe(true);
    await expect.poll(() => page.getByRole("combobox", { name: "分支", exact: true }).isEnabled()).toBe(true);
    await page.getByRole("combobox", { name: "分支", exact: true }).selectOption("release");
    await expect.poll(() => requests.some(message => message.type === "input" && message.data.includes("stash push -u") && message.data.includes("release"))).toBe(true);
    await expect.poll(() => page.getByRole("button", { name: "配信号", exact: true }).isEnabled()).toBe(true);
    await page.getByRole("button", { name: "配信号", exact: true }).click();
    expect(requests.some(message => message.type === "input" && message.data.includes("workspace 1") && message.data.includes("script"))).toBe(true);
    await page.locator(".xterm-helper-textarea").focus(); await page.keyboard.type("echo manual"); await page.keyboard.press("Enter");
    await expect.poll(() => messages("input").map(message => message.type === "input" ? message.data : "").join("").includes("manual")).toBe(true);
    await page.evaluate(() => navigator.clipboard.writeText("echo clipboard")); await page.keyboard.press("Control+V");
    await expect.poll(() => messages("input").some(message => message.type === "input" && message.data.includes("clipboard"))).toBe(true);
    await page.setViewportSize({ width: 1100, height: 900 }); await expect.poll(() => messages("resize").length).toBeGreaterThan(0);
    await page.getByRole("combobox", { name: "服务器", exact: true }).selectOption("target-1"); await page.getByRole("button", { name: "连接服务器", exact: true }).click();
    await expect.poll(() => messages("connect").length).toBe(2);
    await page.getByRole("tab", { name: /服务器甲/ }).click(); expect(messages("disconnect").length).toBe(0);
    await page.getByRole("button", { name: "关闭 服务器甲 终端", exact: true }).click(); await expect.poll(() => messages("disconnect").length).toBe(1);
    expect(errors).toEqual([]);
  });
  it("配置查询卡住30秒后仍保持终端交互，取消排队操作并支持刷新", async () => {
    await start();
    await page.clock.install();
    stallScan = true;
    await page.getByRole("button", { name: "连接服务器", exact: true }).click();
    await expect.poll(() => messages("signalConfigFiles").length).toBe(1);
    await page.clock.fastForward(30001);
    await page.getByRole("alert").filter({ hasText: "仓库查询超时，终端仍可使用" }).waitFor();
    expect(messages("disconnect")).toHaveLength(0);
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("echo alive"); await page.keyboard.press("Enter");
    await expect.poll(() => messages("input").map(message => message.type === "input" ? message.data : "").join("").includes("echo alive")).toBe(true);
    stallScan = false;
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await expect.poll(() => page.getByRole("button", { name: "刷新状态", exact: true }).isEnabled()).toBe(true);
    expect(messages("disconnect")).toHaveLength(0);
    expect(errors).toEqual([]);
  });
  it("逐文件Git操作、配置保留/恢复、三类上传、两类下载与面板宽度", async () => {
    await start(); await connect();
    await page.getByRole("checkbox", { name: "选择 modified.txt", exact: true }).check(); await page.getByRole("button", { name: "git add (1)", exact: true }).click();
    await expect.poll(() => messages("gitAdd").length).toBe(1);
    await expect.poll(() => page.getByRole("checkbox", { name: "选择 staged.txt", exact: true }).isEnabled()).toBe(true);
    await page.getByRole("checkbox", { name: "选择 staged.txt", exact: true }).check(); await page.getByRole("button", { name: "git reset (1)", exact: true }).click();
    await expect.poll(() => messages("gitReset").length).toBe(1);
    await expect.poll(() => page.getByRole("checkbox", { name: "选择 new.txt", exact: true }).isEnabled()).toBe(true);
    await page.getByRole("checkbox", { name: "选择 new.txt", exact: true }).check(); await page.getByRole("button", { name: "checkout", exact: true }).click();
    await expect.poll(() => messages("gitCheckout").length).toBe(1);
    await expect.poll(() => page.getByRole("checkbox", { name: "B", exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole("checkbox", { name: "A", exact: true }).isChecked()).toBe(true);
    await page.getByRole("checkbox", { name: "B", exact: true }).uncheck(); await page.getByRole("button", { name: "配置", exact: true }).click();
    await expect.poll(() => messages("checkoutSignalConfigFiles").length).toBe(1);
    expect(messages("checkoutSignalConfigFiles")[0]).toMatchObject({ repos: [{ repoPath: "vhal", files: ["tools/json/config_B.json"] }] });
    for (const [label, fileName, kind] of [["上传 xls", "input.xls", "xls"], ["上传 dbc", "can.dbc", "dbc"], ["上传 mcu.h", "mcu.h", "mcuHeader"]]) {
      await expect.poll(() => page.getByRole("button", { name: label, exact: true }).isEnabled()).toBe(true);
      const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: label, exact: true }).click();
      await (await chooser).setFiles({ name: fileName, mimeType: "application/octet-stream", buffer: Buffer.from("test-upload") });
      await expect.poll(() => requests.some(message => message.type === "uploadFile" && message.uploadKind === kind && message.contentBase64 === Buffer.from("test-upload").toString("base64"))).toBe(true);
    }
    for (const [label, filename] of [["打包", "test-script-files.zip"], ["检验checklist", "VHAL_SIGNAL_CHECKLIST_s.xls"]]) {
      await expect.poll(() => page.getByRole("button", { name: label, exact: true }).isEnabled()).toBe(true);
      const download = page.waitForEvent("download"); await page.getByRole("button", { name: label, exact: true }).click(); expect((await download).suggestedFilename()).toBe(filename);
    }
    const separator = page.getByRole("separator", { name: "调整 Repo 状态面板宽度", exact: true }); const width = Number(await separator.getAttribute("aria-valuenow")); await separator.focus(); await page.keyboard.press("ArrowLeft"); expect(Number(await separator.getAttribute("aria-valuenow"))).toBe(width + 20);
    await page.screenshot({ path: "/tmp/ivacp-terminal-desktop.png", fullPage: true });
    for (const width of [375, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    expect(errors).toEqual([]);
  });
  it("配置/连接/动作失败可重试，旧项目响应不覆盖当前项目，分析员被禁止访问", async () => {
    await start(); failConfig = true; await page.reload(); await page.getByText("模拟目标配置读取失败", { exact: true }).waitFor(); failConfig = false; await page.getByRole("button", { name: "重新加载配置" }).click();
    failConnect = true; await page.getByRole("button", { name: "连接服务器", exact: true }).click(); await page.getByText("模拟SSH认证失败", { exact: true }).first().waitFor();
    failConnect = false; await page.getByRole("button", { name: "重新连接", exact: true }).click(); await page.getByRole("checkbox", { name: "A", exact: true }).waitFor();
    await expect.poll(() => page.getByRole("button", { name: "刷新状态", exact: true }).isEnabled()).toBe(true);
    failAction = true; await page.getByRole("button", { name: "刷新状态", exact: true }).click(); await page.getByText("模拟操作失败", { exact: true }).first().waitFor();
    failAction = false; await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await expect.poll(() => page.getByRole("combobox", { name: "项目", exact: true }).isEnabled()).toBe(true);
    await page.getByRole("combobox", { name: "项目", exact: true }).selectOption({ label: "乙项目" });
    await expect.poll(() => page.getByRole("button", { name: "刷新状态", exact: true }).isEnabled()).toBe(true);
    git(sockets[1], "session-2", { project: projects[0], branch: projects[0].branches[0] }, undefined, "OLD STALE CONTEXT");
    expect(await page.getByText("OLD STALE CONTEXT", { exact: true }).count()).toBe(0);
    expect(errors).toEqual([]);
    await context.close(); await start("analyst"); expect((await page.request.get("/terminal", { maxRedirects: 0 })).status()).toBe(307); expect((await page.request.get("/api/terminal/targets")).status()).toBe(403); expect(sockets.length).toBe(0);
  });
});
