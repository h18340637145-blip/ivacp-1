import { describe, expect, it, vi } from "vitest";
import {
  extractSafeFileAttachments,
  extractSafeMarkdownImageAttachments,
  normalizeMeegleWorkItemDetail,
} from "@/domain/meegle/work-item-detail";
import { fetchMeegleContext } from "@/server/meegle/context";
import { getMeegleWorkItem, listMeegleComments } from "@/server/meegle/cli";

vi.mock("@/server/meegle/cli", () => ({ getMeegleWorkItem: vi.fn(), listMeegleComments: vi.fn() }));
vi.mock("@/server/meegle/plugin-attachments", () => ({ fetchMeeglePluginAttachments: vi.fn(async () => []) }));

const identity = { projectKey: "p", workItemTypeKey: "issue" as const, workItemId: "7148399110" };
const opaqueUrl = "https://project.feishu.cn/goapi/v1/platform/file/stream/download/opaque?token=a%2fb+z&name=%E5%9B%BE.png";

describe("飞书上下文原始富文本", () => {
  it("分析快照保留描述与逐条评论原文，兼容既有纯文本字段", async () => {
    const description = "<p>描述第一段</p>\n<p><strong>第二段</strong></p>";
    const content = `第一段\n\n- **复现**\n\n<img src="${opaqueUrl.replace(/&/g, "&amp;")}">`;
    vi.mocked(getMeegleWorkItem).mockResolvedValue({ work_item_fields: [{ key: "description", value: description }] });
    vi.mocked(listMeegleComments).mockResolvedValue([{ comment_id: "c-image", content, creator: "u1", created_at: "2026-10-31" }]);
    const { rawData } = await fetchMeegleContext(identity);
    expect(rawData.description).toBe("描述第一段 第二段");
    expect(rawData.descriptionRich).toBe(description);
    expect(rawData.comments).toEqual([{ id: "c-image", author: "u1", created: "2026-10-31", body: "第一段 - **复现**", richBody: content }]);
  });

  it("仅有 HTML 图片的评论仍提取不透明下载地址，并保留 HTML 实体解码后的查询原值", () => {
    const detail = normalizeMeegleWorkItemDetail({ identity, workItem: {}, comments: [{ comment_id: "c", content: `<p><img src="${opaqueUrl.replace(/&/g, "&amp;")}" alt="原图"></p>` }] });
    expect(detail.comments[0].attachments.map((attachment) => attachment.url)).toEqual([opaqueUrl]);
  });

  it("解析 Markdown 引用图、嵌套括号内联图与 HTML 图，忽略链接和代码中的图语法", () => {
    const nestedUrl = "https://project.feishu.cn/files/screen(1).png?token=a%2fb+z";
    const referenceUrl = "https://project.feishu.cn/files/reference?x=1&y=2";
    const source = [
      `![现场](${nestedUrl})`,
      "![引用][REF]",
      `\n[ref]: <${referenceUrl.replace(/&/g, "&amp;")}>`,
      "\n[原票](https://project.feishu.cn/p/issue/detail/7148399110)",
      '`![代码](https://project.feishu.cn/files/code.png)`',
      "```html\n<img src=\"https://project.feishu.cn/files/code2.png\">\n```",
    ].join("\n");
    expect(extractSafeMarkdownImageAttachments(source).map((attachment) => attachment.url)).toEqual([nestedUrl, referenceUrl]);
  });

  it("图片提取拒绝危险协议和含凭据的 URL", () => {
    expect(extractSafeMarkdownImageAttachments('<img src="javascript:alert(1)"><img src="data:image/png;base64,AAAA"><img src="https://u:p@project.feishu.cn/files/private.png">')).toEqual([]);
  });

  it("file_url 依据可靠图片文件名识别图片，保留普通附件和原始 URL", () => {
    expect(extractSafeFileAttachments([
      { url: opaqueUrl, name: "现场.PNG" },
      "https://project.feishu.cn/files/screen.webp?x=a%2fb",
      { url: "https://project.feishu.cn/files/archive", name: "trace.zip" },
    ])).toEqual([
      { url: opaqueUrl, name: "现场.PNG", kind: "image" },
      { url: "https://project.feishu.cn/files/screen.webp?x=a%2fb", name: "screen.webp", kind: "image" },
      { url: "https://project.feishu.cn/files/archive", name: "trace.zip", kind: "file" },
    ]);
  });
});
