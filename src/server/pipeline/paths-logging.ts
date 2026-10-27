import fs from "node:fs/promises";
import path from "node:path";
import { assertSafeRunId } from "@/server/artifacts/analysis-artifacts";

/** Root for permanent attachment storage: PROJECT/jira-issues/{group}/{model}/{key}/ */
export const ISSUES_BASE = path.join(process.cwd(), "jira-issues");

/** Root for per-step analysis logs:       PROJECT/log/{group}/{model}/{key}/ */
export const LOG_BASE    = path.join(process.cwd(), "log");

/** Strip characters that are unsafe in directory/file names */
export function sanitizeName(s: string): string {
  const safe = s.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
  return !safe || safe === "." || safe === ".." ? "_" : safe;
}

export function issueAttachDir(ruleGroupId: string, carModel: string, issueKey: string): string {
  return path.join(ISSUES_BASE, sanitizeName(ruleGroupId), sanitizeName(carModel || "unknown"), sanitizeName(issueKey));
}

export function issueLogDir(ruleGroupId: string, carModel: string, issueKey: string, runId?: string): string {
  const issueDir = path.join(LOG_BASE, sanitizeName(ruleGroupId), sanitizeName(carModel || "unknown"), sanitizeName(issueKey));
  return runId ? path.join(issueDir, assertSafeRunId(runId)) : issueDir;
}

/* ─── Pipeline logger ────────────────────────────────────────────────────── */

export interface PipelineLogger {
  log: (stage: string, msg: string) => void;
  flush: (logDir: string) => Promise<void>;
}

export function createPipelineLogger(issueKey: string): PipelineLogger {
  const lines: string[] = [];

  const log = (stage: string, msg: string): void => {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = `[${ts}] [${issueKey}] [${stage}] ${msg}`;
    console.log(line);
    lines.push(line);
  };

  const flush = async (logDir: string): Promise<void> => {
    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(path.join(logDir, "pipeline.log"), lines.join("\n") + "\n", "utf-8");
    } catch { /* non-fatal */ }
  };

  return { log, flush };
}

/** Persist an AI step result to the log directory (non-fatal on error). */
export async function saveStepLog(logDir: string, filename: string, content: string): Promise<void> {
  try {
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(path.join(logDir, filename), content, "utf-8");
  } catch (e) {
    console.warn(`[saveStepLog] 写入失败 ${filename}: ${String(e).slice(0, 80)}`);
  }
}
