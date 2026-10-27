import fs from "node:fs/promises";
import path from "node:path";
import { assertSafeRunId } from "@/server/artifacts/analysis-artifacts";
import { readSavedProcessResponse } from "./saved-response";

export interface MeegleRunLookup {
  runId: string;
  issueKey: string;
  ruleGroupName: string;
}

interface PipelineMetrics {
  status?: string;
  issueKey?: string;
  responseArtifactVersion?: number;
}

export interface MeegleCancellation {
  runId: string;
  issueKey: string;
  stoppedAt: string;
  active: boolean;
}

export function sanitizeMeegleRunArtifactName(value: string): string {
  return value.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
}

export function isSafeMeegleRunIdentity(value: string): boolean {
  return Boolean(value) && value.length <= 120 && value !== "." && value !== ".." && !/[\\/:*?"<>|]/.test(value);
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveContained(parent: string, segment: string): string {
  const child = path.resolve(parent, segment);
  if (!contains(parent, child)) throw new Error("Meegle run artifact path escapes its parent directory");
  return child;
}

function safeLookup(lookup: MeegleRunLookup) {
  const runId = assertSafeRunId(lookup.runId);
  const groupDir = sanitizeMeegleRunArtifactName(lookup.ruleGroupName);
  const issueDir = sanitizeMeegleRunArtifactName(lookup.issueKey);
  if (!isSafeMeegleRunIdentity(groupDir) || !isSafeMeegleRunIdentity(issueDir)) {
    throw new Error("Invalid Meegle run artifact identity");
  }
  return { runId, groupDir, issueDir };
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function locateMeegleRunDirectory(logBase: string, lookup: MeegleRunLookup): Promise<string | undefined> {
  const { runId, groupDir, issueDir } = safeLookup(lookup);
  const root = path.resolve(logBase);
  const groupRoot = resolveContained(root, groupDir);

  let models: import("node:fs").Dirent[];
  try {
    models = await fs.readdir(groupRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  for (const model of models) {
    if (!model.isDirectory() || !isSafeMeegleRunIdentity(model.name)) continue;
    const modelRoot = resolveContained(groupRoot, model.name);
    const issueRoot = resolveContained(modelRoot, issueDir);
    const runDirectory = resolveContained(issueRoot, runId);
    if (await isDirectory(runDirectory)) return runDirectory;
  }
  return undefined;
}

export async function hasCompleteMeegleSuccess(runDirectory: string, issueKey: string): Promise<boolean> {
  try {
    const [metrics, replyText] = await Promise.all([
      fs.readFile(path.join(runDirectory, "pipeline-metrics.json"), "utf8").then((text) => JSON.parse(text) as PipelineMetrics),
      fs.readFile(path.join(runDirectory, "final_reply.md"), "utf8"),
    ]);
    if (metrics.status !== "success" || metrics.issueKey !== issueKey || !replyText.trim()) return false;
    if (metrics.responseArtifactVersion === 1) {
      const [response, stages] = await Promise.all([
        readSavedProcessResponse(runDirectory, issueKey, replyText),
        fs.readFile(path.join(runDirectory, "stages.json"), "utf8").then((text) => JSON.parse(text) as { issueKey?: string; stages?: unknown }),
      ]);
      return Boolean(response && stages.stages && typeof stages.stages === "object" && (!stages.issueKey || stages.issueKey === issueKey));
    }
    // 旧系统已成功的运行不能因为没有新版响应文件而被允许取消。
    return metrics.responseArtifactVersion === undefined;
  } catch {
    return false;
  }
}

function cancellationPath(runDirectory: string): string {
  const filePath = path.resolve(runDirectory, "cancelled.json");
  if (!contains(runDirectory, filePath)) throw new Error("Meegle cancellation path escapes run directory");
  return filePath;
}

export async function readMeegleCancellation(runDirectory: string): Promise<MeegleCancellation | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(cancellationPath(runDirectory), "utf8")) as Partial<MeegleCancellation>;
    if (typeof parsed.runId !== "string" || typeof parsed.issueKey !== "string" || typeof parsed.stoppedAt !== "string" || typeof parsed.active !== "boolean") {
      return undefined;
    }
    return parsed as MeegleCancellation;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

export async function writeMeegleCancellation(runDirectory: string, cancellation: MeegleCancellation): Promise<void> {
  const existing = await readMeegleCancellation(runDirectory);
  if (existing) return;
  try {
    await fs.writeFile(cancellationPath(runDirectory), `${JSON.stringify(cancellation, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
