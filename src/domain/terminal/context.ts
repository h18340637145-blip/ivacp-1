import type { TerminalProjectContext } from "./types";

/** 同路径分支也可能属于不同项目/工作目录；响应必须关联完整上下文。 */
export function terminalContextKey(context: TerminalProjectContext): string {
  return JSON.stringify([context.project.projectName, context.project.mainPath, context.project.scriptPath,
    context.branch.name, context.branch.repos.map(repo => [repo.repoName, repo.repoPath, repo.branchName])]);
}
