import fs from "node:fs/promises";
import path from "node:path";
import { throwIfPipelineCancelled } from "./process/runtime";

export interface ParsedVhalVersion {
  raw: string;
  platform: string;
  version: string;
}
export type VhalVersionResult =
  | ({ status: "ok"; file: string } & ParsedVhalVersion)
  | { status: "not_configured" }
  | { status: "unavailable"; file: string; error: string };

/** Same encoding as extract-vhal-version.js: 4 platform + 2 major + 2 minor digits. */
export function parseVhalVersion(content: string): ParsedVhalVersion {
  const source = content.replace(/\/\*[\s\S]*?\*\//g, " ");
  const match = source.match(/^[\t ]*#[\t ]*define[\t ]+VER_PRO_CFG[\t ]+"(\d{4})(\d{2})(\d{2})"[\t ]*(?:\/\/[^\r\n]*)?\r?$/m);
  if (!match) throw new Error('未找到有效的 VER_PRO_CFG，预期格式为 8 位数字字符串，例如 "82552236"');
  const [, platform, major, minor] = match;
  return { raw: platform + major + minor, platform, version: `${major}.${minor}` };
}

/** Snapshot the current configuration on every run; no default directory or cached version. */
export async function extractVhalVersion(protoRoot?: string): Promise<VhalVersionResult> {
  throwIfPipelineCancelled();
  if (!protoRoot?.trim()) return { status: "not_configured" };
  const file = path.resolve(protoRoot, "type.h");
  try {
    const content = await fs.readFile(file, "utf8");
    throwIfPipelineCancelled();
    return { status: "ok", file, ...parseVhalVersion(content) };
  } catch (error) {
    throwIfPipelineCancelled();
    return { status: "unavailable", file, error: error instanceof Error ? error.message : String(error) };
  }
}

export function formatVhalVersion(result: VhalVersionResult): string {
  if (result.status === "not_configured") return "";
  return "\n\n## 当前配置的 VHAL 版本\n\n" + (result.status === "ok"
    ? `VHAL版本：${result.version}\n平台号：${result.platform}\nVER_PRO_CFG=${result.raw}\n来源：${result.file}\n`
    : `VHAL版本：未提取到\n来源：${result.file}\n原因：${result.error}\n`);
}
