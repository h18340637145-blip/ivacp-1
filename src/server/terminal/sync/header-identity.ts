import fs from "node:fs/promises";
import path from "node:path";
import { parseVhalVersion } from "../../pipeline/vhal-version";
import { assertFileName, type SyncSnapshot } from "./remote";
import { exists, realDirectory } from "./storage";

export function currentRtcids(snapshot: SyncSnapshot): string[] {
  return [...new Set(snapshot.history?.find(entry => entry.commitid === snapshot.commitid)?.rtcids ?? snapshot.rtcids)];
}

/** Name the final winning header using the fixed commit that supplied its bytes. */
export function currentHeaderName(snapshot: SyncSnapshot, content: string): string {
  const rtcids = currentRtcids(snapshot);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(snapshot.commitid) || rtcids.some(id => !/^RTC1-\d+$/.test(id))) {
    throw new Error("当前 type.h 缺少有效 commit/RTC 身份，已保留原快照");
  }
  let version = "unknown-vhal";
  try { version = parseVhalVersion(content).raw; } catch { /* Preserve an explicit unknown identity for invalid headers. */ }
  const name = `${snapshot.commitid}_${rtcids.length ? rtcids.join("_") : "no-rtc"}_${version}`;
  assertFileName(name);
  return name;
}

/** Preserve named copies on commit-only and RTC-only changes as well. */
export async function retireNamedHeader(directory: string, previous: string | undefined, current: string | undefined): Promise<number> {
  if (!previous || previous === current || !await exists(path.join(directory, previous))) return 0;
  assertFileName(previous);
  const content = await fs.readFile(path.join(directory, previous));
  await realDirectory(path.join(directory, "bak"));
  const archive = path.join(directory, "bak", previous);
  if (await exists(archive) && !(await fs.readFile(archive)).equals(content)) throw new Error(`type.h 归档名冲突：${previous}`);
  await fs.writeFile(archive, content);
  await fs.rm(path.join(directory, previous));
  return 1;
}

export async function writeNamedHeader(directory: string, name: string): Promise<void> {
  assertFileName(name);
  const content = await fs.readFile(path.join(directory, "type.h"));
  const destination = path.join(directory, name);
  if (await exists(destination) && !(await fs.readFile(destination)).equals(content)) throw new Error(`当前 type.h 版本文件名冲突：${name}`);
  await fs.writeFile(destination, content);
}
