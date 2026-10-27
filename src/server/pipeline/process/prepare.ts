import fs from "node:fs/promises";
import path from "node:path";
import type { JiraAttachment } from "@/server/jira/types";
import { buildMeegleCommentAttachmentDownloadArgs, stageMeegleCommentAttachments, type MeegleCommentAttachmentDownloader } from "@/server/meegle/comment-attachments";
import { runCommandCapture } from "@/server/pipeline/download";
import { throwIfPipelineCancelled } from "./runtime";
import { MAX_COMMENTS_CHARS } from "@/server/pipeline/constants";
import { buildCommentsText, fetchJiraIssueWithComments } from "@/server/pipeline/jira-attachments";
import { estimatePromptTokens } from "@/server/pipeline/step5";
import type { ModelSignalConfigEntry } from "@/server/pipeline/types";
import { normalizeStringOrArray, type ProcessContext } from "@/server/pipeline/process/context";

export type IssueComment = { author: string; body: string; created: string };

export interface PreparedIssueData {
  liveComments: IssueComment[];
  liveAttachments: JiraAttachment[];
  description: string;
  commentsText: string;
}

export interface ModelConfigData {
  jsonContent: string;
  parsedConfigItems: ModelSignalConfigEntry[];
  protoContent: string;
}

/** Stage PREPARING：拉取工单评论/附件（飞书项目用预拉取数据；Jira 失败回退快照） */
export async function prepareIssueData(ctx: ProcessContext): Promise<PreparedIssueData> {
  const { issueKey, summary, rawData, logger, metrics, stages } = ctx;
  let liveComments: IssueComment[] = [];
  let liveAttachments: JiraAttachment[] = [];
  let description = "";

  if (ctx.isMeegle) {
    // Meegle source: data already passed via rawData from /api/meegle/analyze
    logger.log("PREPARING", "使用飞书项目数据（评论已预拉取）…");
    liveComments = (rawData.comments as IssueComment[]) ?? [];
    liveAttachments = (rawData.attachments as JiraAttachment[]) ?? [];
    description = (rawData.description as string) ?? "";
    logger.log("PREPARING", `飞书项目数据：${liveComments.length} 条评论，${liveAttachments.length} 个附件`);
  } else {
    logger.log("PREPARING", "正在从 Jira 拉取最新评论和附件…");
    try {
      const live = await fetchJiraIssueWithComments(issueKey, ctx.request.jiraProvider);
      liveComments = live.comments;
      liveAttachments = live.attachments;
      description = live.description;
      logger.log("PREPARING", `Jira 拉取成功：${liveComments.length} 条评论，${liveAttachments.length} 个附件`);
    } catch (e) {
      logger.log("PREPARING", `Jira 拉取失败，使用快照数据：${String(e).slice(0, 100)}`);
      liveComments = (rawData.comments as IssueComment[]) ?? [];
      liveAttachments = (rawData.attachments as JiraAttachment[]) ?? [];
      description = (rawData.description as string) ?? "";
    }
  }

  const commentsText = buildCommentsText(issueKey, summary, rawData, liveComments, description)
    .slice(0, MAX_COMMENTS_CHARS);
  stages.PREPARING = "配置解析完成";
  logger.log("PREPARING", `commentsText 长度: ${commentsText.length} 字符`);
  metrics.counts.comments = liveComments.length;
  metrics.counts.attachments = liveAttachments.length;
  metrics.promptStats.comments = {
    inputChars: commentsText.length,
    estimatedInputTokens: estimatePromptTokens(commentsText),
  };
  return { liveComments, liveAttachments, description, commentsText };
}

/** 读取车型对应的信号 JSON 配置（每个文件截取 20k）与 proto 文件 */
export async function loadModelConfig(ctx: ProcessContext): Promise<ModelConfigData> {
  const { basePaths, modelToFiles } = ctx.request;
  const { carModel, logger } = ctx;
  let jsonContent = "";
  let parsedConfigItems: ModelSignalConfigEntry[] = [];
  let protoContent = "";
  if (basePaths && modelToFiles && carModel) {
    const fileConfig = modelToFiles[carModel];
    if (fileConfig?.json) {
      const jsonFiles = normalizeStringOrArray(fileConfig.json);
      for (const jf of jsonFiles) {
        const fullPath = path.join(basePaths.json_dir, jf);
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          jsonContent += content.slice(0, 20_000) + "\n";
          const parsed = JSON.parse(content) as ModelSignalConfigEntry[];
          if (Array.isArray(parsed)) {
            parsedConfigItems = parsedConfigItems.concat(parsed);
          }
          logger.log("PREPARING", `已加载配置文件: ${jf}`);
        } catch { logger.log("PREPARING", `配置文件未找到: ${jf}`); }
      }
    }
    if (fileConfig?.proto) {
      const protoPath = path.join(basePaths.proto_dir, fileConfig.proto);
      try {
        protoContent = await fs.readFile(protoPath, "utf-8");
        logger.log("PREPARING", `已加载 proto 文件: ${fileConfig.proto}`);
      } catch {
        logger.log("PREPARING", `proto 文件未找到: ${fileConfig.proto}`);
      }
    }
  }
  return { jsonContent, parsedConfigItems, protoContent };
}

/** 飞书评论附件的临时暂存目录（流程结束后删除） */
export function commentStagingRoot(ctx: ProcessContext): string {
  return path.join(ctx.logRoot, ".meegle-comment-staging");
}

/** 飞书评论附件：补齐元数据并暂存，返回新的附件列表与暂存路径映射 */
export async function stageCommentAttachments(
  ctx: ProcessContext,
  liveAttachments: JiraAttachment[],
): Promise<{ attachments: JiraAttachment[]; stagedPaths: Map<string, string> }> {
  const { meegleIdentity, logger } = ctx;
  if (meegleIdentity && liveAttachments.some((attachment) => attachment.source === "meegle-comment")) {
    const download: MeegleCommentAttachmentDownloader = async (attachment, destination, identity) => {
      throwIfPipelineCancelled();
      const output = await runCommandCapture("meegle", [...buildMeegleCommentAttachmentDownloadArgs(attachment, identity, destination), "--format", "json"]);
      return JSON.parse(output) as Awaited<ReturnType<MeegleCommentAttachmentDownloader>>;
    };
    const staged = await stageMeegleCommentAttachments(liveAttachments, meegleIdentity, commentStagingRoot(ctx), download);
    throwIfPipelineCancelled();
    logger.log("PREPARING", `评论附件元数据补齐完成：${staged.stagedPaths.size} 个`);
    return { attachments: staged.attachments, stagedPaths: staged.stagedPaths };
  }
  return { attachments: liveAttachments, stagedPaths: new Map<string, string>() };
}
