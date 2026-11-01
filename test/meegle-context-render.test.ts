import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TicketSnapshot } from "@/domain/entities";
import { TicketCachedImage, TicketRichContent } from "@/features/tickets/components/ticket-rich-content";
import { TicketContextPanel } from "@/features/tickets/components/ticket-context-panel";

const snapshot = (rawData: Record<string, unknown>) => ({ id: "context-test", source: "meegle", ticketKey: "7148399110", projectKey: "test-project", title: "上下文测试", rawData } as TicketSnapshot);
describe("飞书上下文富文本", () => {
  it("优先展示富文本快照并保留段落、强调和图片位置", () => {
    const html = renderToStaticMarkup(createElement(TicketContextPanel, { snapshot: snapshot({ description: "old", descriptionRich: "**描述强调**", comments: [{ id: "one", author: "测试作者", richBody: "开头\n\n![现场图](https://project.feishu.cn/files/test-image)\n\n**尾部**", body: "legacy" }] }) }));
    expect(html).toContain("<strong>描述强调</strong>");
    expect(html).toContain("<strong>尾部</strong>");
    expect(html.indexOf("开头")).toBeLessThan(html.indexOf("图片暂不可用"));
    expect(html.indexOf("图片暂不可用")).toBeLessThan(html.indexOf("<strong>尾部</strong>"));
    expect(html).not.toContain('<img src="https:');
  });
  it("HTML和Markdown脚本、事件及危险链接不进入可执行DOM", () => {
    const html = renderToStaticMarkup(createElement(TicketContextPanel, { snapshot: snapshot({ descriptionRich: '<b>安全正文</b><script>alert(1)</script><img src="https://evil.invalid/tracker" onerror="alert(2)"><a href="javascript:alert(3)">危险链接</a>\n\n[正常链接](https://example.test/file.zip)' }) }));
    expect(html).toContain("<b>安全正文</b>");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<[^>]+onerror=/);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img src="https:');
    expect(html).toContain('href="https://example.test/file.zip"');
  });
});

describe("本地图片映射", () => {
  it("仅将cached映射图片引用为当前票鉴权URL", () => {
    const html = renderToStaticMarkup(createElement(TicketRichContent, { body: "![截图](https://project.feishu.cn/files/image?opaque=1)\n\n![失败](https://example.test/missing)", identity: { projectKey: "isolated-project", workItemTypeKey: "issue", workItemId: "123" }, images: { "https://project.feishu.cn/files/image?opaque=1": { id: "cache-id", name: "截图", status: "cached" }, "https://example.test/missing": { id: "missing-id", name: "失败", status: "unavailable", reason: "下载失败" } } }));
    expect(html).toContain('src="/api/meegle/context-image?projectKey=isolated-project&amp;workItemTypeKey=issue&amp;workItemId=123&amp;imageId=cache-id"');
    expect(html).toContain('aria-label="打开大图：截图"');
    expect(html).toContain("下载失败");
    expect(html).not.toContain("missing-id");
    expect(html).not.toContain('src="https:');
  });
});

describe("上下文兼容与补充图片", () => {
  it("HTML实体URL与引用式图片只在原位置显示一次，HTML注释不可见", () => {
    const url = "https://project.feishu.cn/files/test?a=1&b=2";
    const body = `<!-- 内部排版注释 -->\n\n<img src="${url.replace(/&/g, "&amp;")}" alt="实体图片">`;
    const html = renderToStaticMarkup(createElement(TicketContextPanel, { snapshot: snapshot({ comments: [{ body, attachments: [{ kind: "image", url, name: "实体图片" }] }, { body: `![引用图片][shot]\n\n[shot]: ${url}`, attachments: [{ kind: "image", url, name: "引用图片" }] }] }) }));
    expect((html.match(/role="img"/g) ?? []).length).toBe(2);
    expect(html).not.toContain("<!-- 内部排版注释 -->");
  });
  it("Jira保持原纯文本pre展示，不将wiki或Markdown解释为富文本", () => {
    const data = { ...snapshot({ description: "**Jira原描述**\n{code}example{code}", comments: [{ body: "**Jira原评论**" }] }), source: "jira" } as TicketSnapshot;
    const html = renderToStaticMarkup(createElement(TicketContextPanel, { snapshot: data }));
    expect(html).toContain("**Jira原描述**\n{code}example{code}</pre>");
    expect(html).toContain("**Jira原评论**</pre>");
    expect(html).not.toContain("<strong>");
  });
});

it("非正文图片附件保留带右括号的原始URL，避免Markdown截断", () => {
  const url = "https://project.feishu.cn/files/image?name=screen).png";
  const html = renderToStaticMarkup(createElement(TicketContextPanel, { snapshot: snapshot({ comments: [{ body: "图片见附件", attachments: [{ kind: "image", url, name: "现场[截图]" }] }] }) }));
  expect(html).toContain('aria-label="现场[截图]"');
  expect(html).not.toContain(").png</p>");
  expect((html.match(/role="img"/g) ?? []).length).toBe(1);
});

it("非正文图片按完整原URL查缓存，不重新解析Markdown", () => {
  const originalUrl = "https://project.feishu.cn/files/image?name=screen).png&part=1";
  const html = renderToStaticMarkup(createElement(TicketCachedImage, { originalUrl, alt: "现场[截图]", identity: { projectKey: "exact-url", workItemTypeKey: "issue", workItemId: "123" }, images: { [originalUrl]: { id: "exact-image", name: "现场[截图]", status: "cached" } } }));
  expect(html).toContain('src="/api/meegle/context-image?projectKey=exact-url&amp;workItemTypeKey=issue&amp;workItemId=123&amp;imageId=exact-image"');
  expect(html).toContain('alt="现场[截图]"');
  expect(html).not.toContain("图片暂不可用");
});
