import { describe, expect, it } from "vitest";
import { buildPluginAttachmentDownloadUrl, fetchMeeglePluginAttachments } from "@/server/meegle/plugin-attachments";

const context = { projectKey: "project-key", workItemTypeKey: "issue", workItemId: "7067629186" };

describe("飞书附件插件", () => {
  it("读取插件附件列表并转换为统一附件结构", async () => {
    const attachments = await fetchMeeglePluginAttachments(context, async (url) => {
      expect(String(url)).toBe(
        "https://mg-jira.auto-link.com.cn/api/files/list?project_key=project-key&work_item_type_key=issue&work_item_id=7067629186",
      );
      return new Response(JSON.stringify({
        ok: true,
        data: [{
          id: "attachment-id",
          name: "trace.7z",
          size: 198002510,
          type: "application/x-7z-compressed",
          uploadedAt: "2026-08-06T11:55:33.910Z",
          uploadedBy: "何闯",
        }],
      }), { status: 200 });
    });

    expect(attachments).toEqual([{
      id: "attachment-id",
      filename: "trace.7z",
      size: 198002510,
      mimeType: "application/x-7z-compressed",
      created: "2026-08-06T11:55:33.910Z",
      authorName: "何闯",
      contentUrl: buildPluginAttachmentDownloadUrl(context, "attachment-id"),
    }]);
  });

  it("插件返回失败时抛出中文错误", async () => {
    await expect(fetchMeeglePluginAttachments(context, async () => new Response("{}", { status: 503 })))
      .rejects.toThrow("附件插件列表请求失败: HTTP 503");
    await expect(fetchMeeglePluginAttachments(context, async () => new Response(JSON.stringify({ ok: false, error: "无权限" }))))
      .rejects.toThrow("无权限");
  });
});
