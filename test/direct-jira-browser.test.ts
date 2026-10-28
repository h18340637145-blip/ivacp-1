import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
describe.skipIf(!baseURL)("指定Jira票号浏览器验收", () => {
  let browser: Browser, context: BrowserContext, page: Page;
  let requests: Record<string, unknown>[], searches: Record<string, unknown>[], fail: boolean, title: string, missing: boolean;
  const errors: string[] = [];
  beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE }); });
  afterAll(async () => { await browser?.close(); }); afterEach(async () => { await context?.close(); });
  async function start() {
    requests = []; searches = []; fail = false; missing = false; title = "【D01】实车信号问题"; errors.length = 0;
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }); context.setDefaultTimeout(20_000);
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "direct-test", displayName: "单票验收", role: "analyst" }), url: baseURL! }]);
    await context.route("**/api/**", route => new URL(route.request().url()).pathname === "/api/auth/session" ? route.continue() : route.fulfill({ status: 500, json: { error: "未配置的验收接口" } }));
    await context.route("**/api/backup/**", route => route.fulfill({ json: { configured: false } }));
    await context.route("**/api/jira/filter", route => { searches.push(route.request().postDataJSON()); return route.fulfill({ json: { issues: missing ? [] : [{ key: "TEST-1", summary: title, status: "Open", description: "原始描述", comments: [], attachments: [] }], total: missing ? 0 : 1 } }); });
    await context.route("**/api/issues/process", route => {
      const body = route.request().postDataJSON(); requests.push(body);
      return route.fulfill({ status: fail && body.ruleGroupId === "g2" ? 500 : 200, json: fail && body.ruleGroupId === "g2" ? { error: "模型暂不可用" } : { issueKey: body.issueKey, replyText: `分析结论：${body.jiraProvider === "bosch" ? "Bosch" : "默认"} ${body.ruleGroupId} 通过`, model: "test", stages: { DONE: "完成" } } });
    });
    await context.route("**/api/jira/handover", route => route.fulfill({ json: {} }));
    await context.route("**/api/feishu/process-result", route => route.fulfill({ json: { success: true } }));
    page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto("/"); await page.getByText("创建第一个规则组", { exact: true }).waitFor();
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["ruleGroups", "filterRuns"], "readwrite");
        for (const [index, id] of ["g1", "g2", "g3"].entries()) tx.objectStore("ruleGroups").put({ id, name: id === "g3" ? "Bosch组" : `默认组${index + 1}`, jql: "project = OTHER", jiraProvider: id === "g3" ? "bosch" : undefined, expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: { D01: { json: "sample.json", dbc: ["sample.dbc"], proto: "sample.proto" } }, prompts: {}, sortOrder: index, createdAt: new Date(), updatedAt: new Date() });
        tx.objectStore("filterRuns").put({ id: "batch", source: "jira", ruleGroupId: "g1", query: "project = OTHER", status: "completed", issueCount: 7, createdAt: new Date(), completedAt: new Date() });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); database.close();
    });
    await page.reload(); await page.getByLabel("Jira 工单票号", { exact: true }).waitFor();
  }
  async function submit(value = " test-1 ") { await page.getByLabel("Jira 工单票号", { exact: true }).fill(value); await page.getByRole("button", { name: "分析指定工单", exact: true }).click(); }
  async function counts() { return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
    const tables = ["processResults", "analysisHistories", "processTasks", "filterRuns"];
    const count = await Promise.all(tables.map(name => new Promise<number>(resolve => { const request = database.transaction(name).objectStore(name).count(); request.onsuccess = () => resolve(request.result); })));
    database.close(); return Object.fromEntries(tables.map((name, index) => [name, count[index]]));
  }); }
  it("分析员可直接分析全部匹配组，失败逐组展示；重跑保留历史，详情刷新持久化且不影响批量筛票", async () => {
    await start(); fail = true; await submit();
    await page.getByText("模型暂不可用", { exact: true }).waitFor();
    expect(requests).toHaveLength(2); expect(searches).toEqual([{ jql: "issue = TEST-1" }]);
    expect((await counts()).filterRuns).toBe(1);
    fail = false; await page.getByRole("button", { name: "分析指定工单", exact: true }).click();
    await page.getByText("本轮结束：2 个完成，0 个失败；各组状态见下方。", { exact: true }).waitFor();
    expect(await counts()).toMatchObject({ processResults: 3, analysisHistories: 1, processTasks: 4, filterRuns: 1 });
    await page.getByRole("link", { name: "查看 默认组1 的单票分析", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/tickets/jira/TEST-1");
    expect(new URL(page.url()).searchParams.get("provider")).toBe("default");
    await page.getByText("分析结论：默认 g1 通过", { exact: true }).first().waitFor(); await page.reload();
    await page.getByText("分析结论：默认 g1 通过", { exact: true }).first().waitFor();
    await page.goto("/"); await page.reload();
    await page.getByRole("link", { name: "打开默认 Jira TEST-1 · 默认组1", exact: true }).click();
    await page.getByText("分析结论：默认 g1 通过", { exact: true }).first().waitFor();
    expect(requests).toHaveLength(4); expect(errors).toEqual([]);
  });
  it("Bosch显式查询和处理，不触发默认站点组；非法/缺票/缺车型不创建任务", async () => {
    await start(); await submit("TEST-1 OR project=SECRET"); await page.getByText("请输入有效的 Jira 票号，例如 CHER-129770", { exact: true }).waitFor(); expect(searches).toHaveLength(0);
    missing = true; await submit(); await page.getByText("未找到 Jira 工单 TEST-1", { exact: true }).waitFor(); expect((await counts()).processTasks).toBe(0);
    missing = false; title = "没有车型标识"; await submit(); await page.getByText("无法从标题的 [] 或【】中提取车型，请核对工单标题", { exact: true }).waitFor();
    title = "[D01] Bosch实车问题";
    await page.getByRole("combobox", { name: "Jira 站点", exact: true }).click(); await page.getByRole("option", { name: "Bosch Jira", exact: true }).click(); await submit();
    await page.getByText("本轮结束：1 个完成，0 个失败；各组状态见下方。", { exact: true }).waitFor();
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ jiraProvider: "bosch", ruleGroupId: "g3" }); expect(searches.at(-1)).toMatchObject({ provider: "bosch" });
    await page.getByRole("link", { name: "查看 Bosch组 的单票分析", exact: true }).click(); await page.getByText("分析结论：Bosch g3 通过", { exact: true }).first().waitFor();
    expect(new URL(page.url()).searchParams.get("provider")).toBe("bosch"); expect(errors).toEqual([]);
  });
  it("入口在小屏与空查询下可用，无横向溢出", async () => {
    await start(); expect(await page.getByRole("button", { name: "分析指定工单", exact: true }).isDisabled()).toBe(true);
    for (const width of [375, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    await page.screenshot({ path: "/tmp/ivacp-direct-desktop.png", fullPage: true }); expect(errors).toEqual([]);
  });
});
