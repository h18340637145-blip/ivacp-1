import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
import type { MeegleContextView } from "@/domain/meegle/context-view";

const baseURL = process.env.IVACP_BROWSER_BASE_URL;
const originalImage = "https://project.feishu.cn/files/context-test-image?token=opaque";
const view: MeegleContextView = {
  source: "cache", cachedAt: "2026-10-31T08:00:00Z",
  images: { [originalImage]: { id: "safe-local-image", name: "现场截图", status: "cached" } },
  detail: { identity: { projectKey: "context-project", workItemTypeKey: "issue", workItemId: "7148399110" }, updatedAt: "", attributes: {}, fields: [], assigneeRole: null,
    descriptionFields: [{ key: "description", name: "描述", value: "**描述重点**\n\n- 第一步\n- 第二步" }],
    comments: [
      { id: "image-only", authorKey: "test", authorName: "测试成员", createdAt: "2026-10-31T08:00:00Z", body: `![现场截图](${originalImage})`, attachments: [] },
      { id: "mixed", authorKey: "test", authorName: "测试成员", createdAt: "2026-10-31T08:01:00Z", body: `图片之前\n\n<!-- comment layout metadata -->\n<img src="${originalImage}" onerror="window.contextXss=1">\n\n**图片之后**\n\n[日志文件](https://project.feishu.cn/files/test-log.zip)`, attachments: [] },
    ],
  },
};

describe.skipIf(!baseURL)("工单上下文富文本浏览器闭环", () => {
  let browser: Browser, context: BrowserContext, page: Page;
  let fail = false, failImage = false;
  const queries: URL[] = [], externalImages: string[] = [], errors: string[] = [];
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE });
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(20000);
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "context-browser", displayName: "上下文验收", role: "admin" }), url: baseURL! }]);
    await context.route("**/api/backup/**", (route) => route.fulfill({ json: { configured: false } }));
    await context.route("**/api/meegle/context-view?**", (route) => {
      queries.push(new URL(route.request().url()));
      return route.fulfill(fail ? { status: 502, json: { error: "测试原票暂不可用" } } : { json: view });
    });
    await context.route("**/api/meegle/context-image?**", (route) => failImage ? route.fulfill({ status: 503, body: "test image unavailable" }) : route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64") }));
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (request.resourceType() === "image" && new URL(request.url()).origin !== new URL(baseURL!).origin) externalImages.push(request.url()); });
    await page.goto("/");
    await page.getByText("创建第一个规则组", { exact: true }).waitFor();
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("IvacpDB"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["ruleGroups", "snapshots"], "readwrite");
          tx.objectStore("ruleGroups").put({ id: "context-group", name: "上下文测试组", jql: "", expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: {}, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
          for (const source of ["meegle", "jira"]) tx.objectStore("snapshots").put({ id: `context-${source}`, source, jiraProvider: "default", ticketKey: source === "meegle" ? "meegle-7148399110" : "CONTEXT-1", projectKey: "context-project", workItemTypeKey: "issue", ruleGroupId: "context-group", origin: "filter", title: "上下文图片测试", rawData: { description: "**Jira快照描述**", descriptionRich: "**快照描述**", comments: [{ id: "fallback", author: "快照成员", body: "**Jira快照正文**", richBody: "**快照正文**" }] }, createdAt: new Date() });
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    });
  });
  afterAll(async () => { await context?.close(); await browser?.close(); });
  it("自动加载缓存、图片原位打开大图，刷新失败保留内容，重载复用缓存", async () => {
    await page.goto("/tickets/meegle/meegle-7148399110?group=context-group&project=context-project");
    await page.getByRole("tab", { name: "工单上下文", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "工单上下文", exact: true });
    await panel.locator("strong").filter({ hasText: "描述重点" }).waitFor();
    expect(queries.at(-1)?.searchParams.get("refresh")).toBeNull();
    expect(queries.at(-1)?.searchParams.get("workItemId")).toBe("7148399110");
    expect(await panel.locator("article img").count()).toBe(2);
    const body = await panel.locator("article").nth(1).innerHTML();
    expect(body.indexOf("图片之前")).toBeLessThan(body.indexOf("<img"));
    expect(body.indexOf("<img")).toBeLessThan(body.indexOf("图片之后"));
    expect(await panel.getByRole("link", { name: "打开大图：现场截图" }).first().getAttribute("href")).toContain("imageId=safe-local-image");
    expect(await panel.getByRole("link", { name: "日志文件" }).getAttribute("href")).toBe("https://project.feishu.cn/files/test-log.zip");
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).contextXss)).toBeUndefined();
    fail = true;
    await panel.getByRole("button", { name: "刷新原票详情", exact: true }).click();
    await panel.getByRole("status").filter({ hasText: "测试原票暂不可用" }).waitFor();
    expect(queries.at(-1)?.searchParams.get("refresh")).toBe("1");
    expect(await panel.locator("article img").count()).toBe(2);
    fail = false;
    await page.reload();
    await page.getByRole("tab", { name: "工单上下文", exact: true }).click();
    await panel.locator("article img").first().waitFor();
    expect(queries.at(-1)?.searchParams.get("refresh")).toBeNull();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    expect(externalImages).toEqual([]); expect(errors).toEqual([]);
  });
  it("本地图片失败后刷新原票，即使imageId和cachedAt相同也重新加载", async () => {
    fail = false; failImage = true;
    await page.reload(); await page.getByRole("tab", { name: "工单上下文", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "工单上下文", exact: true });
    await expect.poll(() => panel.getByText(/图片暂不可用/).count()).toBe(2);
    failImage = false;
    await panel.getByRole("button", { name: "刷新原票详情", exact: true }).click();
    await expect.poll(() => panel.locator("article img").count()).toBe(2);
    await expect.poll(() => panel.locator("article img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await panel.getByText(/图片暂不可用/).count()).toBe(0);
  });
  it("无缓存失败保留富文本快照，Jira不发起飞书读取", async () => {
    fail = true;
    await page.reload(); await page.getByRole("tab", { name: "工单上下文", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "工单上下文", exact: true });
    await panel.getByRole("status").filter({ hasText: "测试原票暂不可用" }).waitFor();
    await panel.locator("strong").filter({ hasText: "快照正文" }).waitFor();
    const count = queries.length;
    await page.goto("/tickets/jira/CONTEXT-1?group=context-group&provider=default");
    await page.getByRole("tab", { name: "工单上下文", exact: true }).click();
    await panel.locator("article pre").filter({ hasText: "**Jira快照正文**" }).waitFor();
    expect(await panel.getByRole("button", { name: "刷新原票详情", exact: true }).count()).toBe(0);
    expect(queries.length).toBe(count);
  });
});
