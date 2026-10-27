import type { SignalTicks } from "@/domain/entities";
export function usableTickConfig(config: SignalTicks[string] | undefined, values: number[]) {
  if (!config?.ticks.length || config.labels.length !== config.ticks.length || config.ticks.some((value) => !Number.isFinite(value))) return false;
  const min = Math.min(...config.ticks), max = Math.max(...config.ticks);
  return values.length > 0 && values.every((value) => value >= min && value <= max);
}
export function tracePoints(data: { x: string[]; y: number[] }): Array<{ x: number; y: number }> {
  return data.x.flatMap((timestamp, index) => {
    // Trace 导出的时间是日志墙上时间；沿用原系统本地时区显示口径。
    const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
    const x = match ? new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6], Number((match[7] ?? "").padEnd(3, "0"))).getTime() : Date.parse(timestamp);
    const y = data.y[index];
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });
}
