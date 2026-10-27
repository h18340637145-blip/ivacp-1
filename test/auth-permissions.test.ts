import { expect, it } from "vitest";
import { isPublicPath } from "@/domain/auth/permissions";
it("API 产物即使带文件扩展名也必须登录", () => {
  expect(isPublicPath("/api/charts/log/team/model/TEST-1/can_signals.png")).toBe(false);
  expect(isPublicPath("/api/other/records.json")).toBe(false);
  expect(isPublicPath("/api/docs")).toBe(true);
  expect(isPublicPath("/api/openapi")).toBe(true);
  expect(isPublicPath("/file.svg")).toBe(true);
});
