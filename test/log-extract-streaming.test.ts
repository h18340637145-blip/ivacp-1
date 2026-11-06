import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_SCAN_LINE_CHARS, buildExtractMarkdown, buildFilteredLogsBySignalIds, extractVehicleHalHashLines, forEachTextLine, readTextFile,
} from "@/server/pipeline/log-extract";
import { MAX_LOG_CHARS } from "@/server/pipeline/constants";
import { findFiles } from "@/server/pipeline/archive";
import type { SignalIdRecord, TimeWindow } from "@/server/pipeline/types";

const window: TimeWindow = { start: "2026-11-06 10:00:00", end: "2026-11-06 10:10:00", source: "comment_timestamp" };
const ids = [{ prop: "P", decimalId: 557, hexId: "0x22D", access: "READ" }] as unknown as SignalIdRecord[];
let dir: string;

/** 旧实现的行划分：整读后 split */
async function splitLines(file: string) {
  return (await fs.readFile(file, "utf8")).split(/\r?\n/);
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "log-extract-"));
  await fs.mkdir(path.join(dir, "android_log"), { recursive: true });
  await fs.mkdir(path.join(dir, "qnx_log"), { recursive: true });
  const hit = (minute: number, n: number) => `2026-11-06 10:0${minute}:00.000 I Vhal: set 557 中文 value=${n}`;
  await fs.writeFile(path.join(dir, "android_log", "aplog"), [
    "BoschVehicleHalHash abc", "  BoschVehicleHalHash abc  ", hit(1, 1), "2026-11-06 09:00:00 set 557 窗口外", hit(2, 2),
  ].join("\r\n") + "\r\n");
  await fs.writeFile(path.join(dir, "qnx_log", "sloginfo"), [hit(3, 3), "无关 0x22d", `2026-11-06 10:04:00 0X22D 尾行\r`].join("\n"));
  await fs.writeFile(path.join(dir, "notes.txt"), `${hit(5, 5)}\n`);
});
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe("日志流式扫描", () => {
  it("行划分与 split(/\\r?\\n/) 一致（CRLF、末行无换行、跨块中文）", async () => {
    const file = path.join(dir, "big.log");
    const line = "2026-11-06 10:01:00 中文行 557 ".repeat(30);
    await fs.writeFile(file, Array.from({ length: 40_000 }, (_, i) => `${line}${i}`).join("\r\n") + "\n尾行\r");
    const lines: string[] = [];
    await forEachTextLine(file, (value) => { lines.push(value); });
    const expected = await splitLines(file);
    expect(lines).toEqual(expected.at(-1) === "" ? expected.slice(0, -1) : expected);
    await fs.rm(file);
  });

  it("超长行只保留开头，之后的行照常读取；onLine 返回 false 提前结束", async () => {
    const file = path.join(dir, "binary.bin");
    await fs.writeFile(file, "x".repeat(MAX_SCAN_LINE_CHARS * 3) + "\nnext\nlast");
    const lines: string[] = [];
    await forEachTextLine(file, (value) => { lines.push(value); });
    expect(lines.map((value) => value.length)).toEqual([MAX_SCAN_LINE_CHARS, 4, 4]);
    let count = 0;
    await forEachTextLine(file, () => { count++; return false; });
    expect(count).toBe(1);
    await fs.rm(file);
  });

  it("不存在的文件视为无内容", async () => {
    let count = 0;
    await forEachTextLine(path.join(dir, "missing.log"), () => { count++; });
    expect(count).toBe(0);
  });

  it("筛选结果与原实现一致", async () => {
    expect(await extractVehicleHalHashLines(dir)).toEqual(["BoschVehicleHalHash abc"]);
    const markdown = await buildExtractMarkdown(dir, window, ids);
    expect(markdown).toContain("## android_log/aplog\n\n```text\n2026-11-06 10:01:00.000 I Vhal: set 557 中文 value=1\n2026-11-06 10:02:00.000 I Vhal: set 557 中文 value=2\n```");
    expect(markdown).toContain("## notes.txt");
    expect(markdown).not.toContain("窗口外");
    const logs = await buildFilteredLogsBySignalIds(dir, window, ids);
    expect(logs.android).toBe([
      "BoschVehicleHalHash abc",
      "2026-11-06 10:01:00.000 I Vhal: set 557 中文 value=1",
      "2026-11-06 10:02:00.000 I Vhal: set 557 中文 value=2",
    ].join("\n"));
    expect(logs.qnx).toBe("2026-11-06 10:03:00.000 I Vhal: set 557 中文 value=3\n2026-11-06 10:04:00 0X22D 尾行\r");
  });

  it("命中超过截断长度时输出仍为前 MAX_LOG_CHARS 字符", async () => {
    const many = path.join(dir, "android_log", "aplog.big");
    const rows = Array.from({ length: 5000 }, (_, i) => `2026-11-06 10:05:00 set 557 row=${i}`);
    await fs.writeFile(many, rows.join("\n"));
    const logs = await buildFilteredLogsBySignalIds(dir, window, ids);
    const perFile: Record<string, string[]> = {
      aplog: ["2026-11-06 10:01:00.000 I Vhal: set 557 中文 value=1", "2026-11-06 10:02:00.000 I Vhal: set 557 中文 value=2"],
      "aplog.big": rows,
    };
    // 与原实现相同：哈希行在前，命中行按 findFiles 的文件顺序拼接后截断
    const ordered = (await findFiles(path.join(dir, "android_log"), () => true)).flatMap((file) => perFile[path.basename(file)] ?? []);
    expect(logs.android).toBe(["BoschVehicleHalHash abc", ...ordered].join("\n").slice(0, MAX_LOG_CHARS));
    expect(logs.android.length).toBe(MAX_LOG_CHARS);
    await fs.rm(many);
  });

  it("readTextFile 只读取开头字节", async () => {
    const file = path.join(dir, "trace.asc");
    await fs.writeFile(file, "abc中文".repeat(10));
    expect(await readTextFile(file, 5)).toBe(Buffer.from("abc中文".repeat(10)).toString("utf-8", 0, 5));
    expect(await readTextFile(file, 1000)).toBe("abc中文".repeat(10));
    expect(await readTextFile(path.join(dir, "none"), 10)).toBe("");
    await fs.rm(file);
  });
});
