import path from "node:path";
import { createHash } from "node:crypto";
import type { TerminalProject, TerminalRepoConfig } from "../../../domain/terminal/types";

export interface SyncFile { name: string; source: string; oid: string; repoDir: string }
export interface SyncCommit { commitid: string; rtcids: string[] }
export interface SyncSnapshot { history?: SyncCommit[]; commitid: string; rtcids: string[]; files: SyncFile[]; warnings: string[] }
export interface SyncReader {
  snapshot(project: TerminalProject, repo: TerminalRepoConfig): Promise<SyncSnapshot>;
  readFile(file: SyncFile): Promise<Buffer>;
}
export type SyncCommand = (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const shellPath = (value: string) => value.startsWith("~/") ? `~/${quote(value.slice(2))}` : value === "~" ? "~" : quote(value);
const ROOT_PROTO = "com.bosch.cm.platform.vehicle.proto";
const validOid = (value: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export function extractRtcIds(message: string): string[] {
  return [...new Set([...message.matchAll(/(?<![\p{L}\p{N}_-])RTC1-\d+(?![\p{L}\p{N}_-])/gu)].map(match => match[0]))];
}
export function assertFileName(name: string): void {
  if (!name || name === "." || name === ".." || name === "bak" || name === ".sync-state.json" || /[\\/\x00-\x1f]/.test(name)) throw new Error(`不支持的同步文件名：${name}`);
}
export function gitBlobId(content: Buffer, length = 40): string {
  return createHash(length === 64 ? "sha256" : "sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}
export function createGitSyncReader(run: SyncCommand): SyncReader {
  async function execute(command: string) {
    const result = await run(command);
    if (result.code !== 0) throw new Error((result.stderr || `远端读取失败，退出码 ${result.code}`).slice(0, 600));
    return result.stdout;
  }
  return {
    async snapshot(project, repo) {
      if (!repo.repoPath || repo.repoPath.split(/[\\/]/).includes("..") || /[\0\r\n]/.test(repo.repoPath + project.mainPath + repo.branchName)) throw new Error("仓库路径或分支配置无效");
      const repoDir = `${project.mainPath.replace(/\/+$/, "")}/${repo.repoPath.replace(/^\/+/, "")}`;
      const ref = `refs/heads/${repo.branchName}^{commit}`;
      const includeProto = repo.repoName === "api-public";
      const protoPath = includeProto ? ` ${quote(ROOT_PROTO)}` : "";
      const stdout = await execute(`cd ${shellPath(repoDir)} && git check-ref-format ${quote(`refs/heads/${repo.branchName}`)} && c=$(git rev-parse --verify ${quote(ref)}) && printf '%s\\0' "$c" && git log -10 -z --format=%H%x00%B "$c" && printf '\\0' && git ls-tree -r -z "$c" -- tools/json tools/sdb tools/scripts${protoPath}`);
      const parts = stdout.split("\0");
      const commitid = parts.shift() ?? "";
      if (!validOid(commitid)) throw new Error("远端 Git 提交响应格式无效");
      const history: SyncCommit[] = [];
      while (parts[0]) {
        const id = parts.shift()!;
        const message = parts.shift();
        if (!validOid(id) || message === undefined || history.length >= 10) throw new Error("远端 Git 历史响应格式无效");
        history.push({ commitid: id, rtcids: extractRtcIds(message) });
      }
      if (parts.shift() !== "" || history[0]?.commitid !== commitid) throw new Error("远端 Git 历史响应格式无效");
      const files: SyncFile[] = [];
      const found = new Set<string>();
      for (const entry of parts.filter(Boolean)) {
        const match = /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
        if (!match) throw new Error("远端 Git 文件清单格式无效");
        const [, mode, type, oid, source] = match;
        if (type !== "blob" || !["100644", "100755"].includes(mode)) continue;
        if (!validOid(oid)) throw new Error("远端 Git blob ID 无效");
        const name = path.posix.basename(source);
        const category = source.startsWith("tools/json/") && name.endsWith(".json") ? "json"
          : source.startsWith("tools/sdb/") ? "sdb"
          : source.startsWith("tools/scripts/") && (name === "type.h" || name === "types.hal" || name.endsWith(".xls")) ? "scripts"
          : includeProto && source === ROOT_PROTO ? "proto" : "";
        if (!category) continue;
        assertFileName(name);
        files.push({ name, source, oid, repoDir }); found.add(category);
        if (files.length > 10000) throw new Error("单仓库同步文件超过 10000 个");
      }
      files.sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
      const rtcids = history[0].rtcids;
      const warnings = ["json", "sdb", "scripts"].filter(dir => !found.has(dir)).map(dir => `tools/${dir} 未找到匹配的已提交普通文件`);
      if (includeProto && !found.has("proto")) warnings.push(`${ROOT_PROTO} 未找到匹配的已提交普通文件`);
      if (!rtcids.length) warnings.push("提交中未识别 RTC ID");
      return { commitid, rtcids, history, files, warnings };
    },
    async readFile(file) {
      if (!validOid(file.oid)) throw new Error("Git blob ID 无效");
      const encoded = (await execute(`bash -o pipefail -c ${quote(`cd ${shellPath(file.repoDir)} && git cat-file blob ${file.oid} | base64`)}`)).replace(/\s/g, "");
      if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("文件传输 base64 无效");
      const content = Buffer.from(encoded, "base64");
      if (gitBlobId(content, file.oid.length) !== file.oid) throw new Error(`文件传输校验失败：${file.source}`);
      return content;
    },
  };
}
