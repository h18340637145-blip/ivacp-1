import https from "node:https";
import { recognizeImageText } from "@/server/ai/qwen";
import type { JiraAttachment } from "@/server/jira/types";
import { getJiraConnection } from "@/server/jira/connection";
import { CAN_SUFFIXES, MAX_DIFF_SECONDS, MIN_DIFF_SECONDS, ZIP_SUFFIXES } from "@/server/pipeline/constants";
import { attachmentDestination, downloadAttachment, getProxyUrl, makeAgent } from "@/server/pipeline/download";
import { PipelineLogger } from "@/server/pipeline/paths-logging";
import { ClassifiedAttachments } from "@/server/pipeline/types";

export async function fetchJiraIssueWithComments(issueKey: string, provider?: string): Promise<{
  description: string;
  comments: Array<{ author: string; body: string; created: string }>;
  attachments: JiraAttachment[];
}> {
  const connection = getJiraConnection(provider);
  if (connection.missing.length > 0) throw new Error(`Jira 环境变量未配置（${connection.missing.join(" / ")}）`);
  const url = `${connection.server}/rest/api/2/issue/${issueKey}?fields=description,comment,attachment`;
  const agent = makeAgent(getProxyUrl());

  const buf = await new Promise<Buffer>((resolve, reject) => {
    const opts = {
      headers: { Authorization: `Basic ${connection.basicAuth}`, Accept: "application/json" },
      agent, rejectUnauthorized: false,
    };
    https.get(url, opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject)
      .setTimeout(20_000, function (this: ReturnType<typeof https.get>) { this.destroy(new Error("Jira 超时")); });
  });

  const data = JSON.parse(buf.toString("utf-8")) as {
    fields?: {
      description?: string;
      comment?: { comments?: Array<{ author?: { displayName?: string; name?: string }; body?: string; created?: string }> };
      attachment?: Array<{
        id?: string; filename?: string; created?: string; size?: number;
        mimeType?: string; content?: string; author?: { name?: string; displayName?: string };
      }>;
    };
  };

  const fields = data.fields ?? {};
  return {
    description: fields.description ?? "",
    comments: (fields.comment?.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? c.author?.name ?? "—",
      body: c.body ?? "",
      created: c.created ?? "",
    })),
    attachments: (fields.attachment ?? []).map((a) => ({
      id: a.id ?? "",
      filename: a.filename ?? "",
      created: a.created ?? "",
      size: a.size ?? 0,
      mimeType: a.mimeType ?? "",
      contentUrl: a.content ?? "",
      authorName: a.author?.name ?? a.author?.displayName ?? "",
    })),
  };
}

/* ─── Build Jira comments text (mirrors get_jira_comments in Python) ─────── */

export function buildCommentsText(
  issueKey: string,
  summary: string,
  rawData: Record<string, unknown>,
  comments: Array<{ author: string; body: string; created: string }>,
  description: string
): string {
  const lines: string[] = [
    "<问题描述>",
    `问题键: ${issueKey}`,
    `摘要: ${summary}`,
    `状态: ${rawData.status ?? "—"}`,
    `优先级: ${rawData.priority ?? "—"}`,
    `类型: ${rawData.issueType ?? "—"}`,
    `经办人: ${rawData.assignee ?? "—"}`,
    "-".repeat(60),
  ];
  if (description) {
    lines.push("【问题描述】", description, "-".repeat(60));
  }
  if (!comments.length) {
    lines.push("这个问题没有任何评论。</问题描述>");
    return lines.join("\n");
  }
  for (const [i, c] of comments.entries()) {
    lines.push(`【评论 ${i + 1}】 ${c.author} (${c.created.slice(0, 10)})`, c.body, "");
  }
  lines.push("</问题描述>");
  return lines.join("\n");
}

/* ─── Attachment classification ──────────────────────────────────────────── */

export function isCanFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return CAN_SUFFIXES.some((s) => lower.endsWith(s));
}

export function isZipFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ZIP_SUFFIXES.some((s) => lower.endsWith(s));
}

export function latestByTime(atts: JiraAttachment[]): JiraAttachment | undefined {
  if (!atts.length) return undefined;
  return atts.reduce((a, b) =>
    new Date(a.created) >= new Date(b.created) ? a : b
  );
}

export function classifyAttachments(attachments: JiraAttachment[]): ClassifiedAttachments {
  if (!attachments.length) {
    return { mode: "no_attachments", reason: "工单无附件，使用评论内容进行分析" };
  }

  const canAtts = attachments.filter((a) => isCanFile(a.filename));
  const zipAtts = attachments.filter((a) => isZipFile(a.filename));

  const latestCan = latestByTime(canAtts);
  const latestZip = latestByTime(zipAtts);

  if (!latestCan && !latestZip) {
    return { mode: "no_attachments", reason: "附件中无 CAN trace 或日志包，使用评论内容进行分析" };
  }
  if (!latestZip) {
    return { mode: "can_only", latestCan, reason: "仅有 CAN trace，无日志包" };
  }
  if (!latestCan) {
    return { mode: "can_in_zip", latestZip, reason: "无独立 CAN trace，将从日志包中查找" };
  }

  const diff = (new Date(latestCan.created).getTime() - new Date(latestZip.created).getTime()) / 1000;

  if (diff > MAX_DIFF_SECONDS) {
    return { mode: "can_only", latestCan, reason: `CAN trace 比日志包晚 ${Math.round(diff / 60)}min，仅分析 CAN` };
  }
  if (Math.abs(diff) <= MIN_DIFF_SECONDS) {
    return { mode: "both", latestCan, latestZip, reason: `CAN 与日志包时间差 ${Math.round(Math.abs(diff) / 60)}min，联合分析` };
  }
  // ZIP is much newer than CAN
  return {
    mode: "reject",
    reason: `[没有最新 CAN Trace] 车控车设问题分析需要 CAN trace，请复测并提取问题发生时的 Android log、QNX log、CAN trace，依次从应用→Framework 再转给 VHAL 分析，谢谢`,
  };
}

export async function processImageAttachments(
  attachments: JiraAttachment[],
  attachRoot: string,
  currentUser: string,
  logger: PipelineLogger,
  meegleIdentity?: { projectKey: string; workItemId: string },
  stagedCommentAttachmentPaths?: Map<string, string>,
): Promise<string> {
  const imageAttachments = attachments.filter((att) => {
    const isImg = att.mimeType.toLowerCase().startsWith("image/");
    const hasImgExt = /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(att.filename);
    const isCurrentUser =
      currentUser && att.authorName &&
      att.authorName.toLowerCase() === currentUser.toLowerCase();
    return (isImg || hasImgExt) && !isCurrentUser;
  });

  if (imageAttachments.length === 0) {
    logger.log("DOWNLOADING", "未检测到符合条件的非当前用户上传的图片附件，跳过图片下载和 OCR 流程");
    return "";
  }

  const sortedImages = imageAttachments.sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  );

  const targetImages = sortedImages.slice(0, 2);
  logger.log("DOWNLOADING", `发现 ${imageAttachments.length} 张图片附件，选取最新 ${targetImages.length} 张非当前用户上传的图片进行识别`);

  let ocrResults = "";

  for (const img of targetImages) {
    const safeFilename = `img_${img.id || "meegle"}_${img.filename}`;
    const destPath = attachmentDestination(attachRoot, safeFilename);

    logger.log("DOWNLOADING", `正在下载图片附件: ${img.filename} (${img.size ? (img.size / 1024).toFixed(1) + " KB" : "大小未知"})`);
    try {
      await downloadAttachment(img, destPath, meegleIdentity, stagedCommentAttachmentPaths);
      logger.log("DOWNLOADING", `图片下载完成: ${destPath}`);

      const imageModel = process.env.IMAGE_MODEL ?? "Qwen3-VL-8B";
      logger.log("DOWNLOADING", `正在使用图像分析模型 ${imageModel} 对图片进行识别…`);
      
      const recognizedText = await recognizeImageText(destPath, img.mimeType || "image/png", { model: imageModel });
      logger.log("DOWNLOADING", `图片 ${img.filename} 识别成功，文本长度: ${recognizedText.length}`);

      ocrResults += `\n\n=== 图片附件 [${img.filename}] 识别文本内容 ===\n${recognizedText}\n=====================================\n`;
    } catch (err) {
      logger.log("DOWNLOADING", `处理图片 ${img.filename} 失败: ${String(err)}`);
    }
  }

  return ocrResults;
}

/* ─── File extraction & utilities ────────────────────────────────────────── */
