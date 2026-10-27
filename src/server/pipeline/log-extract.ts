import fs from "node:fs/promises";
import path from "node:path";
import { findFiles, isArchiveFile } from "@/server/pipeline/archive";
import { MAX_LOG_CHARS } from "@/server/pipeline/constants";
import { isSupportedCanTrace } from "@/server/pipeline/signals";
import { SignalIdRecord, TimeWindow } from "@/server/pipeline/types";

export function parseFlexibleTimestamp(text: string, fallbackYear?: number): Date | null {
  const fullMatch = text.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?/);
  if (fullMatch) {
    const [, year, month, day, hour, minute, second, fraction = "0"] = fullMatch;
    const ms = Number(fraction.padEnd(3, "0").slice(0, 3));
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      ms,
    );
  }

  const shortMatch = text.match(/(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?/);
  if (shortMatch && fallbackYear) {
    const [, month, day, hour, minute, second, fraction = "0"] = shortMatch;
    const ms = Number(fraction.padEnd(3, "0").slice(0, 3));
    return new Date(
      fallbackYear,
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      ms,
    );
  }

  return null;
}

export function formatDateTimeLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function expandTimeOnlyWithDateHint(timeOnly: string, dateHint: Date): Date | null {
  const normalized = timeOnly.replace(/[：]/g, ":");
  const match = normalized.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, hour, minute, second = "00"] = match;
  return new Date(
    dateHint.getFullYear(),
    dateHint.getMonth(),
    dateHint.getDate(),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  );
}

export function extractCommentTimeWindow(commentsText: string, traceStartTime?: string, traceEndTime?: string): TimeWindow {
  const explicitTimes = Array.from(commentsText.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g))
    .map((match) => parseFlexibleTimestamp(match[0]))
    .filter((value): value is Date => value instanceof Date);

  if (explicitTimes.length > 0) {
    explicitTimes.sort((a, b) => a.getTime() - b.getTime());
    return {
      start: formatDateTimeLocal(explicitTimes[0]),
      end: formatDateTimeLocal(explicitTimes[explicitTimes.length - 1]),
      source: "comment_timestamp",
    };
  }

  const traceStart = traceStartTime ? parseFlexibleTimestamp(traceStartTime) : null;
  const traceEnd = traceEndTime ? parseFlexibleTimestamp(traceEndTime) : null;
  const dateHint = traceStart ?? traceEnd ?? new Date();
  const timeOnlyMatches = Array.from(commentsText.matchAll(/(?:问题发生时间|时间点)\s*[:：]?\s*(\d{1,2}[:：]\d{2}(?::\d{2})?)/g))
    .map((match) => expandTimeOnlyWithDateHint(match[1], dateHint))
    .filter((value): value is Date => value instanceof Date);

  if (timeOnlyMatches.length > 0) {
    timeOnlyMatches.sort((a, b) => a.getTime() - b.getTime());
    const start = timeOnlyMatches[0];
    const end = new Date(timeOnlyMatches[timeOnlyMatches.length - 1].getTime() + 5 * 60 * 1000);
    return {
      start: formatDateTimeLocal(start),
      end: formatDateTimeLocal(end),
      source: "comment_time_only",
    };
  }

  if (traceStart && traceEnd) {
    return {
      start: formatDateTimeLocal(traceStart),
      end: formatDateTimeLocal(traceEnd),
      source: "trace_timestamp",
    };
  }

  const now = new Date();
  return {
    start: formatDateTimeLocal(new Date(now.getTime() - 5 * 60 * 1000)),
    end: formatDateTimeLocal(new Date(now.getTime() + 5 * 60 * 1000)),
    source: "fallback",
  };
}

export function lineContainsSignalId(line: string, signalIds: SignalIdRecord[]): boolean {
  const upperLine = line.toUpperCase();
  return signalIds.some((record) => {
    const hasDecimal = record.decimalId !== null && new RegExp(`(^|\\D)${record.decimalId}(\\D|$)`).test(line);
    const hasHex = record.hexId ? upperLine.includes(record.hexId.toUpperCase()) : false;
    return hasDecimal || hasHex;
  });
}

export async function buildExtractMarkdown(
  extractDir: string,
  window: TimeWindow,
  signalIds: SignalIdRecord[],
): Promise<string> {
  const lines: string[] = [
    "# CAN Trace Window Extract",
    "",
    `- windowSource: ${window.source}`,
    `- startTime: ${window.start}`,
    `- endTime: ${window.end}`,
    `- signalProps: ${signalIds.map((item) => item.prop).join(", ") || "none"}`,
    "",
  ];

  if (signalIds.length === 0) {
    lines.push("未生成筛选结果：signals_id.json 为空。");
    return lines.join("\n") + "\n";
  }

  const startAt = parseFlexibleTimestamp(window.start);
  const endAt = parseFlexibleTimestamp(window.end);
  if (!startAt || !endAt) {
    lines.push("未生成筛选结果：评论/trace 时间格式无法解析。");
    return lines.join("\n") + "\n";
  }

  const fallbackYear = startAt.getFullYear();
  const allFiles = await findFiles(extractDir, () => true);
  let matchCount = 0;

  for (const filePath of allFiles) {
    if (isArchiveFile(filePath) || isSupportedCanTrace(filePath)) continue;

    let content = "";
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      content = "";
    }
    if (!content) continue;

    const matchedLines: string[] = [];
    for (const line of content.split(/\r?\n/)) {
      if (!line || !lineContainsSignalId(line, signalIds)) continue;
      const timestamp = parseFlexibleTimestamp(line, fallbackYear);
      if (!timestamp) continue;
      if (timestamp.getTime() < startAt.getTime() || timestamp.getTime() > endAt.getTime()) continue;
      matchedLines.push(line);
    }

    if (matchedLines.length === 0) continue;

    matchCount += matchedLines.length;
    lines.push(`## ${path.relative(extractDir, filePath)}`);
    lines.push("");
    lines.push("```text");
    lines.push(...matchedLines);
    lines.push("```");
    lines.push("");
  }

  if (matchCount === 0) {
    lines.push("未在解压日志中找到时间窗内且包含目标 prop id 的日志行。");
    lines.push("");
  }

  return lines.join("\n");
}

export const VEHICLE_HAL_HASH_MARKER = "BoschVehicleHalHash";
const MAX_HASH_LINES = 20;

/** 在所有解压文件中提取包含 BoschVehicleHalHash 的行（去重、不受时间窗限制） */
export async function extractVehicleHalHashLines(extractDir: string): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const filePath of await findFiles(extractDir, () => true)) {
    if (isArchiveFile(filePath) || isSupportedCanTrace(filePath)) continue;
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    if (!content.includes(VEHICLE_HAL_HASH_MARKER)) continue;
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.includes(VEHICLE_HAL_HASH_MARKER) || seen.has(line)) continue;
      seen.add(line);
      found.push(line);
      if (found.length >= MAX_HASH_LINES) return found;
    }
  }
  return found;
}

export async function buildFilteredLogsBySignalIds(
  extractDir: string,
  window: TimeWindow,
  signalIds: SignalIdRecord[],
): Promise<{ android: string; qnx: string }> {
  const hashLines = await extractVehicleHalHashLines(extractDir);
  const withHash = (androidLines: string[]) => [...hashLines, ...androidLines.filter((line) => !hashLines.includes(line))].join("\n").slice(0, MAX_LOG_CHARS);
  const startAt = parseFlexibleTimestamp(window.start);
  const endAt = parseFlexibleTimestamp(window.end);
  if (!startAt || !endAt || signalIds.length === 0) {
    return { android: withHash([]), qnx: "" };
  }

  const fallbackYear = startAt.getFullYear();
  const allFiles = await findFiles(extractDir, () => true);
  const androidMatches: string[] = [];
  const qnxMatches: string[] = [];

  for (const filePath of allFiles) {
    if (isArchiveFile(filePath) || isSupportedCanTrace(filePath)) continue;

    let content = "";
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      content = "";
    }
    if (!content) continue;

    for (const line of content.split(/\r?\n/)) {
      if (!line || !lineContainsSignalId(line, signalIds)) continue;
      const timestamp = parseFlexibleTimestamp(line, fallbackYear);
      if (!timestamp) continue;
      if (timestamp.getTime() < startAt.getTime() || timestamp.getTime() > endAt.getTime()) continue;

      if (isAndroidLog(filePath)) {
        androidMatches.push(line);
      } else if (isQnxLog(filePath)) {
        qnxMatches.push(line);
      }
    }
  }

  return {
    android: withHash(androidMatches),
    qnx: qnxMatches.join("\n").slice(0, MAX_LOG_CHARS),
  };
}

/** Read text file, capped at maxChars */
export async function readTextFile(filePath: string, maxChars = MAX_LOG_CHARS): Promise<string> {
  try {
    const buf = await fs.readFile(filePath);
    const text = buf.toString("utf-8", 0, maxChars);
    return text;
  } catch { return ""; }
}

/** Guess if a file is an Android or QNX log by name/path heuristics */
export function isAndroidLog(p: string): boolean {
  const lower = p.toLowerCase();
  const base = path.basename(lower);
  return lower.includes("android")
    || lower.includes("andr")
    || base === "aplog"
    || base.startsWith("aplog.")
    || lower.includes("logcat")
    || lower.endsWith(".log");
}

export function isQnxLog(p: string): boolean {
  const lower = p.toLowerCase();
  const base = path.basename(lower);
  return lower.includes("qnx")
    || lower.includes("sloginfo")
    || base.startsWith("bosch-");
}

/* ─── Car model detection (mirrors Python: check model_to_files keys in summary) ─ */
