import { describe, expect, it } from "vitest";
import { resolveChartImageFile } from "@/server/charts/files";
import { parseReviewVerdict } from "@/server/pipeline/review/verdict";

describe("chart containment", () => {
 it("accepts only PNGs strictly under log", () => {
  expect(resolveChartImageFile("/api/charts/log/g/m/ABC-1/can_signals.png")).toMatch(/\/log\/g\/m\/ABC-1\/can_signals.png$/);
  for (const input of ["/api/charts/log-other/file.png", "/api/charts/log/../secret.png", "/api/charts/log/%2e%2e/secret.png", "/api/charts/log/x.json", "/api/charts/log\\x.png"]) {
   expect(resolveChartImageFile(input)).toBeNull();
  }
 });
});
describe("real AI review", () => {
 it("accepts explicit model verdicts", () => {
  expect(parseReviewVerdict('<think>reason</think>```json\n{"verdict":"FAIL","reason":"缺证据"}\n```')).toEqual({ verdict: "FAIL", reason: "缺证据" });
 });
 it("never marks unparseable or missing model verdict as PASS", () => {
  for (const input of ["模型服务异常", '{}', '{"reason":"看起来正确"}', '{"verdict":"MAYBE","reason":"未知"}']) {
   expect(() => parseReviewVerdict(input)).toThrow();
  }
 });
});
