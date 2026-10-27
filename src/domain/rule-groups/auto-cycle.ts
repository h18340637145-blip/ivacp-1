import type { AutoCycleState } from "@/domain/entities";

/** 自动周期（筛票 → 处理）最小间隔 5 分钟，默认 30 分钟；看板每 30 秒检查一次是否到期 */
export const AUTO_CYCLE_MIN_INTERVAL_MINUTES = 5;
export const AUTO_CYCLE_DEFAULT_INTERVAL_MINUTES = 30;
export const AUTO_CYCLE_POLL_MS = 30_000;

export function clampAutoCycleInterval(intervalMinutes: number): number {
  if (!Number.isFinite(intervalMinutes)) return AUTO_CYCLE_DEFAULT_INTERVAL_MINUTES;
  return Math.max(AUTO_CYCLE_MIN_INTERVAL_MINUTES, Math.round(intervalMinutes));
}

export function nextAutoCycleRunDate(intervalMinutes: number, from = new Date()): Date {
  return new Date(from.getTime() + clampAutoCycleInterval(intervalMinutes) * 60_000);
}

/** 开启 / 关闭自动周期：开启时若没有下次运行时间则立即到期 */
export function toggleAutoCycleState(
  existing: AutoCycleState | undefined,
  ruleGroupId: string,
  isActive: boolean,
  now = new Date(),
): AutoCycleState {
  return {
    ...existing,
    ruleGroupId,
    intervalMinutes: clampAutoCycleInterval(existing?.intervalMinutes ?? AUTO_CYCLE_DEFAULT_INTERVAL_MINUTES),
    isActive,
    lastRunAt: existing?.lastRunAt,
    nextRunAt: isActive ? (existing?.nextRunAt ?? now) : existing?.nextRunAt,
  };
}

/** 修改间隔：运行中的周期按新间隔从现在重新计时 */
export function updateAutoCycleInterval(
  existing: AutoCycleState | undefined,
  ruleGroupId: string,
  rawIntervalMinutes: number,
  now = new Date(),
): AutoCycleState {
  const intervalMinutes = clampAutoCycleInterval(rawIntervalMinutes);
  return {
    ...existing,
    ruleGroupId,
    intervalMinutes,
    isActive: existing?.isActive ?? false,
    lastRunAt: existing?.lastRunAt,
    nextRunAt: existing?.isActive ? nextAutoCycleRunDate(intervalMinutes, now) : existing?.nextRunAt,
  };
}

export function markAutoCycleRan(existing: AutoCycleState, now = new Date()): AutoCycleState {
  return { ...existing, lastRunAt: now, nextRunAt: nextAutoCycleRunDate(existing.intervalMinutes, now) };
}

export function isAutoCycleDue(state: AutoCycleState | undefined, now = Date.now()): boolean {
  if (!state?.isActive) return false;
  const next = state.nextRunAt ? new Date(state.nextRunAt).getTime() : 0;
  return next <= now;
}
