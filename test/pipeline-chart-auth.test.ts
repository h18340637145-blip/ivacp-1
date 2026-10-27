import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
const { readChart } = vi.hoisted(() => ({ readChart: vi.fn(async () => new Uint8Array([1])) }));
vi.mock("@/server/charts/files", () => ({ readChart }));
import { GET } from "@/app/api/charts/[...path]/route";
import { AUTH_SESSION_COOKIE, createSessionToken } from "@/server/auth/session";
const context = { params: Promise.resolve({ path: ["log", "g", "model", "meegle-1", "run-1", "can_signals.png"] }) };
describe("chart access", () => {
 it("rejects a PNG request without an authenticated session before reading the file", async () => {
  readChart.mockClear();
  const response = await GET(new NextRequest("http://localhost/api/charts/log/g/model/meegle-1/run-1/can_signals.png"), context);
  expect(response.status).toBe(401); expect(readChart).not.toHaveBeenCalled();
 });
 it("serves authenticated images with private caching", async () => {
  const token = createSessionToken({ username: "test", displayName: "测试", role: "analyst" });
  const response = await GET(new NextRequest("http://localhost/api/charts/log/g/model/meegle-1/run-1/can_signals.png", { headers: { cookie: `${AUTH_SESSION_COOKIE}=${token}` } }), context);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
 });
});
