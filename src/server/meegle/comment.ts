import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactRef } from "@/server/artifacts/analysis-artifacts";
import { listMeegleComments, runMeegleJson } from "@/server/meegle/cli";
import { meegleResultMarker } from "@/domain/meegle/lifecycle";

export interface UploadedImage {
  url: string;
  fileToken: string;
}

function findString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(key) && typeof child === "string" && child) return child;
    const nested = findString(child, keys);
    if (nested) return nested;
  }
  return undefined;
}

export function buildMeegleCommentContent(body: string, resultId: string, image?: UploadedImage): string {
  return [
    body.trim(),
    image ? `![CAN 信号时序图](${image.url})<!--${image.fileToken}-->` : "",
    meegleResultMarker(resultId),
  ].filter(Boolean).join("\n\n");
}

export async function findExistingMeegleResultComment(projectKey: string, workItemId: string, resultId: string) {
  const marker = meegleResultMarker(resultId);
  const comments = await listMeegleComments(projectKey, workItemId);
  return comments.find((comment) => comment.content.includes(marker));
}

export async function uploadMeegleCommentImage(sourcePath: string, projectKey: string, workItemId: string): Promise<UploadedImage> {
  const response = await runMeegleJson<unknown>([
    "attachment", "+upload", sourcePath,
    "--resource-type", "14",
    "--project-key", projectKey,
    "--work-item-id", workItemId,
  ], 120_000);
  const fileToken = findString(response, ["file_token", "fileToken", "token"]);
  const url = findString(response, ["url", "file_url", "fileUrl"]);
  if (!fileToken || !url) throw new Error("飞书图片上传响应缺少 url 或 file_token");
  return { fileToken, url };
}

export function buildMeegleCommentAddArgs(projectKey: string, workItemId: string, content: string, fileToken?: string): string[] {
  const normalizedContent = content.trim();
  if (!normalizedContent) throw new Error("飞书评论内容不能为空");

  return [
    "comment", "add",
    "--params", JSON.stringify({
      project_key: projectKey,
      work_item_id: workItemId,
      content: normalizedContent,
      ...(fileToken ? { file_token: fileToken } : {}),
    }),
  ];
}

export async function addMeegleComment(projectKey: string, workItemId: string, content: string, fileToken?: string) {
  const response = await runMeegleJson<unknown>(buildMeegleCommentAddArgs(projectKey, workItemId, content, fileToken));
  return { commentId: findString(response, ["comment_id", "commentId", "id"]) };
}

const commentLocks = new Map<string, Promise<unknown>>();

/** 同一工作项同一结果的回填串行执行，配合结果标记防止重复评论 */
async function withCommentLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = commentLocks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  commentLocks.set(key, current);
  try { return await current; }
  finally { if (commentLocks.get(key) === current) commentLocks.delete(key); }
}

/** 只允许上传属于该分析运行目录的 can_signals.png */
async function resolveChartPath(chartImagePath: string, artifactRef: string): Promise<string> {
  const { directory } = resolveArtifactRef(artifactRef);
  const prefix = "/api/charts/";
  if (!chartImagePath.startsWith(prefix)) throw new Error("时序图路径无效");
  const realDirectory = await fs.realpath(directory);
  const filePath = await fs.realpath(path.resolve(process.cwd(), decodeURIComponent(chartImagePath.slice(prefix.length))));
  const relative = path.relative(realDirectory, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || path.basename(filePath) !== "can_signals.png") {
    throw new Error("时序图不属于该分析结果");
  }
  if (!(await fs.stat(filePath)).isFile()) throw new Error("时序图不是文件");
  return filePath;
}

export interface MeegleBackfillResult {
  success: true;
  existing?: true;
  commentId?: string;
  image?: UploadedImage;
}

/** 把已复核的分析结论（可附时序图）回填为飞书评论；已存在带同一结果标记的评论时直接返回 */
export async function backfillMeegleComment(input: {
  projectKey: string;
  workItemId: string;
  resultId: string;
  body: string;
  chartImagePath?: string;
  artifactRef?: string;
}): Promise<MeegleBackfillResult> {
  const { projectKey, workItemId, resultId } = input;
  return withCommentLock(`${projectKey}:${workItemId}:${resultId}`, async () => {
    const existing = await findExistingMeegleResultComment(projectKey, workItemId, resultId);
    if (existing) return { success: true, existing: true, commentId: existing.comment_id };
    let image: UploadedImage | undefined;
    if (input.chartImagePath) {
      if (!input.artifactRef) throw new Error("回填时序图需要 artifactRef");
      image = await uploadMeegleCommentImage(await resolveChartPath(input.chartImagePath, input.artifactRef), projectKey, workItemId);
    }
    const content = buildMeegleCommentContent(input.body, resultId, image);
    const added = await addMeegleComment(projectKey, workItemId, content, image?.fileToken);
    return { success: true, commentId: added.commentId, image };
  });
}
