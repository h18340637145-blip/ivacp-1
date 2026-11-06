import { expect, it } from "vitest";
import { chromium } from "playwright";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
import { calculateAnnualStatistics } from "@/domain/analysis/annual-statistics";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
it.skipIf(!baseURL)("统计完整身份、刷新、月份查询、团队失败重试和报告复制", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    context.setDefaultTimeout(20_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "statistics-test", displayName: "统计验收", role: "analyst" }), url: baseURL! }]);
    await context.route("**/api/**", route => new URL(route.request().url()).pathname === "/api/auth/session" ? route.continue() : route.fulfill({ status: 500, json: { error: "未配置的验收接口" } }));
    await context.route("**/api/backup/**", route => route.fulfill({ json: { configured: false } }));
    let fail = true;
    const queries: string[] = [];
    await context.route("**/api/statistics/team?**", route => {
      queries.push(new URL(route.request().url()).search);
      const year = new Date().getFullYear();
      const total = calculateAnnualStatistics([{ source: "jira", resultId: "team1", ticketKey: "TEAM-1", processedAt: new Date(year, 0, 2), reviewStatus: "approved" }]);
      return route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: "镜像暂不可用" } : { total, members: [{ owner: "团队成员", statistics: total }], generatedAt: new Date() } });
    });
    const page = await context.newPage(); const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/statistics"); await page.getByText("所选范围暂无分析记录", { exact: true }).waitFor();
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("IvacpDB"); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["snapshots", "processResults", "processTasks"], "readwrite");
        // 仅失败的 Jira 分析：不计入处理票数，但计入开始分析票数与分析次数
        tx.objectStore("processTasks").put({ id: "failed1", source: "jira", ticketKey: "FAIL-1", ruleGroupId: "g", snapshotId: "x", status: "failed", error: "失败", createdAt: new Date(new Date().getFullYear(), 0, 2) });
        for (const [i, projectKey] of ["p1", "p2"].entries()) {
          tx.objectStore("snapshots").put({ id: `s${i}`, source: "meegle", projectKey, workItemTypeKey: "issue", workItemId: 42 });
          tx.objectStore("processResults").put({ id: `r${i}`, source: "meegle", ticketKey: "42", snapshotId: `s${i}`, createdAt: new Date(new Date().getFullYear(), 0, 2), reviewStatus: "approved", manualReviewedAt: new Date() });
        }
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); database.close();
    });
    await page.reload();
    const localReport = page.getByRole("heading", { name: /我的统计/ }); await localReport.waitFor();
    // 报告用真实 IndexedDB 结果生成，跨项目同号必须保留两张票。
    await page.getByRole("button", { name: "复制统计报告", exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("| 飞书项目 | 2 | 2 | 2 | 2 |");
    expect(copied).toContain("| Jira | 0 | 0 | 1 | 1 |");
    expect(copied).toContain("开始分析票数（含失败）：**3**，分析次数（含重复与失败）：**3**");
    await page.getByText("分析次数（含重复与失败）", { exact: true }).first().waitFor();
    await page.getByRole("combobox", { name: "起始月份", exact: true }).click(); await page.getByRole("option", { name: "12 月", exact: true }).click();
    await page.getByRole("combobox", { name: "结束月份", exact: true }).click(); await page.getByRole("option", { name: "1 月", exact: true }).click();
    await page.getByText("起始月份不能晚于结束月份", { exact: true }).waitFor(); expect(await page.getByRole("button", { name: "查询", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("combobox", { name: "起始月份", exact: true }).click(); await page.getByRole("option", { name: "1 月", exact: true }).click(); await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("heading", { name: /我的统计 · .*1–1 月/ }).waitFor();
    await page.getByRole("button", { name: "团队（服务器）", exact: true }).click();
    await page.getByText(/镜像暂不可用/).waitFor();
    expect(await page.getByRole("button", { name: "复制统计报告", exact: true }).isDisabled()).toBe(true);
    fail = false; await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByText("团队成员", { exact: true }).waitFor();
    expect(queries.at(-1)).toContain("startMonth=1&endMonth=1");
    await page.getByRole("button", { name: "复制统计报告", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("团队成员");
    for (const width of [375, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    expect(errors).toEqual([]);
  } finally { await context.close(); await browser.close(); }
}, 120_000);
