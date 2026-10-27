import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";

// 显式指定本地服务器才运行；独立浏览器数据库，屏蔽镜像请求，不写真实账号的数据。
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
describe.skipIf(!baseURL)("规则组看板浏览器验收", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const errors: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE });
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{
      name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "kanban-browser-test", displayName: "看板验收", role: "admin" }), url: baseURL!,
    }]);
    await context.route("**/api/backup/**", (route) => route.fulfill({ json: { configured: false } }));
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
  });
  afterAll(async () => { await context?.close(); await browser?.close(); });

  async function rows() {
    return page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("IvacpDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<Array<{ id: string; name: string; sortOrder: number; jql: string; meegleMql?: string; jiraProvider?: string; model_to_files: Record<string, { dbc: string[] }>; prompts: Record<string, string> }>>((resolve, reject) => {
          const request = database.transaction("ruleGroups").objectStore("ruleGroups").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally { database.close(); }
    });
  }

  it("新建、编辑、排序、导入导出、刷新持久化与删除", async () => {
    await page.goto("/");
    await page.getByText("创建第一个规则组", { exact: true }).waitFor();
    await page.getByRole("button", { name: "新建规则组", exact: true }).click();
    await page.getByLabel("规则组名称", { exact: false }).fill("奇瑞测试组");
    await page.getByLabel("Jira JQL", { exact: true }).fill("project = TEST");
    await page.getByLabel("飞书项目 MQL", { exact: true }).fill("SELECT * FROM project_test.issue");
    await page.getByLabel("JSON 根目录", { exact: true }).fill("/test/json");
    await page.getByRole("button", { name: "添加车型", exact: true }).click();
    await page.getByLabel("车型名称", { exact: true }).fill("D01");
    await page.getByLabel("DBC 文件（逗号分隔）", { exact: true }).fill("a.dbc, b.dbc");
    await page.getByText("分析提示词（6 项）", { exact: true }).click();
    await page.getByLabel("一致性分析", { exact: true }).fill("请依据证据分析");
    await page.getByRole("button", { name: "保存规则组", exact: true }).click();
    await page.getByRole("heading", { name: "奇瑞测试组", exact: true }).waitFor();
    const [created] = await rows();
    expect(created.model_to_files.D01.dbc).toEqual(["a.dbc", "b.dbc"]);
    expect(created.prompts.CONSISTENCY_SYSTEM).toBe("请依据证据分析");
    await page.reload();
    await page.getByRole("heading", { name: "奇瑞测试组", exact: true }).waitFor();
    await page.getByRole("button", { name: "编辑配置", exact: true }).click();
    await page.getByLabel("规则组名称", { exact: false }).fill("奇瑞已编辑");
    await page.getByRole("button", { name: "保存规则组", exact: true }).click();
    await page.getByRole("heading", { name: "奇瑞已编辑", exact: true }).waitFor();
    expect((await rows())[0].id).toBe(created.id);

    await page.getByRole("button", { name: "新建 Bosch Jira 规则组", exact: true }).click();
    await page.getByLabel("规则组名称", { exact: false }).fill("Bosch 测试组");
    await page.getByLabel("Bosch Jira JQL", { exact: true }).fill("project = BOSCH");
    expect(await page.getByLabel("飞书项目 MQL", { exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "保存规则组", exact: true }).click();
    await page.getByRole("heading", { name: "Bosch 测试组", exact: true }).waitFor();
    const handle = page.getByRole("button", { name: "拖拽排序 Bosch 测试组", exact: true });
    await handle.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => page.locator('[aria-pressed="true"]').count()).toBe(1);
    // KeyboardSensor 通过 setTimeout 注册监听器，拖拽区域也在下一帧测量。
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.keyboard.press("ArrowLeft");
    // 等待目标更新再放置，键盘移动与放置不能在同一渲染帧内完成。
    await expect.poll(() => page.locator('[id^="DndLiveRegion"]').textContent()).toContain(`over droppable area ${created.id}`);
    await page.keyboard.press("Space");
    await expect.poll(async () => (await rows()).sort((a, b) => a.sortOrder - b.sortOrder)[0]?.name).toBe("Bosch 测试组");
    await page.reload();
    await page.getByRole("heading", { name: "Bosch 测试组", exact: true }).waitFor();
    expect(await page.locator("article h2").allTextContents()).toEqual(["Bosch 测试组", "奇瑞已编辑"]);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出规则组", exact: true }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(exported.ruleGroups).toHaveLength(2);
    exported.ruleGroups.find((row: { id: string }) => row.id === created.id).name = "合并导入组";
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page.getByLabel("规则组文件", { exact: true }).setInputFiles({ name: "groups.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
    await page.getByText("已校验 2 个规则组", { exact: true }).waitFor();
    await page.getByRole("button", { name: "确认合并导入", exact: true }).click();
    await page.getByRole("heading", { name: "合并导入组", exact: true }).waitFor();
    expect(await page.locator("article h2").allTextContents()).toEqual(["Bosch 测试组", "合并导入组"]);

    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page.getByLabel("规则组文件", { exact: true }).setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ruleGroups: [exported.ruleGroups[0], exported.ruleGroups[0]] })) });
    await page.getByText(/规则组 ID 重复/).waitFor();
    expect(await page.getByRole("button", { name: "确认合并导入", exact: true }).isDisabled()).toBe(true);
    expect(await rows()).toHaveLength(2);
    await page.getByRole("button", { name: "取消", exact: true }).click();

    // 覆盖只替换规则组，不能顺带清理分析数据。
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("IvacpDB");
        request.onsuccess = () => resolve(request.result);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction(["ruleGroups", "processResults"], "readwrite");
          tx.objectStore("ruleGroups").put({ id: "overwrite-extra", name: "覆盖前额外配置", sortOrder: 99, jql: "", base_paths: {}, model_to_files: {}, prompts: {}, createdAt: new Date(), updatedAt: new Date() });
          tx.objectStore("processResults").put({ id: "browser-result", source: "jira", ticketKey: "TEST-1", replyText: "保留的结论", createdAt: new Date() });
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        });
      } finally { database.close(); }
    });
    await page.reload();
    await page.getByRole("heading", { name: "覆盖前额外配置", exact: true }).waitFor();
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page.getByLabel("规则组文件", { exact: true }).setInputFiles({ name: "overwrite.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
    await page.getByText("已校验 2 个规则组", { exact: true }).waitFor();
    await page.getByLabel("导入方式", { exact: true }).click();
    await page.getByRole("option", { name: "覆盖：替换全部规则组配置", exact: true }).click();
    await page.getByRole("button", { name: "确认覆盖导入", exact: true }).click();
    await expect.poll(async () => (await rows()).length).toBe(2);
    expect(await page.getByRole("heading", { name: "覆盖前额外配置", exact: true }).count()).toBe(0);
    const resultPreserved = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result);
      });
      try { return await new Promise<boolean>((resolve) => {
        const request = database.transaction("processResults").objectStore("processResults").get("browser-result");
        request.onsuccess = () => resolve(request.result?.replyText === "保留的结论");
      }); } finally { database.close(); }
    });
    expect(resultPreserved).toBe(true);

    await page.getByRole("textbox", { name: "搜索规则组", exact: true }).fill("Bosch");
    expect(await page.locator("article").count()).toBe(1);
    expect(await page.getByRole("button", { name: "拖拽排序 Bosch 测试组", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("textbox", { name: "搜索规则组", exact: true }).fill("");
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 375, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await page.getByRole("textbox", { name: "搜索规则组", exact: true }).boundingBox())!.width).toBeGreaterThan(300);
    await page.screenshot({ path: "/tmp/ivacp-kanban-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "/tmp/ivacp-kanban-desktop.png", fullPage: true });
    await page.getByRole("button", { name: "删除 合并导入组", exact: true }).click();
    await page.getByRole("button", { name: "删除规则组", exact: true }).click();
    await expect.poll(async () => (await rows()).length).toBe(1);
    await page.reload();
    await page.getByRole("heading", { name: "Bosch 测试组", exact: true }).waitFor();
    expect(await page.locator("article").count()).toBe(1);
    expect(errors).toEqual([]);
  });

  it("普通分析员仅查看配置，不能管理或排序", async () => {
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "kanban-browser-test", displayName: "看板验收", role: "analyst" }), url: baseURL! }]);
    await page.reload();
    await page.getByRole("button", { name: "查看配置", exact: true }).first().waitFor();
    expect(await page.getByRole("button", { name: "新建规则组", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /拖拽排序/ }).count()).toBe(0);
    await page.getByRole("button", { name: "查看配置", exact: true }).first().click();
    expect(await page.getByLabel("规则组名称", { exact: false }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "保存规则组", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "关闭", exact: true }).first().click();
  });
});
