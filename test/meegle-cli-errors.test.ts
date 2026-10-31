import { describe, expect, it } from "vitest";
import { formatMeegleCliError } from "@/server/meegle/cli";

describe("飞书 CLI 错误格式化", () => {
  it("AUTH_REQUIRED 给出登录指引且不泄露命令行", () => {
    const error = Object.assign(new Error("Command failed: private command"), {
      stderr: JSON.stringify({ data: null, error: { code: "AUTH_REQUIRED", message: "authentication required", retryable: false } }),
    });
    expect(formatMeegleCliError(error)).toMatch(/AUTH_REQUIRED/);
    expect(formatMeegleCliError(error)).toMatch(/meegle auth login --device-code --host project\.feishu\.cn/);
    expect(formatMeegleCliError(error)).not.toMatch(/private command/);
  });

  it("超时给出可重试提示且不泄露命令行", () => {
    expect(formatMeegleCliError({code:"MEEGLE_CLI_TIMEOUT",stderr:"private command"})).toMatch(/超时.*重新筛选/);
    expect(formatMeegleCliError({code:"MEEGLE_CLI_TIMEOUT",stderr:"private command"})).not.toContain("private command");
  });

  it("其他错误返回通用提示", () => {
    expect(formatMeegleCliError(new Error("private command"))).toBe("飞书 MQL 查询失败，请检查服务端日志");
    expect(formatMeegleCliError({ stderr: "not json" })).toBe("飞书 MQL 查询失败，请检查服务端日志");
  });
});
