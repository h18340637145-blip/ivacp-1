import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { TransformStream, EColumn } from "dltreader";
import { findFiles } from "./archive";
import { throwIfPipelineCancelled } from "./process/runtime";

export interface LogVersions {
  buildInfo: string;
  socVersion: string;
  sccVersions: Array<{ file: string; version: string }>;
}

/** Decode actual DLT payloads, streaming to keep memory bounded for large logs. */
async function readSccVersions(file: string): Promise<string[]> {
  const versions = new Set<string>();
  const decoder = new TransformStream({}, { stringify: true, columns: [EColumn.PAYLOAD], stopOnError: true });
  let pending = "";
  const consume = (line: string) => {
    const match = line.match(/\[Vip-App\]App:\s*([^\r\n\0]+)/);
    if (match?.[1].trim()) versions.add(match[1].trim());
  };
  await pipeline(createReadStream(file), decoder, new Writable({
    write(chunk, _encoding, done) {
      try {
        throwIfPipelineCancelled();
        pending += chunk.toString();
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) consume(line);
        done();
      } catch (error) { done(error as Error); }
    },
  }));
  consume(pending);
  return [...versions];
}

/** Keep each Buildinfo and its sibling DLTs together; never mix versions across directories. */
export async function extractLogVersions(root: string, warn: (message: string) => void = () => {}): Promise<LogVersions[]> {
  const records: LogVersions[] = [];
  const files = (await findFiles(root, name => name === "buildinfo.txt")).sort();
  for (const file of files) {
    throwIfPipelineCancelled();
    const record: LogVersions = { buildInfo: path.relative(root, file), socVersion: "", sccVersions: [] };
    try {
      const content = await fs.readFile(file, "utf8");
      record.socVersion = content.match(/^\s*MAIN_VERSION\s*=[ \t]*([^\r\n]*)/m)?.[1].trim() ?? "";
      const siblings = (await fs.readdir(path.dirname(file), { withFileTypes: true }))
        .filter(entry => entry.isFile() && /^scc-.*\.dlt$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
      for (const sibling of siblings) {
        const dlt = path.join(path.dirname(file), sibling.name);
        try {
          for (const version of await readSccVersions(dlt)) record.sccVersions.push({ file: path.relative(root, dlt), version });
        } catch (error) {
          throwIfPipelineCancelled();
          warn(`SCC版本解析失败 ${path.relative(root, dlt)}: ${String(error)}`);
        }
      }
    } catch (error) {
      throwIfPipelineCancelled();
      warn(`版本提取失败 ${record.buildInfo}: ${String(error)}`);
    }
    records.push(record);
  }
  return records;
}

export function formatLogVersions(records: LogVersions[]): string {
  if (!records.length) return "";
  return "\n\n## 日志软件版本（不受日志时间窗限制）\n\n" + records.map(record => [
    `Buildinfo来源：${record.buildInfo}`,
    `SOC版本：${record.socVersion || "未找到 MAIN_VERSION"}`,
    ...(record.sccVersions.length ? record.sccVersions.map(scc => `SCC版本：${scc.version}（来源：${scc.file}）`) : ["SCC版本：未提取到"]),
  ].join("\n")).join("\n\n") + "\n";
}
