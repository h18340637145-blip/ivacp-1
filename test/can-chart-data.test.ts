import { expect, it } from "vitest";
import { usableTickConfig, tracePoints } from "@/domain/analysis/can-chart";
it("DBC 枚举不覆盖实际信号值时回退数值轴", () => {
  expect(usableTickConfig({ ticks: [0, 1], labels: ["关闭", "打开"] }, [89, 100])).toBe(false);
  expect(usableTickConfig({ ticks: [0, 1], labels: ["关闭", "打开"] }, [0, 1])).toBe(true);
});
it("剔除无效时间与数值，保留原始时间顺序", () => {
  expect(tracePoints({ x: ["2026-10-27 12:00:00.000", "bad", "2026-10-27 12:00:01.000"], y: [89, 100, 100] }).map((point) => point.y)).toEqual([89, 100]);
});
