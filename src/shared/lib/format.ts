/** 中文环境下的日期 / 数字 / 时长格式化 */
const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
const numberFormatter = new Intl.NumberFormat("zh-CN");

function asDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: Date | string | number | null | undefined, fallback = "—"): string {
  const date = asDate(value);
  return date ? dateTimeFormatter.format(date) : fallback;
}

export function formatDate(value: Date | string | number | null | undefined, fallback = "—"): string {
  const date = asDate(value);
  return date ? dateFormatter.format(date) : fallback;
}

export function formatNumber(value: number | null | undefined, fallback = "—"): string {
  return typeof value === "number" && Number.isFinite(value) ? numberFormatter.format(value) : fallback;
}

export function formatPercent(value: number | null | undefined, digits = 1, fallback = "—"): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : fallback;
}

/** 毫秒时长 → “1 小时 5 分”“32 秒” */
export function formatDuration(ms: number | null | undefined, fallback = "—"): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return fallback;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ""}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} 天${hours % 24 ? ` ${hours % 24} 小时` : ""}`;
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 日期 */
export function formatRelative(value: Date | string | number | null | undefined, now = Date.now(), fallback = "—"): string {
  const date = asDate(value);
  if (!date) return fallback;
  const diff = now - date.getTime();
  if (diff < 0) return formatDateTime(date);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(date);
}

export function formatBytes(bytes: number | null | undefined, fallback = "—"): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return fallback;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
