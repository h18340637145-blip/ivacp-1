import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
const cache = vi.hoisted(() => ({ get: vi.fn(), readImage: vi.fn() }));
vi.mock("@/server/meegle/context-view", () => ({ meegleContextCache: cache }));
import { GET as contextGet } from "@/app/api/meegle/context-view/route";
import { GET as imageGet } from "@/app/api/meegle/context-image/route";
const query = "projectKey=test-project&workItemTypeKey=issue&workItemId=7148399110";
const context = { params: Promise.resolve({}) };
function request(route: string, params = query, auth = true) {
  return new NextRequest(`http://localhost/api/meegle/${route}?${params}`, { headers: auth ? { cookie: `${AUTH_SESSION_COOKIE}=${createSessionToken({ username: "cache-test", displayName: "测试", role: "analyst" })}` } : {} });
}
beforeEach(() => vi.resetAllMocks());
it("评论与图片接口必须登录，非法身份在缓存服务之前被拒绝", async () => {
  expect((await contextGet(request("context-view", query, false), context)).status).toBe(401);
  expect((await imageGet(request("context-image", query, false), context)).status).toBe(401);
  expect((await contextGet(request("context-view", query.replace("test-project", "..%2Fescape")), context)).status).toBe(400);
  expect(cache.get).not.toHaveBeenCalled(); expect(cache.readImage).not.toHaveBeenCalled();
});
it("刷新参数和完整工单身份传入缓存服务，缓存响应禁止公共缓存", async () => {
  cache.get.mockResolvedValue({ detail: null, source: "snapshot", images: {}, warning: "原票不可用" });
  const response = await contextGet(request("context-view", `${query}&refresh=1`), context);
  expect(response.status).toBe(200); expect(cache.get).toHaveBeenCalledWith({ projectKey: "test-project", workItemTypeKey: "issue", workItemId: "7148399110" }, { refresh: true });
  expect(response.headers.get("cache-control")).toContain("private"); expect((await response.json()).warning).toBe("原票不可用");
});
it("图片接口仅返回指定票的缓存字节和位图 MIME，缺失为404", async () => {
  cache.readImage.mockResolvedValueOnce({ bytes: Buffer.from([1, 2, 3]), mime: "image/png" });
  const response = await imageGet(request("context-image", `${query}&imageId=${"a".repeat(64)}`), context);
  expect(response.headers.get("content-type")).toBe("image/png"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  cache.readImage.mockResolvedValueOnce(null);
  expect((await imageGet(request("context-image", `${query}&imageId=missing`), context)).status).toBe(404);
});
