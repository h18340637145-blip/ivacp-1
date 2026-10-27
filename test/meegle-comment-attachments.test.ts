import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeMeegleComments } from "@/server/meegle/cli";
import {
  buildMeegleCommentAttachmentDownloadArgs,
  mergeMeegleAttachments,
  normalizeMeegleCommentAttachments,
  stageMeegleCommentAttachments,
} from "@/server/meegle/comment-attachments";

describe("飞书评论附件", () => {
  it("CLI 的 file_urls 字段在评论规范化时不丢失", () => {
    const comments = normalizeMeegleComments({
      comments: [{
        comment_id: "comment-file-urls",
        creator: "评论人",
        created_at: "2026-08-17T09:00:00.000Z",
        file_urls: [{ file_url: "https://project.feishu.cn/files/from-file-urls.zip", file_name: "file-urls.zip" }],
      }],
    });
    expect(normalizeMeegleCommentAttachments(comments)).toEqual([{
      id: "comment-file-urls-1",
      filename: "file-urls.zip",
      created: "2026-08-17T09:00:00.000Z",
      size: 0,
      mimeType: "application/zip",
      contentUrl: "https://project.feishu.cn/files/from-file-urls.zip",
      authorName: "评论人",
      source: "meegle-comment",
    }]);
  });

  const attachments = normalizeMeegleCommentAttachments(normalizeMeegleComments({
    comments: [
      {
        comment_id: "comment-1",
        creator: "评论人",
        created_at: "2026-08-17T10:00:00.000Z",
        content: "![CAN](https://project.feishu.cn/files/can.blf)\n[日志](https://project.feishu.cn/files/logs.7z)",
        file_url: [
          { url: "https://project.feishu.cn/files/logs.7z", name: "日志.7z" },
          "https://project.feishu.cn/files/can.blf",
        ],
      },
      {
        comment_id: "comment-2",
        creator: "另一位评论人",
        created_at: "2026-08-17T11:00:00.000Z",
        content: "",
        file_urls: [{ file_url: "https://project.feishu.cn/files/screenshot.png", file_name: "截图.png" }],
      },
    ],
  }));

  it("评论附件去重、继承评论时间并保留来源", () => {
    expect(attachments).toEqual([
      {
        id: "comment-1-1",
        filename: "日志.7z",
        created: "2026-08-17T10:00:00.000Z",
        size: 0,
        mimeType: "application/x-7z-compressed",
        contentUrl: "https://project.feishu.cn/files/logs.7z",
        authorName: "评论人",
        source: "meegle-comment",
      },
      {
        id: "comment-1-2",
        filename: "can.blf",
        created: "2026-08-17T10:00:00.000Z",
        size: 0,
        mimeType: "application/octet-stream",
        contentUrl: "https://project.feishu.cn/files/can.blf",
        authorName: "评论人",
        source: "meegle-comment",
      },
      {
        id: "comment-2-1",
        filename: "截图.png",
        created: "2026-08-17T11:00:00.000Z",
        size: 0,
        mimeType: "image/png",
        contentUrl: "https://project.feishu.cn/files/screenshot.png",
        authorName: "另一位评论人",
        source: "meegle-comment",
      },
    ]);
  });

  it("仅允许飞书附件地址，且文件名消除路径穿越", () => {
    expect(normalizeMeegleCommentAttachments(normalizeMeegleComments({
      comments: [{
        comment_id: "unsafe",
        creator: "评论人",
        created_at: "2026-08-17T12:00:00.000Z",
        content: "[危险](https://project.feishu.cn/files/%2e%2e%2fescape.blf)\n[外域](https://example.test/files/ignored.zip)",
        file_url: [{ url: "https://project.feishu.cn/files/log.7z", name: "../../log.7z" }],
      }],
    }))).toEqual([
      {
        id: "unsafe-1",
        filename: "log.7z",
        created: "2026-08-17T12:00:00.000Z",
        size: 0,
        mimeType: "application/x-7z-compressed",
        contentUrl: "https://project.feishu.cn/files/log.7z",
        authorName: "评论人",
        source: "meegle-comment",
      },
      {
        id: "unsafe-2",
        filename: "escape.blf",
        created: "2026-08-17T12:00:00.000Z",
        size: 0,
        mimeType: "application/octet-stream",
        contentUrl: "https://project.feishu.cn/files/%2e%2e%2fescape.blf",
        authorName: "评论人",
        source: "meegle-comment",
      },
    ]);
  });

  it("与插件附件合并时按 URL 去重", () => {
    expect(mergeMeegleAttachments([attachments[0]], [{
      ...attachments[0],
      id: "plugin-duplicate",
      created: "2026-08-17T12:00:00.000Z",
    }])).toEqual([attachments[0]]);
  });

  it("构造 meegle CLI 下载参数", () => {
    expect(buildMeegleCommentAttachmentDownloadArgs(
      attachments[0],
      { projectKey: "project-key", workItemId: "707" },
      "/safe/root/can.blf",
    )).toEqual([
      "attachment", "+download", "https://project.feishu.cn/files/logs.7z",
      "--project-key", "project-key",
      "--work-item-id", "707",
      "--output", "/safe/root/can.blf",
      "--overwrite",
    ]);
  });

  it("暂存不透明下载地址时采用 CLI 返回的真实文件名与大小", async () => {
    const stagingRoot = path.join(process.cwd(), "test", `.tmp-meegle-comment-attachments-${process.pid}`);
    await mkdir(stagingRoot, { recursive: true });
    try {
      const opaqueAttachment = normalizeMeegleCommentAttachments(normalizeMeegleComments({
        comments: [{
          comment_id: "opaque-comment",
          creator: "评论人",
          created_at: "2026-09-02T14:27:05.000Z",
          file_url: "https://project.feishu.cn/goapi/v5/platform/file/stream/download/opaque-token",
        }],
      }))[0];
      const staged = await stageMeegleCommentAttachments(
        [opaqueAttachment],
        { projectKey: "project-key", workItemId: "7105001752" },
        stagingRoot,
        async (_attachment, destination) => {
          await writeFile(destination, "CAN trace fixture");
          return { path: destination, size: 26509706, name: "can_20260902141049.asc", mime_type: "application/octet-stream" };
        },
      );

      expect(staged.attachments[0].filename).toBe("can_20260902141049.asc");
      expect(staged.attachments[0].created).toBe("2026-09-02T14:27:05.000Z");
      expect(staged.attachments[0].size).toBe(26509706);
      expect(staged.stagedPaths.get(opaqueAttachment.contentUrl)).toBe(path.join(stagingRoot, "can_20260902141049.asc"));
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  });
});
