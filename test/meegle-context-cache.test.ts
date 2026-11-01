import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMeegleContextCache, isMeegleImageDownloadUrl } from "@/server/meegle/context-cache";
import { normalizeMeegleWorkItemDetail } from "@/domain/meegle/work-item-detail";

const identity = { projectKey: "project-test", workItemTypeKey: "issue" as const, workItemId: "7148399110" };
const image = "https://project.feishu.cn/goapi/v5/platform/file/stream/download/img_fixture?token=a%2Fb&x=1";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const detail = () => normalizeMeegleWorkItemDetail({ identity, workItem: {}, comments: [{ comment_id: "1", content: `第一段\n\n![](${image})\n\n第二段` }] });
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ivacp-context-test-")); roots.push(root);
  const loadDetail = vi.fn(async () => ({ detail: detail(), errors: {}, status: 200 as const }));
  const download = vi.fn(async (_identity: unknown, url: string, destination: string) => { expect(url).toBe(image); await writeFile(destination, png); });
  const cache = createMeegleContextCache({ root, loadDetail, download });
  return { root, cache, loadDetail, download };
}
describe("飞书上下文持久化缓存", () => {
  it("7148399110 图片评论原文与图片持久化，跨实例刷新复用且 URL 不变", async () => {
    const { root, cache, loadDetail, download } = await setup();
    const first = await cache.get(identity);
    expect(first.detail?.comments[0].body).toBe(detail().comments[0].body);
    expect(first.images[image].status).toBe("cached");
    expect(download).toHaveBeenCalledOnce();
    const secondCache = createMeegleContextCache({ root, loadDetail, download });
    const second = await secondCache.get(identity);
    expect(second.source).toBe("cache"); expect(loadDetail).toHaveBeenCalledOnce();
    const stored = await secondCache.readImage(identity, first.images[image].id);
    expect(stored?.bytes).toEqual(png); expect(stored?.mime).toBe("image/png");
    expect(await secondCache.readImage({ ...identity, workItemId: "7148399111" }, first.images[image].id)).toBeNull();
    await secondCache.get(identity, { refresh: true });
    expect(loadDetail).toHaveBeenCalledTimes(2); expect(download).toHaveBeenCalledOnce();
  });
  it("刷新失败保留旧缓存，评论接口失败不清空既有评论", async () => {
    const { cache, loadDetail } = await setup(); await cache.get(identity);
    loadDetail.mockRejectedValueOnce(new Error("auth failure"));
    const failed = await cache.get(identity, { refresh: true });
    expect(failed.source).toBe("cache"); expect(failed.warning).toBeTruthy(); expect(failed.detail?.comments).toHaveLength(1);
    loadDetail.mockResolvedValueOnce({ detail: { ...detail(), comments: [] }, errors: { comments: "COMMENTS_UPSTREAM_FAILED" }, status: 200 } as never);
    const partial = await cache.get(identity, { refresh: true });
    expect(partial.detail?.comments).toHaveLength(1); expect(partial.warning).toBeTruthy();
  });
  it("下载失败或伪装的 HTML 图片只产生占位，可重试，不丢评论", async () => {
    const { cache, download } = await setup();
    download.mockImplementationOnce(async (_identity, _url, destination) => { await writeFile(destination, "<svg onload='alert(1)'>"); });
    const first = await cache.get(identity); expect(first.images[image].status).toBe("unavailable");
    expect(first.detail?.comments).toHaveLength(1); expect(await cache.readImage(identity, first.images[image].id)).toBeNull();
    const next = await cache.get(identity, { refresh: true }); expect(next.images[image].status).toBe("cached");
  });
  it("并发读取同票只下载一次，描述图片和重复图片共享同一缓存", async () => {
    const { cache, loadDetail, download } = await setup();
    loadDetail.mockResolvedValue({ detail: { ...detail(), descriptionFields: [{ key: "description", name: "描述", value: `![](${image})` }] }, errors: {}, status: 200 });
    const [a, b] = await Promise.all([cache.get(identity), cache.get(identity)]);
    expect(a.images[image]).toEqual(b.images[image]); expect(download).toHaveBeenCalledOnce(); expect(loadDetail).toHaveBeenCalledOnce();
  });
  it("无缓存且远端失败返回快照模式，不写空内容", async () => {
    const { cache, loadDetail, root } = await setup(); loadDetail.mockRejectedValue(new Error("offline"));
    expect((await cache.get(identity)).source).toBe("snapshot");
    expect((await cache.get(identity)).detail).toBeNull(); expect((await readdir(root)).length).toBeLessThanOrEqual(1);
  });
  it("损坏的已有图片在刷新时重新下载", async () => {
    const { cache, root, download } = await setup(); const first = await cache.get(identity);
    await writeFile(path.join(root, identity.projectKey, "issue", `meegle-${identity.workItemId}`, "images", first.images[image].id), "broken");
    const next = await cache.get(identity, { refresh: true });
    expect(next.images[image].status).toBe("cached"); expect(download).toHaveBeenCalledTimes(2);
  });
  it("新增图片耗尽读取时间仍复用此前已缓存的图片", async () => {
    const { cache, loadDetail, download } = await setup(); const first = await cache.get(identity);
    const newer = "https://project.feishu.cn/files/new";
    loadDetail.mockResolvedValueOnce({ detail: { ...detail(), comments: [{ ...detail().comments[0], body: `![](${newer})\n\n![](${image})`, attachments: [] }] }, errors: {}, status: 200 });
    const now = vi.spyOn(Date, "now"); let clock = 1000; now.mockImplementation(() => clock);
    download.mockImplementationOnce(async () => { clock += 60_000; throw new Error("timeout"); });
    try {
      const next = await cache.get(identity, { refresh: true });
      expect(next.images[newer].status).toBe("unavailable"); expect(next.images[image].status).toBe("cached");
      expect(await cache.readImage(identity, first.images[image].id)).not.toBeNull();
    } finally { now.mockRestore(); }
  });
  it("拒绝路径穿越、符号链接和越票的图像引用", async () => {
    const { cache, root } = await setup();
    await expect(cache.get({ ...identity, projectKey: "../escape" })).rejects.toThrow();
    expect(await cache.readImage(identity, "../../etc/passwd")).toBeNull();
    await symlink(os.tmpdir(), path.join(root, identity.projectKey));
    await expect(cache.get(identity)).rejects.toThrow(/目录|链接/);
    expect(await readFile(path.join(root, identity.projectKey, "does-not-exist")).catch(() => null)).toBeNull();
  });
});
it("图片下载白名单保持真实文件 URL，页面链接和非官方网址不作下载", () => {
  expect(isMeegleImageDownloadUrl(image)).toBe(true);
  expect(isMeegleImageDownloadUrl("https://project.feishu.cn/files/opaque")).toBe(true);
  for (const url of ["https://project.feishu.cn/pojw7j/issue/detail/7148399110", "https://example.com/files/a", "https://user@project.feishu.cn/files/a", "http://project.feishu.cn/files/a", "https://project.feishu.cn:8443/files/a"]) expect(isMeegleImageDownloadUrl(url)).toBe(false);
});
