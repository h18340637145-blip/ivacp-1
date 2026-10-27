import fs from "node:fs/promises";
import path from "node:path";
import type { JiraAttachment } from "@/server/jira/types";
import { expandNestedArchives, extractArchive, findFiles } from "@/server/pipeline/archive";
import { attachmentDestination, downloadAttachment } from "@/server/pipeline/download";
import { isCanFile } from "@/server/pipeline/jira-attachments";
import { isAndroidLog, isQnxLog } from "@/server/pipeline/log-extract";
import { recordMetricStage } from "@/server/pipeline/metrics";
import type { ClassifiedAttachments } from "@/server/pipeline/types";
import type { ProcessContext } from "@/server/pipeline/process/context";

export interface DownloadedAttachments {
  canTracePath: string;
  /** 日志包解压目录（永久保存在附件目录下） */
  extractDir: string;
}

/** Stage DOWNLOADING + UNPACKING：下载 CAN trace 与日志包（含分卷），解压并展开嵌套压缩包 */
export async function downloadAndExtractAttachments(
  ctx: ProcessContext,
  classified: ClassifiedAttachments,
  liveAttachments: JiraAttachment[],
  stagedCommentAttachmentPaths: Map<string, string>,
): Promise<DownloadedAttachments> {
  const { attachRoot, logger, metrics, stages, meegleIdentity } = ctx;
  const extractDir = path.join(attachRoot, "extracted");
  let canTracePath = "";
  const downloadingStarted = Date.now();

  // Download CAN trace
  if (classified.latestCan) {
    const canFile = attachmentDestination(attachRoot, classified.latestCan.filename);
    logger.log("DOWNLOADING", `正在下载 CAN trace: ${classified.latestCan.filename} (${(classified.latestCan.size / 1024).toFixed(1)} KB)`);
    await downloadAttachment(classified.latestCan, canFile, meegleIdentity, stagedCommentAttachmentPaths);
    canTracePath = canFile;
    stages.DOWNLOADING = `已下载 CAN trace: ${classified.latestCan.filename}`;
    logger.log("DOWNLOADING", `CAN trace 已保存至: ${canFile}`);
  }

  // Download ZIP and extract
  if (classified.latestZip && (classified.mode === "both" || classified.mode === "can_in_zip")) {
    const latestZip = classified.latestZip;
    const zipFile = attachmentDestination(attachRoot, latestZip.filename);
    logger.log("DOWNLOADING", `正在下载日志包: ${latestZip.filename} (${(latestZip.size / 1024).toFixed(1)} KB)`);
    await downloadAttachment(latestZip, zipFile, meegleIdentity, stagedCommentAttachmentPaths);
    logger.log("DOWNLOADING", `日志包已保存至: ${zipFile}`);

    // Handle split archives (.7z.001, .zip.001, etc.) — download all sibling parts
    const splitMatch = latestZip.filename.match(/^(.+\.\w+)\.(\d+)$/);
    let extractTarget = zipFile;
    if (splitMatch) {
      const baseName = splitMatch[1]; // e.g. "chery_export_xxx.7z"
      const siblingParts = liveAttachments.filter((a) => {
        if (a.filename === latestZip.filename) return false;
        return a.filename.startsWith(baseName + ".") && /\.\d+$/.test(a.filename);
      });
      if (siblingParts.length > 0) {
        logger.log("DOWNLOADING", `检测到分卷压缩包，共 ${siblingParts.length + 1} 个分卷，正在下载剩余分卷…`);
        for (const part of siblingParts) {
          const partFile = attachmentDestination(attachRoot, part.filename);
          logger.log("DOWNLOADING", `正在下载分卷: ${part.filename} (${(part.size / 1024).toFixed(1)} KB)`);
          await downloadAttachment(part, partFile, meegleIdentity, stagedCommentAttachmentPaths);
        }
        logger.log("DOWNLOADING", `所有分卷下载完成`);
      }
      // Always extract from .001 (7za requires starting from the first part)
      extractTarget = attachmentDestination(attachRoot, `${baseName}.001`);
    }
    recordMetricStage(metrics, "DOWNLOADING", downloadingStarted);

    await fs.mkdir(extractDir, { recursive: true });
    stages.UNPACKING = `正在解压: ${path.basename(extractTarget)}`;
    logger.log("UNPACKING", `正在解压: ${path.basename(extractTarget)}`);
    const unpackingStarted = Date.now();

    try {
      await extractArchive(extractTarget, extractDir);
      await expandNestedArchives(extractDir, logger);
      logger.log("UNPACKING", `解压完成，目录: ${extractDir}`);
    } catch (e) {
      stages.UNPACKING = `解压失败: ${String(e).slice(0, 100)}`;
      logger.log("UNPACKING", `解压失败: ${String(e).slice(0, 100)}`);
    }

    const allFiles = await findFiles(extractDir, () => true);
    const androidFiles = allFiles.filter(isAndroidLog);
    const qnxFiles    = allFiles.filter(isQnxLog);
    logger.log("UNPACKING", `共找到 ${allFiles.length} 个文件，Android: ${androidFiles.length}，QNX: ${qnxFiles.length}`);
    recordMetricStage(metrics, "UNPACKING", unpackingStarted);

    // Find CAN trace inside ZIP if needed
    if (classified.mode === "can_in_zip" && !canTracePath) {
      const canInZip = allFiles.find((f) => isCanFile(f));
      if (canInZip) {
        canTracePath = canInZip;
        logger.log("UNPACKING", `在压缩包中找到 CAN trace: ${path.basename(canInZip)}`);
      }
    }

    stages.UNPACKING = `解压完成，Android: ${androidFiles.length} 文件，QNX: ${qnxFiles.length} 文件`;
  } else {
    recordMetricStage(metrics, "DOWNLOADING", downloadingStarted);
  }

  return { canTracePath, extractDir };
}
