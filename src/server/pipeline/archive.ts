import { trackPipelineChild, throwIfPipelineCancelled } from "./process/runtime";
import { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ARCHIVE_SUFFIXES } from "@/server/pipeline/constants";
import { PipelineLogger, sanitizeName } from "@/server/pipeline/paths-logging";

export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  // Use spawn instead of exec to avoid shell interpolation issues with special chars in paths
  throwIfPipelineCancelled();
  const args = ["e", "-y", `-o${destDir}`, archivePath];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("7za", args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    trackPipelineChild(child);
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0 || code === 1) resolve(); // code 1 = warning (partial success)
      else reject(new Error(`7za exited with code ${code}: ${stderr.slice(0, 200)}`));
    });
    child.on("error", reject);
  });
}

export function isArchiveFile(p: string): boolean {
  const lower = p.toLowerCase();
  return ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function nestedArchiveDir(archivePath: string): string {
  return path.join(path.dirname(archivePath), `${sanitizeName(path.basename(archivePath))}__extracted`);
}

export async function expandNestedArchives(rootDir: string, logger: PipelineLogger): Promise<void> {
  const queue = await findFiles(rootDir, isArchiveFile);
  const seen = new Set<string>();

  while (queue.length > 0) {
    throwIfPipelineCancelled();
    const archivePath = queue.shift()!;
    const normalized = archivePath.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const destDir = nestedArchiveDir(archivePath);
    await fs.mkdir(destDir, { recursive: true });
    logger.log("UNPACKING", `递归解压: ${path.relative(rootDir, archivePath)} -> ${path.relative(rootDir, destDir)}`);

    try {
      await extractArchive(archivePath, destDir);
    } catch (e) {
      logger.log("UNPACKING", `递归解压失败: ${path.basename(archivePath)} - ${String(e).slice(0, 100)}`);
      continue;
    }

    const nestedArchives = await findFiles(destDir, isArchiveFile);
    for (const nested of nestedArchives) {
      if (!seen.has(nested.toLowerCase())) {
        queue.push(nested);
      }
    }
  }
}

/** Recursively find files matching suffix predicates */
export async function findFiles(dir: string, predicate: (name: string) => boolean): Promise<string[]> {
  const results: string[] = [];
  let entries: Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await findFiles(full, predicate));
    } else if (e.isFile() && predicate(e.name.toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}
