import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { findFiles, isArchiveFile } from "@/server/pipeline/archive";
import { MAX_LOG_CHARS } from "@/server/pipeline/constants";
import { throwIfPipelineCancelled } from "@/server/pipeline/process/runtime";
import { isSupportedCanTrace } from "@/server/pipeline/signals";
import { SignalIdRecord, TimeWindow } from "@/server/pipeline/types";

/** 单行上限：超长行（二进制文件或无换行文件）只保留开头部分，避免整块文件进入内存 */
export const MAX_SCAN_LINE_CHARS = 1 << 20;
const SCAN_CHUNK_BYTES = 1 << 20;

/** 复制字符串，避免保留切片引用的整块父字符串 */
const detach = (value: string) => Buffer.from(value, "utf8").toString("utf8");

/**
 * 流式逐行读取文本（与 content.split(/\r?\n/) 的行划分一致），内存只与块大小和单行上限相关。
 * onLine 返回 false 时提前结束；读取失败视为无内容（与原整读时的容错一致），取消信号照常抛出。
 */
export async function forEachTextLine(filePath: string, onLine: (line: string) => boolean | void): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: SCAN_CHUNK_BYTES });
  let pending = "";
  let overflowed = false;
  const emit = (line: string) => onLine(line) !== false;
  try {
    for await (const chunk of stream as AsyncIterable<string>) {
      throwIfPipelineCancelled();
      let start = 0;
      for (let newline = chunk.indexOf("\n"); newline !== -1; newline = chunk.indexOf("\n", start)) {
        const piece = chunk.slice(start, newline);
        start = newline + 1;
        if (overflowed) { overflowed = false; continue; }
        const line = pending ? pending + piece : piece;
        pending = "";
        if (!emit(line.endsWith("\r") ? line.slice(0, -1) : line)) return;
      }
      if (overflowed) continue;
      pending += chunk.slice(start);
      if (pending.length > MAX_SCAN_LINE_CHARS) {
        const head = pending.slice(0, MAX_SCAN_LINE_CHARS);
        pending = "";
        overflowed = true;
        if (!emit(head)) return;
      }
    }
    if (pending && !overflowed) emit(pending);
  } catch (error) {
    throwIfPipelineCancelled();
    if (!(error instanceof Error && "code" in error)) throw error;
  } finally {
    stream.destroy();
  }
}

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

    const matchedLines: string[] = [];
    await forEachTextLine(filePath, (line) => {
      if (!line || !lineContainsSignalId(line, signalIds)) return;
      const timestamp = parseFlexibleTimestamp(line, fallbackYear);
      if (!timestamp) return;
      if (timestamp.getTime() < startAt.getTime() || timestamp.getTime() > endAt.getTime()) return;
      matchedLines.push(detach(line));
    });

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
    await forEachTextLine(filePath, (raw) => {
      if (!raw.includes(VEHICLE_HAL_HASH_MARKER)) return;
      const line = detach(raw.trim());
      if (seen.has(line)) return;
      seen.add(line);
      found.push(line);
      if (found.length >= MAX_HASH_LINES) return false;
    });
    if (found.length >= MAX_HASH_LINES) return found;
  }
  return found;
}

export async function buildFilteredLogsBySignalIds(
  extractDir: string,
  window: TimeWindow,
  signalIds: SignalIdRecord[],
): Promise<{ android: string; qnx: string; boschVehicleHalHashLines: string[] }> {
  const hashLines = await extractVehicleHalHashLines(extractDir);
  const withHash = (androidLines: string[]) => [...hashLines, ...androidLines.filter((line) => !hashLines.includes(line))].join("\n").slice(0, MAX_LOG_CHARS);
  const startAt = parseFlexibleTimestamp(window.start);
  const endAt = parseFlexibleTimestamp(window.end);
  if (!startAt || !endAt || signalIds.length === 0) {
    return { android: withHash([]), qnx: "", boschVehicleHalHashLines: hashLines };
  }

  const fallbackYear = startAt.getFullYear();
  const allFiles = await findFiles(extractDir, () => true);
  const androidMatches: string[] = [];
  const qnxMatches: string[] = [];
  // 输出最终截断为 MAX_LOG_CHARS，累计已超过上限后的命中行不会出现在结果中，无需继续保存
  const hashSet = new Set(hashLines);
  let androidChars = 0;
  let qnxChars = 0;

  for (const filePath of allFiles) {
    if (isArchiveFile(filePath) || isSupportedCanTrace(filePath)) continue;
    const android = isAndroidLog(filePath);
    const qnx = !android && isQnxLog(filePath);
    if (!android && !qnx) continue;
    if (android ? androidChars > MAX_LOG_CHARS : qnxChars > MAX_LOG_CHARS) continue;

    await forEachTextLine(filePath, (line) => {
      if (!line || !lineContainsSignalId(line, signalIds)) return;
      const timestamp = parseFlexibleTimestamp(line, fallbackYear);
      if (!timestamp) return;
      if (timestamp.getTime() < startAt.getTime() || timestamp.getTime() > endAt.getTime()) return;

      if (android) {
        androidMatches.push(detach(line));
        if (!hashSet.has(line)) androidChars += line.length + 1;
        if (androidChars > MAX_LOG_CHARS) return false;
      } else {
        qnxMatches.push(detach(line));
        qnxChars += line.length + 1;
        if (qnxChars > MAX_LOG_CHARS) return false;
      }
    });
  }

  return {
    boschVehicleHalHashLines: hashLines,
    android: withHash(androidMatches),
    qnx: qnxMatches.join("\n").slice(0, MAX_LOG_CHARS),
  };
}

/** 读取文件开头 maxChars 字节并按 UTF-8 解码（只读需要的部分，避免整读大文件） */
export async function readTextFile(filePath: string, maxChars = MAX_LOG_CHARS): Promise<string> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(Math.max(0, maxChars));
      let read = 0;
      while (read < buffer.length) {
        const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      return buffer.toString("utf-8", 0, read);
    } finally {
      await handle.close();
    }
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
