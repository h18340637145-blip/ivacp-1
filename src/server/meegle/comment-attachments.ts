import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { IssueAttachment } from "@/server/meegle/types";
import { runMeegleJson, type MeegleComment } from "@/server/meegle/cli";

const MEEGLE_COMMENT_SOURCE = "meegle-comment" as const;
const MEEGLE_ATTACHMENT_HOST = "project.feishu.cn";

type CommentFile = { url: string; name?: string };

interface MeegleCommentAttachmentDownloadResult {
  path: string;
  size: number;
  name: string;
  mime_type: string;
}

export type MeegleCommentAttachmentDownloader = (
  attachment: IssueAttachment,
  destination: string,
  identity: { projectKey: string; workItemId: string },
) => Promise<MeegleCommentAttachmentDownloadResult>;

export interface StagedMeegleCommentAttachments {
  attachments: IssueAttachment[];
  stagedPaths: Map<string, string>;
}

function safeMeegleAttachmentUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === MEEGLE_ATTACHMENT_HOST
      && !url.username
      && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function filenameFromUrl(url: URL): string {
  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) return "评论附件";
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

function safeFilename(value: string): string {
  const candidate = value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "";
  const filename = candidate.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return filename && filename !== "." && filename !== ".." ? filename : "评论附件";
}

function uniqueFilename(filename: string, used: Set<string>): string {
  const safe = safeFilename(filename);
  const key = safe.toLowerCase();
  if (!used.has(key)) {
    used.add(key);
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  for (let index = 2; ; index += 1) {
    const candidate = `${stem}_${index}${extension}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

function mimeTypeForFilename(filename: string): string {
  if (/\.png$/i.test(filename)) return "image/png";
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  if (/\.gif$/i.test(filename)) return "image/gif";
  if (/\.webp$/i.test(filename)) return "image/webp";
  if (/\.zip$/i.test(filename)) return "application/zip";
  if (/\.7z(?:\.\d+)?$/i.test(filename)) return "application/x-7z-compressed";
  return "application/octet-stream";
}

function collectFileValues(value: unknown): CommentFile[] {
  if (typeof value === "string") return [{ url: value }];
  if (Array.isArray(value)) return value.flatMap(collectFileValues);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const url = ["url", "file_url", "fileUrl", "download_url", "downloadUrl"]
    .map((key) => record[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  if (!url) return [];
  const name = ["name", "file_name", "fileName", "filename"]
    .map((key) => record[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  return [{ url, ...(name ? { name } : {}) }];
}

function collectMarkdownImageValues(content: string): CommentFile[] {
  const files: CommentFile[] = [];
  const linkPattern = /!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of content.matchAll(linkPattern)) files.push({ url: match[1] });
  return files;
}

/**
 * Converts every safe attachment reference in a Meegle comment into the
 * shared attachment shape. Comment creation time is the source timestamp
 * because the comment API does not provide a reliable file-level timestamp.
 */
export function normalizeMeegleCommentAttachments(comments: MeegleComment[]): IssueAttachment[] {
  const attachments: IssueAttachment[] = [];
  const usedFilenames = new Set<string>();
  for (const comment of comments) {
    const seen = new Set<string>();
    const files = [
      ...collectFileValues(comment.file_url),
      ...collectFileValues(comment.file_urls),
      ...collectMarkdownImageValues(comment.content || ""),
    ];
    for (const file of files) {
      const url = safeMeegleAttachmentUrl(file.url);
      if (!url || seen.has(url.href)) continue;
      seen.add(url.href);
      const filename = uniqueFilename(file.name || filenameFromUrl(url), usedFilenames);
      attachments.push({
        id: `${comment.comment_id}-${attachments.filter((attachment) => attachment.id.startsWith(`${comment.comment_id}-`)).length + 1}`,
        filename,
        created: comment.created_at,
        size: 0,
        mimeType: mimeTypeForFilename(filename),
        contentUrl: url.href,
        authorName: comment.creator,
        source: MEEGLE_COMMENT_SOURCE,
      });
    }
  }
  return attachments;
}

export function mergeMeegleAttachments(
  commentAttachments: IssueAttachment[],
  pluginAttachments: IssueAttachment[],
): IssueAttachment[] {
  const seen = new Set<string>();
  return [...commentAttachments, ...pluginAttachments].filter((attachment) => {
    if (seen.has(attachment.contentUrl)) return false;
    seen.add(attachment.contentUrl);
    return true;
  });
}

export function buildMeegleCommentAttachmentDownloadArgs(
  attachment: IssueAttachment,
  identity: { projectKey: string; workItemId: string },
  destination: string,
): string[] {
  return [
    "attachment", "+download", attachment.contentUrl,
    "--project-key", identity.projectKey,
    "--work-item-id", identity.workItemId,
    "--output", destination,
    "--overwrite",
  ];
}

export async function stageMeegleCommentAttachments(
  attachments: IssueAttachment[],
  identity: { projectKey: string; workItemId: string },
  stagingRoot: string,
  download: MeegleCommentAttachmentDownloader = async (attachment, destination, downloadIdentity) => (
    runMeegleJson<MeegleCommentAttachmentDownloadResult>(
      buildMeegleCommentAttachmentDownloadArgs(attachment, downloadIdentity, destination),
      10 * 60_000,
    )
  ),
): Promise<StagedMeegleCommentAttachments> {
  await mkdir(stagingRoot, { recursive: true });
  const stagedPaths = new Map<string, string>();
  const usedFilenames = new Set<string>();
  const normalized: IssueAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.source !== MEEGLE_COMMENT_SOURCE) {
      normalized.push(attachment);
      continue;
    }

    const temporaryPath = path.join(stagingRoot, `${safeFilename(attachment.id)}.download`);
    try {
      const result = await download(attachment, temporaryPath, identity);
      const filename = uniqueFilename(result.name || attachment.filename, usedFilenames);
      const stagedPath = path.join(stagingRoot, filename);
      if (path.resolve(result.path) !== path.resolve(stagedPath)) {
        await rename(result.path, stagedPath);
      }
      normalized.push({
        ...attachment,
        filename,
        size: Number(result.size) || attachment.size,
        mimeType: result.mime_type || mimeTypeForFilename(filename),
      });
      stagedPaths.set(attachment.contentUrl, stagedPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      console.warn(`[Meegle] 评论附件预取失败，跳过元数据补齐: ${String(error)}`);
      normalized.push(attachment);
    }
  }

  return { attachments: normalized, stagedPaths };
}
