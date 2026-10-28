import { terminalContextKey } from "@/domain/terminal/context";
import type { TerminalProjectContext } from "@/domain/terminal/types";
export const shellQuote = (value: string) =>
  `'${value.replace(/'/g, `'\\''`)}'`;
export function shellPath(value: string) {
  const path = value.replace(/\/+/g, "/");
  return path === "~"
    ? "~"
    : path.startsWith("~/")
      ? `~/${shellQuote(path.slice(2))}`
      : shellQuote(path);
}
export const joinRemotePath = (base: string, child: string) =>
  `${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`;
export const contextKey = (context?: TerminalProjectContext) =>
  context ? terminalContextKey(context) : "";
export const selectionKey = (repoPath: string, branchName: string) =>
  JSON.stringify([repoPath, branchName]);
export const buildProjectCdCommand = (context: TerminalProjectContext) =>
  `cd ${shellPath(context.project.mainPath)}\n`;
export const buildSignalConfigCommand = (context: TerminalProjectContext) =>
  `cd ${shellPath(joinRemotePath(context.project.mainPath, context.project.scriptPath))}\n`;
export function buildBranchCheckoutCommand({
  project,
  branch,
}: TerminalProjectContext) {
  return (
    [
      `cd ${shellPath(project.mainPath)}`,
      ...branch.repos.map((repo) => {
        const name = shellQuote(repo.branchName);
        return `(cd ${shellPath(joinRemotePath(project.mainPath, repo.repoPath))} && (git checkout ${name} || (git stash push -u -m ${shellQuote(`auto-stash before checkout ${repo.branchName}`)} && git checkout ${name})))`;
      }),
    ].join("\n") + "\n"
  );
}
export function buildAllReposCommand(
  { project, branch }: TerminalProjectContext,
  command: "git checkout ." | "git pull",
) {
  return (
    [
      `cd ${shellPath(project.mainPath)}`,
      ...branch.repos.map(
        (r) =>
          `(cd ${shellPath(joinRemotePath(project.mainPath, r.repoPath))} && ${command})`,
      ),
    ].join("\n") + "\n"
  );
}
export function parseGitStatusLine(line: string) {
  if (
    line.startsWith("##") ||
    line.startsWith("!!") ||
    !/^([ MADRCUT?!])([ MADRCUT?!]) /.test(line)
  )
    return {
      isFile: false,
      unstaged: false,
      staged: false,
      filePath: "",
      color: line.startsWith("##") ? "text-primary" : "text-muted-foreground",
    };
  let filePath = line.slice(3);
  if (/[RC]/.test(line.slice(0, 2))) {
    let quoted = false;
    for (let index = 0; index < filePath.length; index++) {
      if (filePath[index] === "\\") {
        index++;
        continue;
      }
      if (filePath[index] === '"') quoted = !quoted;
      if (!quoted && filePath.slice(index, index + 4) === " -> ") {
        filePath = filePath.slice(index + 4);
        break;
      }
    }
  }
  if (filePath.startsWith('"')) {
    try {
      filePath = decodeGitQuotedPath(filePath);
    } catch {
      return {
        isFile: false,
        unstaged: false,
        staged: false,
        filePath: "",
        color: "text-muted-foreground",
      };
    }
  }
  const staged = line[0] !== " " && line[0] !== "?";
  const unstaged = line[1] !== " ";
  return {
    isFile: true,
    unstaged,
    staged,
    filePath,
    color: /^(UU|AA|DD|AU|UA|DU|UD)/.test(line)
      ? "text-destructive"
      : line.startsWith("??")
        ? "text-info"
        : line.slice(0, 2).includes("D")
          ? "text-destructive"
          : staged
            ? "text-success"
            : "text-warning",
  };
}
/** Suppress the same toolbar command during a double click; terminal typing is unaffected. */
export class CommandGate {
  private previous = "";
  private at = -Infinity;
  accept(command: string, now = Date.now()) {
    if (command === this.previous && now - this.at < 750) return false;
    this.previous = command;
    this.at = now;
    return true;
  }
}
function decodeGitQuotedPath(raw: string): string {
  if (!raw.endsWith('"')) throw new Error("Invalid quoted Git path");
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    f: 12,
    n: 10,
    r: 13,
    t: 9,
    v: 11,
    '"': 34,
    "\\": 92,
  };
  const value = raw.slice(1, -1);
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== "\\") {
      const point = value.codePointAt(index)!;
      bytes.push(...encoder.encode(String.fromCodePoint(point)));
      if (point > 65535) index++;
      continue;
    }
    index++;
    const octal = value.slice(index).match(/^[0-7]{1,3}/)?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8));
      index += octal.length - 1;
    } else if (escapes[value[index]] !== undefined)
      bytes.push(escapes[value[index]]);
    else throw new Error("Invalid Git escape");
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}
