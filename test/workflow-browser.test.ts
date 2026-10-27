import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;

describe.skipIf(!baseURL)("双来源分析与复核浏览器验收", () => {
  let browser: Browser, context: BrowserContext, page: Page;
  let meegleFailed = false, processFailed = false, comments = 0, screenshots = 0;
  let jiraComments = 0;
  let jiraDelay: Promise<void> | undefined;
  const errors: string[] = [];
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE });
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(15_000);
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "workflow-test", displayName: "工作流验收", role: "admin" }), url: baseURL! }]);
    await context.route("**/api/backup/**", (route) => route.fulfill({ json: { configured: false } }));
    await context.route("**/api/jira/filter", (route) => route.fulfill({ json: { issues: [{ key: "TEST-1", summary: "实车 D01 信号测试", status: "Open", description: "工单描述", comments: [], attachments: [] }], total: 1 } }));
    await context.route("**/api/meegle/filter", (route) => {
      const item = { projectKey: "p", projectName: "项目", workItemTypeKey: "issue", workItemId: 99, workItemName: "实车 D01 飞书测试", stateName: "处理中", rawData: {} };
      return route.fulfill({ json: { runId: "filter-remote", filterResults: { g1: meegleFailed ? [] : [item] }, successfulRuleGroupIds: meegleFailed ? [] : ["g1"], audits: [{ id: `audit-${Date.now()}`, runId: "filter-remote", trigger: "all", ...item, model: "MQL", carModel: "", project: "", platform: "", decision: meegleFailed ? "failed" : "assigned", matchedRuleGroupId: "g1", reason: meegleFailed ? "CLI 请重新登录" : "MQL 命中", createdAt: new Date().toISOString() }] } });
    });
    await context.route("**/api/meegle/context", (route) => route.fulfill({ json: { rawData: { description: "飞书描述", comments: [], attachments: [] } } }));
    await context.route("**/api/issues/process", async (route) => {
      const body = route.request().postDataJSON() as { source: string; issueKey: string };
      return route.fulfill({ status: processFailed ? 500 : 200, json: processFailed ? { error: "模型不可用" } : {
        issueKey: body.issueKey, replyText: `分析结论：${body.source} 通过，证据已核对。`, model: "qwen-test", tokenUsage: 456,
        chartImage: "/api/charts/log/test/can_signals.png", traceData: { SOC: { x: ["2026-10-27 12:00:00.000", "2026-10-27 12:00:01.000"], y: [89, 100] } },
        ticks: { SOC: { ticks: [0, 1], labels: ["关", "开"] } }, stages: { DONE: "完成" }, artifactRef: body.source === "meegle" ? "signed-ref" : undefined,
        analysisReceipt: body.source === "meegle" ? "signed-receipt" : undefined,
      } });
    });
    await context.route("**/api/issues/review", (route) => route.fulfill({ json: { verdict: "PASS", reason: "AI 建议通过" } }));
    await context.route("**/api/embeddings", (route) => {
      const { input } = route.request().postDataJSON() as { input: string[] };
      return route.fulfill({ json: { model: "embedding-test", embeddings: input.map(() => [1, 0, 0]) } });
    });
    await context.route("**/api/jira/handover", (route) => route.fulfill({ json: {} }));
    await context.route("**/api/jira/comment", async (route) => { jiraComments++; if (jiraDelay) await jiraDelay; return route.fulfill({ json: { success: true, commentId: "jira-comment1" } }); });
    await context.route("**/api/feishu/process-result", (route) => route.fulfill({ json: { success: true } }));
    await context.route("**/api/meegle/authorize", (route) => route.fulfill({ json: { authorization: "write-authorization" } }));
    await context.route("**/api/meegle/comment", (route) => { comments++; return route.fulfill({ json: { success: true, commentId: "comment1" } }); });
    await context.route("**/api/issues/save-screenshot", (route) => {
      const payload = route.request().postDataJSON() as { imageBase64: string };
      expect(payload.imageBase64.startsWith("data:image/png;base64,")).toBe(true);
      expect(payload.imageBase64.length).toBeGreaterThan(2000);
      screenshots++; return route.fulfill({ json: { success: true } });
    });
    page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/"); await page.getByText("创建第一个规则组", { exact: true }).waitFor();
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      try { await new Promise<void>((resolve, reject) => {
        const tx = database.transaction("ruleGroups", "readwrite");
        tx.objectStore("ruleGroups").put({ id: "g1", name: "双来源测试组", jql: "project = TEST", meegleMql: "SELECT * FROM `p`.`issue`", expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: {}, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); } finally { database.close(); }
    });
    await page.reload(); await page.getByRole("heading", { name: "双来源测试组", exact: true }).waitFor();
  });
  afterAll(async () => { await context?.close(); await browser?.close(); });
  afterEach(async (test) => {
    if (test.task.result?.state === "fail") {
      await writeFile("/tmp/ivacp-workflow-browser-failure.txt", `${page.url()}\n${await page.locator("body").innerText()}`, "utf8");
      await page.screenshot({ path: "/tmp/ivacp-workflow-browser-failure.png", fullPage: true });
    }
  });

  async function count(table: string) {
    return page.evaluate(async (name) => {
      const database = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      try { return await new Promise<number>((resolve) => { const request = database.transaction(name).objectStore(name).count(); request.onsuccess = () => resolve(request.result); }); }
      finally { database.close(); }
    }, table);
  }

  it("双来源筛票、单票分析、校验改判、曲线截图与重跑失败保留历史", async () => {
    await page.getByRole("button", { name: "一键筛选", exact: true }).click();
    await expect.poll(async () => (await page.getByText("1 票", { exact: true }).count())).toBe(2);
    await page.getByRole("link", { name: "查看工单", exact: true }).click();
    await page.getByRole("link", { name: "TEST-1", exact: true }).waitFor();
    await page.getByRole("button", { name: "分析", exact: true }).click();
    await expect.poll(() => count("processResults")).toBe(1);
    await page.getByRole("link", { name: "TEST-1", exact: true }).click();
    await page.getByText("分析结论：jira 通过，证据已核对。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "人工通过", exact: true }).click();
    await page.getByRole("button", { name: "回填结论", exact: true }).waitFor();
    const validation = page.getByRole("link", { name: /查看校验/ });
    await validation.click();
    await page.getByRole("combobox", { name: "人工判定", exact: true }).click();
    await page.getByRole("option", { name: "冲突", exact: true }).click();
    await page.getByLabel("改判原因", { exact: false }).fill("人工确认时间存在偏差");
    await page.getByRole("button", { name: "保存改判", exact: true }).click();
    await page.getByText(/人工改判：冲突/).waitFor();
    await page.getByRole("link", { name: "返回分析结果", exact: true }).click();
    await page.getByRole("tab", { name: "CAN 与日志", exact: true }).click();
    await page.locator("canvas").first().waitFor();
    const hasNonEmptyCanvas = await page.locator("canvas").first().evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      return Array.from(data).some((value) => value !== 0);
    });
    expect(hasNonEmptyCanvas).toBe(true);
    await page.getByRole("button", { name: "锁定回填图", exact: true }).click();
    await expect.poll(() => screenshots).toBe(1);
    processFailed = true;
    await page.getByRole("button", { name: "重新分析", exact: true }).click();
    await page.getByText(/模型不可用/).first().waitFor();
    expect(await count("processResults")).toBe(1);
    expect(await count("analysisHistories")).toBe(1);
    await page.getByRole("tab", { name: "结论", exact: true }).click();
    await page.getByText("分析结论：jira 通过，证据已核对。", { exact: true }).waitFor();
    processFailed = false;
  });

  it("飞书人工门禁、回填持久化、失败来源隔离和刷新保留", async () => {
    await page.goto("/rule-groups/g1?source=meegle");
    await page.getByRole("link", { name: "99", exact: true }).waitFor();
    await page.getByRole("button", { name: "分析", exact: true }).click();
    await expect.poll(() => count("processResults"), { timeout: 15_000 }).toBe(2);
    await page.getByRole("link", { name: "99", exact: true }).click();
    await page.getByText("分析结论：meegle 通过，证据已核对。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "AI 复核", exact: true }).click();
    await page.getByText("AI 建议通过", { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "回填结论", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "人工通过", exact: true }).click();
    await page.getByRole("button", { name: "回填结论", exact: true }).click();
    await page.getByRole("button", { name: "确认回填", exact: true }).click();
    await expect.poll(() => comments).toBe(1);
    await page.getByText("已回填", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("已回填", { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "回填结论", exact: true }).count()).toBe(0);
    await page.setViewportSize({ width: 375, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    meegleFailed = true;
    await page.goto("/rule-groups/g1?source=meegle");
    await page.getByRole("button", { name: "筛选工单", exact: true }).click();
    await page.getByText("CLI 请重新登录", { exact: true }).first().waitFor();
    expect(await page.getByRole("link", { name: "99", exact: true }).count()).toBe(0);
    await page.reload();
    await page.getByText("CLI 请重新登录", { exact: true }).first().waitFor();
    await page.getByRole("tab", { name: /Jira/ }).click();
    await page.getByRole("link", { name: "TEST-1", exact: true }).waitFor();
    expect(await count("processResults")).toBe(2);
    expect(errors).toEqual([]);
  });

  it("两个标签页同时回填同一 Jira 结果只发表一次评论", async () => {
    const other = await context.newPage(); other.on("pageerror", (error) => errors.push(error.message));
    let release!: () => void;
    jiraDelay = new Promise<void>((resolve) => { release = resolve; });
    try {
      await Promise.all([page.goto("/tickets/jira/TEST-1?group=g1"), other.goto("/tickets/jira/TEST-1?group=g1")]);
      await Promise.all([page.getByRole("button", { name: "回填结论", exact: true }).click(), other.getByRole("button", { name: "回填结论", exact: true }).click()]);
      await Promise.all([page.getByRole("button", { name: "确认回填", exact: true }).click(), other.getByRole("button", { name: "确认回填", exact: true }).click()]);
      await expect.poll(async () => (await page.getByText(/其他页面正在回填/).count()) + (await other.getByText(/其他页面正在回填/).count()), { timeout: 10_000 }).toBeGreaterThan(0);
      expect(jiraComments).toBe(1);
      release();
      await expect.poll(async () => (await page.getByText("已回填", { exact: true }).count()) + (await other.getByText("已回填", { exact: true }).count()), { timeout: 10_000 }).toBe(2);
    } finally { release(); jiraDelay = undefined; await other.close(); }
    expect(errors).toEqual([]);
  });
});
