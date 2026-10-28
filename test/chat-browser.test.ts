import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
describe.skipIf(!baseURL)("智能助手完整浏览器流程", () => {
  let browser: Browser, context: BrowserContext, page: Page;
  let requests: Array<{ message: string; context: Array<{ docName: string }>; memories: string[] }>, mode: "ok" | "hold" | "truncated";
  let release: (() => void) | undefined; const errors: string[] = [];
  beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE }); });
  afterAll(async () => { await browser?.close(); }); afterEach(async () => { release?.(); await context?.close(); });
  async function login(username: string) { await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username, displayName: username, role: "analyst" }), url: baseURL! }]); }
  async function start() {
    requests = []; mode = "ok"; release = undefined; errors.length = 0;
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }); context.setDefaultTimeout(15_000); await login("alice-chat");
    await context.route("**/api/**", route => new URL(route.request().url()).pathname === "/api/auth/session" ? route.continue() : route.fulfill({ status: 500, json: { error: "未配置的验收接口" } }));
    await context.route("**/api/backup/**", route => route.fulfill({ json: { configured: false } }));
    await context.route("**/api/embeddings", route => route.fulfill({ status: 503, json: { error: "向量服务暂不可用" } }));
    await context.route("**/api/memory", route => route.fulfill({ json: route.request().postDataJSON().action === "extract" ? { memories: [{ content: "CAN 自动记忆", type: "fact", importance: 0.8 }] } : { decision: { action: "ADD" } } }));
    await context.route("**/api/chat", async route => {
      const request = route.request().postDataJSON(); requests.push(request); const currentMode = mode;
      if (currentMode === "hold") await new Promise<void>(resolve => { release = resolve; });
      const events = [{ type: "delta", text: "CAN 回答" }, ...(currentMode === "truncated" ? [] : [{ type: "done", reply: `CAN 完整回答 ${request.message}` }])];
      await route.fulfill({ contentType: "application/x-ndjson", body: events.map(event => JSON.stringify(event)).join("\n") + "\n" }).catch(() => undefined);
    });
    page = await context.newPage(); page.on("pageerror", error => errors.push(error.message)); await page.goto("/"); await open();
  }
  async function open() { await page.getByRole("button", { name: "打开智能助手", exact: true }).click(); await page.getByRole("tab", { name: "对话", exact: true }).waitFor(); }
  async function tab(name: string) { await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click(); }
  async function send(text: string) { await page.getByLabel("输入问题", { exact: true }).fill(text); await page.getByRole("button", { name: "发送", exact: true }).click(); }
  async function rows(table: string) { return page.evaluate(async name => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
    const rows = await new Promise<Array<Record<string, unknown>>>(resolve => { const request = database.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); }); database.close(); return rows;
  }, table); }
  it("知识库上传/检索、笔记版本与归档、记忆置顶、对话引用与账号隔离", async () => {
    await start(); await tab("知识库");
    const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "上传文档", exact: true }).click(); await (await chooser).setFiles({ name: "CAN规范.md", mimeType: "text/markdown", buffer: Buffer.from("CAN 信号排查规范：确认收发时序") });
    await page.getByText("CAN规范.md", { exact: true }).waitFor(); await page.getByText(/向量服务不可用，已仅按关键词检索/).waitFor();
    await page.getByLabel("检索知识库").fill("CAN"); expect((await rows("knowledgeDocs")).length).toBe(1);
    await tab("笔记"); await page.getByRole("button", { name: "新建笔记", exact: true }).first().click(); await page.getByLabel("标题", { exact: true }).fill("CAN笔记"); await page.getByLabel("正文", { exact: true }).fill("CAN 笔记初版"); await page.getByLabel("标签", { exact: true }).fill("CAN，排查"); await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "CAN笔记", exact: true }).click(); await page.getByLabel("正文", { exact: true }).fill("CAN 笔记新版"); await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "CAN笔记", exact: true }).click(); await page.getByRole("button", { name: "历史版本（1）", exact: true }).click(); await page.getByRole("button", { name: "恢复", exact: true }).click(); expect(await page.getByLabel("正文", { exact: true }).inputValue()).toBe("CAN 笔记初版"); await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "置顶", exact: true }).click(); await page.getByRole("button", { name: "归档", exact: true }).click(); await page.getByText("没有匹配的笔记", { exact: true }).waitFor();
    await tab("记忆"); await page.getByLabel("手动添加记忆").fill("CAN 用户偏好：先看信号"); await page.getByRole("button", { name: "添加记忆", exact: true }).click(); await page.getByText("CAN 用户偏好：先看信号", { exact: true }).waitFor(); await page.getByRole("button", { name: "置顶", exact: true }).click(); await page.getByText("已置顶", { exact: true }).waitFor();
    await tab("对话"); await send("CAN"); await page.getByText("CAN 完整回答 CAN", { exact: true }).waitFor();
    expect(requests[0].context.map(item => item.docName)).toEqual(["CAN规范.md"]); expect(requests[0].memories).toContain("CAN 用户偏好：先看信号"); await page.getByText("参考：CAN规范.md", { exact: true }).waitFor();
    await expect.poll(async () => (await rows("memories")).length).toBe(2);
    await tab("笔记"); await page.getByRole("switch", { name: "已归档", exact: true }).click(); await page.getByRole("button", { name: "取消归档", exact: true }).click();
    await tab("对话"); await send("CAN"); await expect.poll(() => requests.length).toBe(2); expect(requests[1].context.some(item => item.docName === "笔记：CAN笔记")).toBe(true);
    await page.getByRole("button", { name: "发送", exact: true }).waitFor();
    await page.reload(); await open(); await page.getByText("CAN 完整回答 CAN", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "清空对话", exact: true }).click(); await page.getByRole("dialog", { name: "清空对话", exact: true }).getByRole("button", { name: "清空", exact: true }).click(); await page.getByText("开始对话", { exact: true }).waitFor(); expect(await rows("chatMessages")).toHaveLength(0); expect(await rows("knowledgeDocs")).toHaveLength(1); expect(await rows("notes")).toHaveLength(1);
    await login("bob-chat"); await page.reload(); await open(); await tab("知识库"); await page.getByText("知识库为空", { exact: true }).waitFor(); await tab("记忆"); await page.getByText("暂无记忆", { exact: true }).waitFor(); await tab("笔记"); await page.getByText("暂无笔记", { exact: true }).waitFor(); expect(errors).toEqual([]);
  });
  it("关闭重开抽屉保留运行门禁与停止入口，后台完成后刷新可见", async () => {
    await start(); mode = "hold"; await send("后台运行"); await expect.poll(() => requests.length).toBe(1);
    await page.getByRole("dialog", { name: "智能助手", exact: true }).getByRole("button", { name: "关闭", exact: true }).click(); await open();
    expect(await page.getByRole("button", { name: "停止生成", exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "清空对话", exact: true }).isDisabled()).toBe(true); release?.();
    await page.getByText("CAN 完整回答 后台运行", { exact: true }).waitFor(); await page.reload(); await open(); await page.getByText("CAN 完整回答 后台运行", { exact: true }).waitFor(); expect(requests).toHaveLength(1); expect(errors).toEqual([]);
  });
  it("中断/停止不保存半截助手回复，失败后可继续发送；小屏无横向溢出", async () => {
    await start(); mode = "truncated"; await send("中断案例"); await page.getByText(/对话流已中断/).waitFor(); expect((await rows("chatMessages")).filter(row => row.role === "assistant")).toHaveLength(0);
    mode = "hold"; await send("停止案例"); await expect.poll(() => requests.length).toBe(2); await page.getByRole("button", { name: "停止生成", exact: true }).click(); release?.(); await page.getByRole("button", { name: "发送", exact: true }).waitFor();
    expect((await rows("chatMessages")).filter(row => row.role === "assistant")).toHaveLength(0);
    mode = "ok"; await send("恢复案例"); await page.getByText("CAN 完整回答 恢复案例", { exact: true }).waitFor();
    for (const width of [375, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); } expect(errors).toEqual([]);
  });
  it("导入分析/历史/标注可重复执行，文档、笔记和记忆支持确认删除", async () => {
    await start();
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["processResults", "analysisHistories", "reviewSamples"], "readwrite");
        tx.objectStore("processResults").put({ id: "r", source: "jira", ticketKey: "A-1", replyText: "原结论", manualCorrectResult: "人工纠正", reviewStatus: "rejected", createdAt: new Date() });
        tx.objectStore("analysisHistories").put({ id: "h", source: "meegle", ticketKey: "42", replyText: "历史结论", reviewStatus: "pending", resultCreatedAt: new Date(), archivedAt: new Date() });
        tx.objectStore("reviewSamples").put({ id: "s", source: "jira", ticketKey: "A-1", sampleKind: "rejected", wrongConclusion: "错误", correctConclusion: "正确", createdAt: new Date() });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); database.close();
    });
    await tab("知识库"); await page.getByRole("button", { name: "导入处理记录", exact: true }).click(); await page.getByText(/已导入 3 条/).waitFor();
    await page.getByRole("button", { name: "导入处理记录", exact: true }).click(); await page.getByText(/已导入 3 条/).waitFor(); expect(await rows("knowledgeDocs")).toHaveLength(3);
    await page.getByRole("button", { name: "删除 [Jira票] A-1", exact: true }).click(); await page.getByRole("dialog", { name: "删除文档", exact: true }).getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(async () => (await rows("knowledgeDocs")).length).toBe(2);
    await tab("记忆"); await page.getByLabel("手动添加记忆").fill("手动测试记忆"); await page.getByRole("button", { name: "添加记忆", exact: true }).click(); await page.getByText("手动测试记忆", { exact: true }).waitFor();
    await page.getByRole("button", { name: "删除记忆", exact: true }).click(); await page.getByRole("dialog", { name: "删除记忆", exact: true }).getByRole("button", { name: "删除", exact: true }).click(); await page.getByText("暂无记忆", { exact: true }).waitFor(); expect(await rows("memories")).toHaveLength(0);
    await tab("笔记"); await page.getByRole("button", { name: "新建笔记", exact: true }).first().click(); await page.getByLabel("标题", { exact: true }).fill("待删笔记"); await page.getByRole("button", { name: "保存", exact: true }).click(); await page.getByRole("button", { name: "删除笔记", exact: true }).click(); await page.getByRole("dialog", { name: "删除笔记", exact: true }).getByRole("button", { name: "删除", exact: true }).click();
    await page.getByText("暂无笔记", { exact: true }).waitFor(); expect(await rows("notes")).toHaveLength(0); expect(await rows("processResults")).toHaveLength(1); expect(errors).toEqual([]);
  });

  it("笔记冲突保留草稿，返回列表后读取另一标签页的最新内容", async () => {
    await start(); await tab("笔记"); await page.getByRole("button", { name: "新建笔记", exact: true }).first().click(); await page.getByLabel("标题", { exact: true }).fill("并发笔记"); await page.getByLabel("正文", { exact: true }).fill("原正文"); await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "并发笔记", exact: true }).click(); await page.getByLabel("正文", { exact: true }).fill("未保存草稿");
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>((resolve, reject) => { const tx = database.transaction("notes", "readwrite"); const store = tx.objectStore("notes"); const request = store.getAll(); request.onsuccess = () => store.put({ ...request.result[0], content: "另一标签页最新正文", updatedAt: new Date().toISOString() }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
    });
    await page.getByRole("button", { name: "保存", exact: true }).click(); await page.getByText(/笔记已被修改或删除/).waitFor(); expect(await page.getByLabel("正文", { exact: true }).inputValue()).toBe("未保存草稿");
    await page.getByRole("button", { name: "返回笔记列表", exact: true }).click(); await page.getByText("另一标签页最新正文", { exact: true }).waitFor(); await page.getByRole("button", { name: "并发笔记", exact: true }).click(); expect(await page.getByLabel("正文", { exact: true }).inputValue()).toBe("另一标签页最新正文"); expect(errors).toEqual([]);
  });

});
