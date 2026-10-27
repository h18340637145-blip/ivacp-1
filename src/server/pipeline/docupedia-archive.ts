import { after } from "next/server";
import type { DocupediaArchiveProgressEvent } from "@/server/docupedia/client";
import { archiveIssueLogToDocupedia } from "@/server/docupedia/client";
import { PipelineLogger } from "@/server/pipeline/paths-logging";

export function formatDocupediaArchiveProgress(event: DocupediaArchiveProgressEvent): string {
  if (event.kind === "archive_started") {
    return `Docupedia 后台归档开始：待上传文章=${event.pageTotal}`;
  }

  const progress = `${event.pageIndex ?? 0}/${event.pageTotal}`;
  if (event.kind === "page_completed") {
    const action = event.action === "created" ? "已创建" : "已存在";
    return `Docupedia 日志上传进度：${progress} ${action} ${event.title ?? "unknown"}`;
  }

  return `Docupedia 日志上传失败：${progress} ${event.title ?? "unknown"} error=${event.error ?? "unknown"}`;
}

export async function archiveSuccessToDocupedia(args: {
  issueKey: string;
  summary: string;
  ruleGroupName: string;
  carModel: string;
  logRoot: string;
  logger: PipelineLogger;
}): Promise<void> {
  try {
    const result = await archiveIssueLogToDocupedia({
      issueKey: args.issueKey,
      summary: args.summary,
      ruleGroupName: args.ruleGroupName,
      carModel: args.carModel,
      logRoot: args.logRoot,
      onProgress: async (event) => {
        args.logger.log("DOCUPEDIA", formatDocupediaArchiveProgress(event));
        await args.logger.flush(args.logRoot);
      },
    });
    if (!result.enabled) {
      args.logger.log("DOCUPEDIA", "Docupedia 上传已跳过：ENABLE_DOCUPEDIA=0");
      return;
    }
    args.logger.log(
      "DOCUPEDIA",
      `当前票日志上传完成：created=${result.created} existing=${result.existing} skipped=${result.skipped} failed=${result.failed} page=${result.rootPageUrl || result.rootPageId || "unknown"}`,
    );
  } catch (error) {
    args.logger.log("DOCUPEDIA", `当前票日志上传失败，分析结果不受影响：${String(error).slice(0, 200)}`);
  }
}

export function scheduleSuccessArchiveToDocupedia(args: {
  issueKey: string;
  summary: string;
  ruleGroupName: string;
  carModel: string;
  logRoot: string;
  logger: PipelineLogger;
}): void {
  after(async () => {
    try {
      await archiveSuccessToDocupedia({
        issueKey: args.issueKey,
        summary: args.summary,
        ruleGroupName: args.ruleGroupName,
        carModel: args.carModel,
        logRoot: args.logRoot,
        logger: args.logger,
      });
    } finally {
      try {
        await args.logger.flush(args.logRoot);
      } catch (error) {
        console.warn(`[DOCUPEDIA] 延后归档日志写入失败：${String(error).slice(0, 200)}`);
      }
    }
  });
}
