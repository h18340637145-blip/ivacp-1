import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface EvalTicketDir { runDir: string; ticketDir: string }
async function subdirs(dir: string) {
  try { return (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(dir, entry.name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function completedReply(dir: string): Promise<number | null> {
  try {
    const reply = await stat(path.join(dir, "final_reply.md"));
    if (!reply.isFile()) return null;
    let completedAt = reply.mtimeMs;
    try {
      const metrics = JSON.parse(await readFile(path.join(dir, "pipeline-metrics.json"), "utf8"));
      if (metrics.status !== "success") return null;
      const timestamp = typeof metrics.completedAt === "string" ? Date.parse(metrics.completedAt) : NaN;
      if (Number.isFinite(timestamp)) completedAt = timestamp;
      // 新运行使用最终成功指标为提交标记，不能评测取消后残留的半成品。
      if (metrics.responseArtifactVersion === 1) await stat(path.join(dir, "process-response.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // 旧日志没有metrics时仍兼容；新指标声明完整响应但文件缺失时不接受。
      const metricsFile = await stat(path.join(dir, "pipeline-metrics.json")).catch(() => null);
      if (metricsFile) return null;
    }
    return completedAt;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Jira/飞书共用：兼容旧票目录与新run目录，同票取最新完整成功运行。 */
export async function collectEvalTicketDirs(logRoot: string): Promise<EvalTicketDir[]> {
  const result: EvalTicketDir[] = [];
  for (const group of await subdirs(logRoot)) for (const model of await subdirs(group)) for (const ticketDir of await subdirs(model)) {
    const candidates = await Promise.all([ticketDir, ...await subdirs(ticketDir)].map(async runDir => ({ runDir, time: await completedReply(runDir) })));
    const latest = candidates.filter((item): item is { runDir: string; time: number } => item.time !== null)
      .sort((a, b) => b.time - a.time || b.runDir.localeCompare(a.runDir))[0];
    if (latest) result.push({ ticketDir, runDir: latest.runDir });
  }
  return result.sort((a, b) => a.ticketDir.localeCompare(b.ticketDir));
}
