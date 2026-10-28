import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Annotation } from "@/domain/labeling/schema";
import { filterLabelItems, type LabelItemDetail, type LabelListFilter } from "@/domain/labeling/items";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
const baseURL = process.env.IVACP_BROWSER_BASE_URL;
const fixture = (id: string, source: "jira" | "meegle"): LabelItemDetail => ({ itemId: `${source}:${id}`, source, issueKey: source === "jira" ? "TEST-1" : "飞书 #99", title: source === "jira" ? "实车 AVH 时序问题" : "台架 电源问题", scene: source === "jira" ? "vehicle" : "bench", reviewStatus: "rejected", excerpt: "原分析摘要", annotated: false, updatedAt: new Date().toISOString(), replyText: `原始结论 ${id}`, signalSummary: "12:01:00 信号变化", errorReason: "时序误判", manualCorrectResult: "", aiReviewVerdict: "fail", aiReviewReason: "建议重新核对证据", suggestion: { verdict: "wrong", errorCodes: ["timing_misjudged"], purposes: [], hints: ["请核对原始时间戳"] } });
describe.skipIf(!baseURL)("数据标注浏览器验收", () => {
  let browser: Browser, context: BrowserContext, page: Page;
  let annotations: Map<string, Annotation>, puts: number, deletes: number, failSave: boolean, failDelete: boolean, unavailable: boolean;
  let delayedId: string | undefined, delay: Promise<void> | undefined, release: (() => void) | undefined;
  const errors: string[] = [];
  const items = [fixture("r1", "jira"), fixture("r2", "meegle")];
  beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.IVACP_BROWSER_EXECUTABLE }); });
  afterAll(async () => { await browser?.close(); });
  afterEach(async () => { release?.(); await context?.close(); });
  async function start(role: "reviewer" | "analyst" = "reviewer") {
    annotations = new Map(); puts = 0; deletes = 0; failSave = false; failDelete = false; unavailable = false; delayedId = undefined; delay = undefined; release = undefined; errors.length = 0;
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(20_000);
    await context.addCookies([{ name: AUTH_SESSION_COOKIE, value: createSessionToken({ username: "label-test", displayName: "标注验收", role }), url: baseURL! }]);
    await context.route("**/api/backup/**", route => route.fulfill({ json: { configured: false } }));
    await context.route("**/api/labeling/**", async route => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === "/api/labeling/items") {
        if (unavailable) return route.fulfill({ status: 503, json: { error: "服务端未配置 MYSQL_URL，无法使用标注系统" } });
        const filter: LabelListFilter = { source: url.searchParams.get("source") as LabelListFilter["source"], status: url.searchParams.get("status") as LabelListFilter["status"], scene: url.searchParams.get("scene") as LabelListFilter["scene"], reviewStatus: url.searchParams.get("reviewStatus") ?? undefined, query: url.searchParams.get("q") ?? undefined };
        return route.fulfill({ json: filterLabelItems(items.map(item => ({ ...item, annotated: annotations.has(item.itemId), verdict: annotations.get(item.itemId)?.verdict })), filter) });
      }
      const id = url.searchParams.get("id") ?? "";
      if (url.pathname.endsWith("/detail")) {
        if (id === delayedId && delay) await delay;
        const item = items.find(item => item.itemId === id);
        return route.fulfill({ json: { item: { ...item, annotation: annotations.get(id), annotated: annotations.has(id) } } });
      }
      if (url.pathname.endsWith("/annotations") && method === "PUT") {
        puts++;
        if (failSave) return route.fulfill({ status: 500, json: { error: "保存服务暂不可用" } });
        const body = route.request().postDataJSON();
        const annotation = { ...body.annotation, itemId: body.itemId, labeler: "label-test", revision: (annotations.get(body.itemId)?.revision ?? 0) + 1, updatedAt: new Date().toISOString() } as Annotation;
        annotations.set(body.itemId, annotation);
        return route.fulfill({ json: { annotation } });
      }
      if (url.pathname.endsWith("/annotations") && method === "DELETE") {
        deletes++;
        if (failDelete) return route.fulfill({ status: 500, json: { error: "撤销失败，请重试" } });
        annotations.delete(id); return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname.endsWith("/export")) return route.fulfill({ contentType: "application/x-ndjson", body: [...annotations.values()].map(item => JSON.stringify(item)).join("\n") });
      return route.fulfill({ status: 404, json: { error: "未配置的验收接口" } });
    });
    page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto("/labeling"); await page.getByRole("heading", { name: "数据标注", exact: true }).waitFor();
  }
  const select = (key: string) => page.getByRole("button", { name: new RegExp(key) }).click();
  async function choose(label: string, option: string) { await page.getByRole("combobox", { name: label, exact: true }).click(); await page.getByRole("option", { name: option, exact: true }).click(); }
  it("建议显式应用、非法组合阻止、保存失败重试与刷新、撤销失败重试、JSONL下载", async () => {
    await start(); await select("TEST-1");
    await page.getByRole("button", { name: "应用预填建议" }).waitFor();
    expect(await page.getByRole("button", { name: "错误", exact: true }).getAttribute("aria-pressed")).toBe("false");
    await page.getByRole("button", { name: "应用预填建议" }).click();
    await page.getByRole("checkbox", { name: /负例 few-shot/ }).check();
    await page.getByRole("button", { name: "保存标注", exact: true }).click();
    await page.getByText("负例 few-shot 必须填写正确结论", { exact: true }).waitFor(); expect(puts).toBe(0);
    await page.getByLabel(/^正确结论/).fill("12:01:00 信号先于日志，需重新核对模块");
    await page.getByRole("link", { name: "统计报表", exact: true }).click();
    await page.getByRole("heading", { name: "放弃未保存的标注？", exact: true }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(new URL(page.url()).pathname).toBe("/labeling");
    failSave = true; await page.getByRole("button", { name: "保存标注", exact: true }).click();
    await page.getByText("保存服务暂不可用", { exact: true }).waitFor();
    expect(await page.getByLabel(/^正确结论/).inputValue()).toContain("重新核对模块");
    failSave = false; await page.getByRole("button", { name: "保存标注", exact: true }).click();
    await page.getByText("已保存标注，第 1 版", { exact: true }).waitFor(); expect(puts).toBe(2);
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "导出 JSONL" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.jsonl$/);
    await page.reload(); await choose("标注状态", "已标注"); await select("TEST-1");
    await page.getByText(/第 1 版 · label-test/).waitFor();
    expect(await page.getByLabel(/^正确结论/).inputValue()).toContain("重新核对模块");
    failDelete = true; await page.getByRole("button", { name: "撤销标注", exact: true }).click();
    await page.getByRole("button", { name: "确认撤销标注", exact: true }).click();
    await page.getByText("撤销失败，请重试", { exact: true }).waitFor(); expect(annotations.size).toBe(1);
    failDelete = false; await page.getByRole("button", { name: "确认撤销标注", exact: true }).click();
    await page.getByText("已撤销标注，原始分析保持不变", { exact: true }).waitFor(); expect(deletes).toBe(2); expect(annotations.size).toBe(0);
    expect(errors).toEqual([]);
  });
  it("迟到详情不串票，筛选覆盖场景与来源；未保存切换需确认", async () => {
    await start(); delayedId = "jira:r1"; delay = new Promise<void>(resolve => { release = resolve; });
    await select("TEST-1"); await select("飞书 #99");
    await page.getByText("原始结论 r2", { exact: true }).waitFor(); release!();
    await page.getByRole("button", { name: "完全正确", exact: true }).click();
    await page.getByLabel("备注", { exact: true }).fill("B票草稿");
    await select("TEST-1"); await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(await page.getByLabel("备注", { exact: true }).inputValue()).toBe("B票草稿");
    expect(await page.getByText("原始结论 r1", { exact: true }).count()).toBe(0);
    await select("TEST-1"); await page.getByRole("button", { name: "放弃更改并继续" }).click();
    await page.getByText("原始结论 r1", { exact: true }).waitFor();
    await choose("来源", "飞书项目"); await choose("问题场景", "台架");
    await page.getByRole("button", { name: /飞书 #99/ }).waitFor();
    expect(await page.getByRole("button", { name: /TEST-1/ }).count()).toBe(0);
    await select("飞书 #99");
    expect(await page.getByLabel("备注", { exact: true }).inputValue()).toBe("");
    await page.screenshot({ path: "/tmp/ivacp-labeling-desktop.png", fullPage: true });
    for (const width of [375, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
    expect(errors).toEqual([]);
  });
  it("浏览器历史导航返回后可恢复本账号本条目的未保存草稿", async () => {
    await start();
    await page.getByRole("link", { name: "规则组看板", exact: true }).first().click();
    await page.getByRole("link", { name: "数据标注", exact: true }).click();
    await select("TEST-1");
    await page.getByLabel("备注", { exact: true }).fill("历史导航前的草稿");
    await page.goBack();
    await page.goForward();
    await select("TEST-1");
    expect(await page.getByLabel("备注", { exact: true }).inputValue()).toBe("历史导航前的草稿");
    expect(puts).toBe(0);
  });
  it("分析员只读；镜像未配置显示可重试错误", async () => {
    await start("analyst"); await select("TEST-1");
    await page.getByText("当前账号可查看标注；保存和撤销需要复核员及以上权限。", { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "保存标注", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "应用预填建议" }).isDisabled()).toBe(true);
    unavailable = true; await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await page.getByText("服务端未配置 MYSQL_URL，无法使用标注系统", { exact: true }).waitFor();
    unavailable = false; await page.getByRole("button", { name: "重试", exact: true }).click(); await select("TEST-1");
    await page.getByText("原始结论 r1", { exact: true }).waitFor(); expect(errors).toEqual([]); expect(puts).toBe(0);
  });
});
