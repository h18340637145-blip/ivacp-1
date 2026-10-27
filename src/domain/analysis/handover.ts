/** 经办人接手 / 转出 / 停留时间计算（纯函数，不依赖浏览器或服务端环境） */

export const HANDOVER_OUT_OFFSET_MS = 60 * 60 * 1000;
export const HANDOVER_WEEKEND_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DWELL_MS = 4 * 60 * 60 * 1000;
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface HandoverFields {
  handoverAt?: Date;
  handoverOutAt?: Date;
  dwellMs?: number;
  isWeekend?: "是" | "否";
}

export const DEFAULT_MEEGLE_ASSIGNEE_ROLE_KEY = "role_b43b38";

/** 解析 STATISTICS_SOLVE_TIME_USERS，格式如 [HUANG Hongwei, DAI Yungui]；未配置时无目标经办人 */
export function handoverUserNames(env: Record<string, string | undefined> = process.env): string[] {
  const raw = (env.STATISTICS_SOLVE_TIME_USERS ?? "").trim().replace(/^[[\s'"]+|[\]\s'"]+$/g, "");
  return raw.split(/[,，]/).map((name) => name.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

export function meegleAssigneeRoleKey(env: Record<string, string | undefined> = process.env): string {
  return env.MEEGLE_ASSIGNEE_ROLE_KEY?.trim() || DEFAULT_MEEGLE_ASSIGNEE_ROLE_KEY;
}

interface MeegleOpRecord {
  op_record_module?: string;
  operation_time?: number;
  record_contents?: Array<{
    object?: { object_type?: string; object_value?: string };
    new?: unknown[];
  }>;
}

/** 返回经办人最近一次被改为目标用户的时间（毫秒），没有则返回 undefined */
export function findMeegleHandoverAt(
  records: MeegleOpRecord[],
  targetUserKeys: string[],
  roleKey = DEFAULT_MEEGLE_ASSIGNEE_ROLE_KEY,
): number | undefined {
  const targets = new Set(targetUserKeys);
  let latest: number | undefined;
  for (const record of records) {
    if (record.op_record_module !== "role_and_user_mod" || typeof record.operation_time !== "number") continue;
    const matched = (record.record_contents ?? []).some((content) => {
      const objectKey = content.object?.object_value ?? "";
      const isAssigneeRole = objectKey === roleKey || objectKey.endsWith(`_${roleKey}`);
      return isAssigneeRole && (content.new ?? []).some((userKey) => targets.has(String(userKey)));
    });
    if (matched && (latest === undefined || record.operation_time > latest)) latest = record.operation_time;
  }
  return latest;
}

interface JiraHistory {
  created?: string;
  items?: Array<{ field?: string; to?: string | null; toString?: string | null }>;
}

/** 返回 Jira 经办人最近一次被改为目标人员的时间（毫秒），没有则返回 undefined */
export function findJiraHandoverAt(histories: JiraHistory[], targetNames: string[]): number | undefined {
  const targets = targetNames.map((name) => name.toLowerCase());
  let latest: number | undefined;
  for (const history of histories) {
    const time = history.created ? Date.parse(history.created) : NaN;
    if (Number.isNaN(time)) continue;
    const matched = (history.items ?? []).some((item) => {
      if (item.field !== "assignee") return false;
      const assignee = `${item.toString ?? ""} ${item.to ?? ""}`.toLowerCase();
      return targets.some((target) => assignee.includes(target));
    });
    if (matched && (latest === undefined || time > latest)) latest = time;
  }
  return latest;
}

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 19;

/** 接手时间（东八区）是否在正常工作时间：周一至周五 09:00–19:00；其余（含周末）为非工作时间 */
export function isWorkingHoursInChina(ms: number): boolean {
  const date = new Date(ms + CHINA_OFFSET_MS);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

/** 接手当天（东八区）是否周六或周日 */
export function isWeekendInChina(ms: number): boolean {
  const day = new Date(ms + CHINA_OFFSET_MS).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * 补全转出时间、停留时间与是否周末。baseTime 为评论回填成功时间；回填前用处理结束时间。
 * 找不到接手时间时接手时间留空，停留时间按默认 4 小时记。
 */
export function completeHandoverFields(handoverAt: Date | undefined, baseTime: Date): HandoverFields {
  const handoverOutAt = new Date(baseTime.getTime() + HANDOVER_OUT_OFFSET_MS);
  if (!handoverAt || Number.isNaN(handoverAt.getTime())) {
    return { handoverAt: undefined, handoverOutAt, dwellMs: DEFAULT_DWELL_MS, isWeekend: "否" };
  }
  const dwellMs = handoverOutAt.getTime() - handoverAt.getTime();
  const weekend = dwellMs > HANDOVER_WEEKEND_THRESHOLD_MS && isWeekendInChina(handoverAt.getTime());
  return { handoverAt, handoverOutAt, dwellMs, isWeekend: weekend ? "是" : "否" };
}

export function formatDwell(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes} 分 ${seconds} 秒`;
}
