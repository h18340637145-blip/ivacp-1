import { expect, it } from "vitest";
import { chromium } from "playwright";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
it.skipIf(!baseURL)("数据管理导出、导入预览确认、旧库探测及自动周期刷新持久化", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    context.setDefaultTimeout(20_000);
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "data-browser-test", displayName: "数据验收", role: "admin" }), url: baseURL! }]);
    await context.route("**/api/backup/**", route => route.fulfill({ json: { configured: false } }));
    await context.route("**/api/migration/legacy**", route => route.fulfill({ json: { configured: false, runs: [] } }));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/settings/data");
    await page.getByText("当前来源未发现旧库", { exact: true }).waitFor();
    const exported = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 JSON 备份", exact: true }).click();
    expect((await exported).suggestedFilename()).toMatch(/^ivacp-backup-.*\.json$/);
    const group = { id: "data-g1", name: "数据验收组", jql: "", expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: {}, sortOrder: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await page.getByLabel("选择 JSON 数据备份").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "ivacp-backup", version: 1, tables: { ruleGroups: [group] } })) });
    await page.getByRole("heading", { name: "导入备份预览", exact: true }).waitFor();
    expect(await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      const total = await new Promise<number>(resolve => { const request = database.transaction("ruleGroups").objectStore("ruleGroups").count(); request.onsuccess = () => resolve(request.result); });
      database.close(); return total;
    })).toBe(0);
    await page.getByRole("button", { name: "确认合并导入", exact: true }).click();
    await page.getByRole("heading", { name: "导入备份预览", exact: true }).waitFor({ state: "hidden" });
    await page.goto("/");
    await page.getByRole("heading", { name: "数据验收组", exact: true }).waitFor();
    // 预设未来到期时间，验收开关持久化不触发实际分析。
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>(resolve => { const tx = database.transaction("autoCycles", "readwrite"); tx.objectStore("autoCycles").put({ ruleGroupId: "data-g1", isActive: false, intervalMinutes: 5, nextRunAt: new Date(Date.now() + 3600_000) }); tx.oncomplete = () => resolve(); }); database.close();
    });
    await page.reload();
    const toggle = page.getByRole("switch", { name: "自动筛票并分析" });
    await toggle.click();
    await expect.poll(() => toggle.isChecked()).toBe(true);
    await page.reload();
    await expect.poll(() => toggle.isChecked()).toBe(true);
    await toggle.click();
    await expect.poll(() => toggle.isChecked()).toBe(false);
    await page.reload();
    await expect.poll(() => toggle.isChecked()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await context.close(); await browser.close(); }
}, 120_000);
