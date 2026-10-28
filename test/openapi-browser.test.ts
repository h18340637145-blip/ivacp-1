import { expect, it } from "vitest";
import { chromium } from "playwright";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
it.skipIf(!baseURL)("Swagger公开入口加载本地资源与规格，不调用外部网站或业务写接口", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE });
  const context = await browser.newContext({ baseURL });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL!).origin) { requests.push(url.origin); return route.abort(); }
      if (route.request().method() !== "GET") { requests.push(`${route.request().method()} ${url.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(30_000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("/api/docs");
    await page.locator(".swagger-ui .info .title").waitFor();
    expect(await page.locator(".swagger-ui .info .title").innerText()).toContain("IVACP");
    expect(await page.locator(".opblock").count()).toBeGreaterThan(50);
    expect(await page.getByText("Failed to load API definition.", { exact: true }).count()).toBe(0);
    expect(await page.locator("#loading").isHidden()).toBe(true);
    await page.setViewportSize({ width: 375, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(requests).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.close(); await browser.close(); }
}, 120_000);
