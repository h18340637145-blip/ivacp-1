import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MeegleContextView, MeegleContextImage } from "@/domain/meegle/context-view";
import { extractSafeRichImageAttachments, type MeegleWorkItemIdentity, type MeegleWorkItemDetailLoadResult } from "@/domain/meegle/work-item-detail";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_IMAGES = 40;
interface StoredImage extends MeegleContextImage { mime?: string; size?: number }
interface StoredContext extends MeegleContextView { version: 1; identity: MeegleWorkItemIdentity; images: Record<string, StoredImage> }
interface Dependencies {
  root: string;
  loadDetail: (identity: MeegleWorkItemIdentity) => Promise<MeegleWorkItemDetailLoadResult>;
  download: (identity: MeegleWorkItemIdentity, url: string, destination: string, timeout: number) => Promise<unknown>;
}

export function isMeegleImageDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === "project.feishu.cn" && !url.username && !url.password
      && (/^\/files\/[^/]+/.test(url.pathname) || /^\/goapi\/v\d+\/platform\/file\/stream\/download\/[^/]+/.test(url.pathname));
  } catch { return false; }
}

function validateIdentity(identity: MeegleWorkItemIdentity): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(identity.projectKey) || identity.workItemTypeKey !== "issue" || !/^\d{1,32}$/.test(identity.workItemId)) {
    throw new Error("工单身份无效");
  }
}

function bitmapMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

async function safeRead(filename: string, maxBytes: number): Promise<Buffer> {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error("缓存文件无效或超过大小限制");
  // O_NOFOLLOW also closes the symlink replacement window between lstat and open.
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile(); } finally { await handle.close(); }
}

export function createMeegleContextCache(deps: Dependencies) {
  const pending = new Map<string, Promise<MeegleContextView>>();
  async function directory(identity: MeegleWorkItemIdentity, create: boolean): Promise<string> {
    validateIdentity(identity);
    let current = path.resolve(deps.root);
    for (const part of ["", identity.projectKey, identity.workItemTypeKey, `meegle-${identity.workItemId}`, "images"]) {
      if (part) current = path.join(current, part);
      if (create) await mkdir(current, { recursive: part === "", mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("工单缓存目录不能是符号链接或普通文件");
    }
    return path.dirname(current);
  }
  async function readStored(dir: string, identity: MeegleWorkItemIdentity): Promise<StoredContext | null> {
    try {
      const stored = JSON.parse((await safeRead(path.join(dir, "context.json"), 16 * 1024 * 1024)).toString("utf8")) as StoredContext;
      if (stored.version !== 1 || JSON.stringify(stored.identity) !== JSON.stringify(identity)
        || !stored.detail || !Array.isArray(stored.detail.comments) || !Array.isArray(stored.detail.fields)
        || !Array.isArray(stored.detail.descriptionFields) || !stored.images || typeof stored.images !== "object") return null;
      return stored;
    } catch { return null; }
  }
  function view(stored: StoredContext, source: "cache" | "remote", warning?: string): MeegleContextView {
    return { detail: stored.detail, images: stored.images, cachedAt: stored.cachedAt, source, errors: stored.errors, ...(warning ? { warning } : stored.warning ? { warning: stored.warning } : {}) };
  }
  async function run(identity: MeegleWorkItemIdentity, refresh: boolean): Promise<MeegleContextView> {
    const dir = await directory(identity, true);
    const previous = await readStored(dir, identity);
    if (previous && !refresh && !previous.errors?.comments) return view(previous, "cache");
    let result: MeegleWorkItemDetailLoadResult;
    try {
      result = await deps.loadDetail(identity);
      if (!result.detail) throw new Error("原票读取失败");
    } catch {
      const warning = "原票读取失败，请检查飞书登录与网络后重试；保留已有上下文";
      return previous ? view(previous, "cache", warning) : { detail: null, images: {}, source: "snapshot", warning };
    }
    const detail = result.detail!;
    let warning: string | undefined;
    if (result.errors.comments) {
      if (previous?.detail) detail.comments = previous.detail.comments;
      warning = "评论读取失败，保留已有评论；可刷新原票重试";
    } else if (result.errors.commentAuthors) warning = "部分评论作者名称暂不可用，保留用户标识";
    const candidates = [...detail.comments.flatMap(comment => [
      ...extractSafeRichImageAttachments(comment.body), ...comment.attachments.filter(attachment => attachment.kind === "image"),
    ]), ...detail.descriptionFields.flatMap(field => typeof field.value === "string" ? extractSafeRichImageAttachments(field.value) : [])];
    const unique = [...new Map(candidates.map(image => [image.url, image])).values()];
    const images: Record<string, StoredImage> = {};
    let downloadedBytes = 0, downloadCount = 0;
    const deadline = Date.now() + 45_000;
    // Serial downloads keep the file budget deterministic. Every CLI invocation is bounded.
    for (const image of unique) {
      const id = createHash("sha256").update(image.url).digest("hex");
      const entry: StoredImage = { id, name: image.name, status: "unavailable" }; images[image.url] = entry;
      if (!isMeegleImageDownloadUrl(image.url)) { entry.reason = "仅缓存飞书项目文件图片"; continue; }
      const filename = path.join(dir, "images", id);
      let temporary: string | undefined;
      try {
        let bytes: Buffer;
        try {
          bytes = await safeRead(filename, MAX_IMAGE_BYTES);
          if (!bitmapMime(bytes) || bytes.length < 12) throw new Error("已有图片损坏");
        } catch {
          if (downloadCount >= MAX_IMAGES || downloadedBytes >= MAX_TOTAL_BYTES || Date.now() >= deadline) {
            entry.reason = "图片缓存达到本次读取限制，请稍后刷新重试"; continue;
          }
          downloadCount++;
          temporary = path.join(dir, "images", `.${id}-${randomUUID()}.tmp`);
          await deps.download(identity, image.url, temporary, Math.max(1, Math.min(15_000, deadline - Date.now())));
          bytes = await safeRead(temporary, MAX_IMAGE_BYTES);
        }
        const mime = bitmapMime(bytes);
        if (!mime || bytes.length < 12 || (temporary && downloadedBytes + bytes.length > MAX_TOTAL_BYTES)) throw new Error("图片格式或大小无效");
        if (temporary) { await rename(temporary, filename); downloadedBytes += bytes.length; }
        Object.assign(entry, { status: "cached", mime, size: bytes.length });
      } catch { entry.reason = "图片下载失败或文件不是支持的图片，可刷新原票重试"; }
      finally { if (temporary) await rm(temporary, { force: true }).catch(() => undefined); }
    }
    const stored: StoredContext = { version: 1, identity, detail, images, errors: result.errors, cachedAt: new Date().toISOString(), source: "remote", ...(warning ? { warning } : {}) };
    const temporary = path.join(dir, `.context-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(stored), { mode: 0o600, flag: "wx" });
      await rename(temporary, path.join(dir, "context.json"));
    } catch { warning = [warning, "本地上下文保存失败，本次内容仍可查看"].filter(Boolean).join("；"); }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
    return view(stored, "remote", warning);
  }
  return {
    async get(identity: MeegleWorkItemIdentity, options: { refresh?: boolean } = {}): Promise<MeegleContextView> {
      validateIdentity(identity);
      const key = JSON.stringify(identity);
      const existing = pending.get(key);
      if (existing) {
        if (!options.refresh) return existing;
        await existing;
        return this.get(identity, options);
      }
      const task = run(identity, Boolean(options.refresh)); pending.set(key, task);
      try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
    },
    async readImage(identity: MeegleWorkItemIdentity, id: string): Promise<{ bytes: Buffer; mime: string } | null> {
      validateIdentity(identity);
      if (!/^[a-f0-9]{64}$/.test(id)) return null;
      try {
        const dir = await directory(identity, false);
        const stored = await readStored(dir, identity);
        const entry = Object.values(stored?.images ?? {}).find(image => image.id === id && image.status === "cached");
        if (!entry) return null;
        const bytes = await safeRead(path.join(dir, "images", id), MAX_IMAGE_BYTES);
        const mime = bitmapMime(bytes);
        return mime && mime === entry.mime ? { bytes, mime } : null;
      } catch { return null; }
    },
  };
}
