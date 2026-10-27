/**
 * 记录序列化：JSON 中保留 Date 类型（`{"$date": iso}`），
 * 用于备份文件、MySQL 镜像与旧库迁移，客户端与服务端共用。
 */
const DATE_TAG = "$date";

export function serializeRecord(value: unknown): string {
  return JSON.stringify(value, function replacer(this: Record<string, unknown>, key, current) {
    const raw = this[key];
    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? null : { [DATE_TAG]: raw.toISOString() };
    }
    return current;
  });
}

export function reviveDates<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => reviveDates(item)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 1 && entries[0][0] === DATE_TAG && typeof entries[0][1] === "string") {
      return new Date(entries[0][1]) as T;
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, reviveDates(item)])) as T;
  }
  return value as T;
}

export function deserializeRecord<T = unknown>(text: string): T {
  return JSON.parse(text, (_key, current) => {
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      Object.keys(current).length === 1 &&
      typeof current[DATE_TAG] === "string"
    ) {
      return new Date(current[DATE_TAG]);
    }
    return current;
  }) as T;
}

/** 宽松地把 Date / ISO 字符串 / 毫秒数转为 Date；无效值返回 undefined */
export function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>)[DATE_TAG] === "string") {
    return toDate((value as Record<string, unknown>)[DATE_TAG]);
  }
  return undefined;
}
