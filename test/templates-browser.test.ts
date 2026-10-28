import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
import { buildTemplate, type RuleGroupTemplate } from "@/domain/templates/rule-group-template";
import type { RuleGroup } from "@/domain/entities";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
const group: RuleGroup = { id: "g1", name: "模板验收组", jql: "project = SAMPLE", meegleMql: "SELECT * FROM p.issue", expand: "changelog", base_paths: { json_dir: "/json", dbc_dir: "/dbc", proto_dir: "/proto" }, model_to_files: { D01: { json: "a.json", dbc: ["a.dbc"], proto: "a.proto" } }, prompts: { EXTRACT_SIGNALS_SYSTEM: "提取信号", REQUIREMENT_EXTRACT_SYSTEM: "", LOG_SUMMARY_SYSTEM: "", ANDROID_QNX_LOG_SUMMARY_SYSTEM: "", CONSISTENCY_SYSTEM: "复核结论", COMPARE_CANTRACE: "" }, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() };
const initial = () => buildTemplate(group, { templateKey: "shared", version: 2, name: "共享模板", author: "alice", tags: ["CAN"] });
describe.skipIf(!baseURL)("团队模板库浏览器验收", () => {
  let browser: Browser, context: BrowserContext, page: Page;
  let templates: RuleGroupTemplate[], failList: boolean, failDelete: boolean, failApply: boolean;
  let published: Record<string, unknown>[], applied: Record<string, unknown>[], deleted: string[];
  const errors: string[] = [];
  beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE }); });
  afterAll(async () => { await browser?.close(); }); afterEach(async () => { await context?.close(); });
  async function start(role: "admin" | "analyst" = "admin") {
    templates = [initial()]; failList = false; failDelete = false; failApply = false; published = []; applied = []; deleted = []; errors.length = 0;
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }); context.setDefaultTimeout(15_000);
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "bob", displayName: "模板验收", role }), url: baseURL! }]);
    await context.route("**/api/**", route => new URL(route.request().url()).pathname === "/api/auth/session" ? route.continue() : route.fulfill({ status: 500, json: { error: "未配置的验收接口" } }));
    await context.route("**/api/backup/**", route => route.fulfill({ json: { configured: false } }));
    await context.route("**/api/templates**", async route => {
      const request = route.request(); const url = new URL(request.url()); const key = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      if (url.pathname === "/api/templates") {
        if (request.method() === "POST") { const body = request.postDataJSON(); published.push(body); const previous = templates.find(t => t.templateKey === body.templateKey); const created = previous?.checksum !== body.checksum; const template = previous && !created ? previous : { ...body, author: previous?.author ?? "bob", version: (previous?.version ?? 0) + 1 }; templates = [...templates.filter(t => t.templateKey !== body.templateKey), template]; return route.fulfill({ json: { template, created } }); }
        return route.fulfill({ status: failList ? 503 : 200, json: failList ? { error: "团队库暂不可用" } : { templates: templates.map(t => ({ ...t, versionCount: t.version, applyCount: applied.filter(a => a.key === t.templateKey).length })) } });
      }
      if (request.method() === "DELETE") { deleted.push(key); if (failDelete) return route.fulfill({ status: 503, json: { error: "删除暂不可用" } }); templates = templates.filter(t => t.templateKey !== key); return route.fulfill({ json: { success: true } }); }
      if (url.pathname.endsWith("/applied")) { applied.push({ key, ...request.postDataJSON() }); return route.fulfill({ status: failApply ? 503 : 200, json: failApply ? { error: "计数暂不可用" } : { success: true } }); }
      return route.fulfill({ json: { template: templates.find(t => t.templateKey === key) } });
    });
    page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto("/templates"); await page.locator("li").filter({ hasText: "共享模板" }).waitFor();
    await page.evaluate(async value => {
      const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>(resolve => { const tx = database.transaction("ruleGroups", "readwrite"); tx.objectStore("ruleGroups").put({ ...value, createdAt: new Date(), updatedAt: new Date() }); tx.oncomplete = () => resolve(); }); database.close();
    }, group);
    await page.reload(); await page.locator("li").filter({ hasText: "共享模板" }).waitFor();
  }
  async function groups() { return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
    const rows = await new Promise<Array<{ name: string; jql: string }>>(resolve => { const request = database.transaction("ruleGroups").objectStore("ruleGroups").getAll(); request.onsuccess = () => resolve(request.result); }); database.close(); return rows;
  }); }
  it("发布/导出/搜索/应用、计数失败不重复建组，刷新后看板保留配置", async () => {
    await start();
    await page.getByRole("combobox", { name: "选择规则组", exact: true }).click(); await page.getByRole("option", { name: group.name, exact: true }).click();
    await page.getByLabel("模板名称", { exact: true }).fill("我的模板"); await page.getByLabel("标签", { exact: true }).fill("CAN，实车");
    await page.getByRole("button", { name: "发布到团队库", exact: true }).click(); await page.locator("li").filter({ hasText: "我的模板" }).waitFor();
    expect(published[0]).toMatchObject({ templateKey: "我的模板", config: { jql: group.jql, meegleMql: group.meegleMql, model_to_files: group.model_to_files, prompts: group.prompts } });
    expect(published[0].config).not.toHaveProperty("id");
    await page.getByRole("button", { name: "发布到团队库", exact: true }).click();
    await page.getByText("配置与「我的模板」v1 相同，未生成新版本", { exact: true }).waitFor();
    expect(templates.filter(template => template.templateKey === "我的模板")).toHaveLength(1);
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "导出模板文件", exact: true }).click(); const exported = await download; expect(exported.suggestedFilename()).toBe("template-我的模板-v1.json");
    const exportedTemplate = JSON.parse(await readFile((await exported.path())!, "utf8"));
    expect(exportedTemplate).toMatchObject({ kind: "rule-group-template", config: { model_to_files: group.model_to_files, prompts: group.prompts } });
    expect(exportedTemplate.config).not.toHaveProperty("id");
    await page.getByLabel("搜索模板", { exact: true }).fill("alice"); expect(await page.locator("li").filter({ hasText: "我的模板" }).count()).toBe(0);
    failApply = true; await page.getByRole("button", { name: "应用", exact: true }).click(); await page.getByText("模板已应用", { exact: true }).waitFor();
    expect((await groups()).map(row => row.name).sort()).toEqual(["共享模板（模板 v2）", group.name].sort()); expect(applied).toEqual([{ key: "shared", version: 2 }]);
    expect((await groups()).find(row => row.name === "共享模板（模板 v2）")).toMatchObject({ model_to_files: group.model_to_files, prompts: group.prompts, meegleMql: group.meegleMql });
    await page.goto("/"); await page.reload(); await page.getByRole("heading", { name: "共享模板（模板 v2）", exact: true }).waitFor();
    expect((await groups()).find(row => row.name === group.name)?.jql).toBe(group.jql); expect(errors).toEqual([]);
  });
  it("文件应用独立于服务器、拒绝损坏配置，删除失败保留确认并可重试", async () => {
    await start(); const count = (await groups()).length;
    const upload = async (value: unknown) => {
      await expect.poll(() => page.getByRole("button", { name: "从文件应用", exact: true }).isEnabled()).toBe(true);
      await page.getByLabel("选择模板文件", { exact: true }).setInputFiles({ name: "template.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
    };
    await upload({ ...initial(), config: { ...initial().config, model_to_files: { D01: { dbc: 42 } } } });
    await page.getByText(/模板车型文件配置无效/).waitFor(); expect((await groups()).length).toBe(count);
    failList = true; await page.reload(); await page.getByText(/团队库暂不可用/).waitFor();
    await upload(initial()); await page.getByText("模板已应用", { exact: true }).waitFor(); expect((await groups()).length).toBe(count + 1);
    failList = false; await page.getByRole("button", { name: "重试", exact: true }).click(); await page.locator("li").filter({ hasText: "共享模板" }).waitFor();
    failDelete = true; await page.getByRole("button", { name: "删除", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "删除模板" }); await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await dialog.getByText(/删除暂不可用/).waitFor(); expect(await dialog.isVisible()).toBe(true);
    failDelete = false; await dialog.getByRole("button", { name: "删除", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    await page.getByText("暂无模板", { exact: true }).waitFor(); expect(deleted).toEqual(["shared", "shared"]); expect((await groups()).length).toBe(count + 1); expect(errors).toEqual([]);
  });
  it("普通成员能发布下载，仅作者可删除；禁止应用，页面适配窄屏", async () => {
    await start("analyst"); expect(await page.getByRole("button", { name: "应用", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "从文件应用", exact: true }).isDisabled()).toBe(true); expect(await page.getByRole("button", { name: "删除", exact: true }).count()).toBe(0);
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载", exact: true }).click(); expect((await download).suggestedFilename()).toBe("template-shared-v2.json");
    await page.getByRole("combobox", { name: "选择规则组", exact: true }).click(); await page.getByRole("option", { name: group.name, exact: true }).click(); await page.getByRole("button", { name: "发布到团队库", exact: true }).click();
    await page.getByText(group.name, { exact: false }).last().waitFor(); expect(published).toHaveLength(1); expect(await page.getByRole("button", { name: "删除", exact: true }).count()).toBe(1);
    for (const width of [375, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    expect(errors).toEqual([]);
  });
});
