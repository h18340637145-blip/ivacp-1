import { expect, it } from "vitest";
import { resolveChartImageFile } from "@/server/jira/comment";
it("Jira 附图与公共图片接口使用同一 log 边界，不接受相似目录前缀", () => {
  expect(resolveChartImageFile("/api/charts/log-other/private.png")).toBeNull();
  expect(resolveChartImageFile("/api/charts/log/../private.png")).toBeNull();
  expect(resolveChartImageFile("/api/charts/log/group/model/TEST-1/can_signals.png")).toMatch(/\/log\/group\/model\/TEST-1\/can_signals\.png$/);
});
