import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactRef } from "@/server/artifacts/analysis-artifacts";
import { badRequest, notFound } from "@/server/http/route";
import { meegleLogBase } from "@/server/meegle/config";

const MAX_ARTIFACT_BYTES = 512 * 1024;
/** 白名单：仅允许读取分析过程的日志与中间产物 */
const ARTIFACT_FILE_PATTERN = /^(?:effective-config-resolution\.json|effective-config-check\.md|soc-scc-version-check\.json|vhal-version-resolution\.json|vhal-signal-config-check\.json|version-vhal-check\.md|log-versions\.json|pipeline\.log|stages\.json|pipeline-metrics\.json|step[^/]*\.md|extract\.md|signals[^/]*\.json|evidence-[^/]*\.json|final_reply[^/]*\.md|can_signal_summary\.txt|can_trace_extracted_result\.txt)$/;

export type MeegleArtifactResult =
  | { files: string[] }
  | { file: string; content: string; truncated: boolean };

/** 列出（不传 fileName）或读取运行产物文件，单文件最多返回 512KB */
export async function readMeegleArtifacts(artifactRef: string, fileName?: string | null): Promise<MeegleArtifactResult> {
  if (fileName && !ARTIFACT_FILE_PATTERN.test(fileName)) throw badRequest("不允许读取该产物文件");
  try {
    const { directory } = resolveArtifactRef(artifactRef);
    const realLogRoot = await fs.realpath(meegleLogBase());
    const realDirectory = await fs.realpath(directory);
    const runRelative = path.relative(realLogRoot, realDirectory);
    if (!runRelative || runRelative.startsWith("..") || path.isAbsolute(runRelative)) throw new Error("运行目录超出日志根目录");
    if (!fileName) {
      const entries = await fs.readdir(realDirectory, { withFileTypes: true });
      return { files: entries.filter((entry) => entry.isFile() && ARTIFACT_FILE_PATTERN.test(entry.name)).map((entry) => entry.name).sort() };
    }
    const filePath = await fs.realpath(path.join(realDirectory, fileName));
    const relative = path.relative(realDirectory, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("产物文件超出运行目录");
    const content = await fs.readFile(filePath);
    return {
      file: fileName,
      content: content.subarray(0, MAX_ARTIFACT_BYTES).toString("utf8"),
      truncated: content.length > MAX_ARTIFACT_BYTES,
    };
  } catch (error) {
    throw notFound(error instanceof Error ? error.message : String(error));
  }
}
