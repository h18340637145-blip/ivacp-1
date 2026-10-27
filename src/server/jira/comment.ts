import fs from "node:fs/promises";
import path from "node:path";
import type { JiraConnection } from "@/server/jira/connection";
import { isOk, jiraHttpRequest } from "@/server/jira/http";

/** POST /rest/api/2/issue/{issueKey}/comment */
export async function addJiraComment(connection: JiraConnection, issueKey: string, commentBody: string): Promise<{ id: string }> {
  const { statusCode, text } = await jiraHttpRequest(`${connection.server}/rest/api/2/issue/${issueKey}/comment`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${connection.basicAuth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ body: commentBody }),
    timeoutMs: 30_000,
    timeoutMessage: "Jira comment 请求超时（30s）",
  });
  if (!isOk(statusCode)) throw new Error(`Jira comment API 返回 HTTP ${statusCode}: ${text.slice(0, 200)}`);
  try {
    const data = JSON.parse(text) as { id?: string };
    return { id: data.id ?? "" };
  } catch {
    return { id: "" };
  }
}

/** POST /rest/api/2/issue/{issueKey}/attachments，返回 Jira 中保存的附件文件名 */
export async function uploadJiraAttachment(
  connection: JiraConnection,
  issueKey: string,
  filePath: string,
  filename: string,
): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const boundary = `----FormBoundary${Date.now().toString(36)}`;
  const CRLF = "\r\n";
  const header = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: image/png`,
    "",
    "",
  ].join(CRLF);
  const footer = `${CRLF}--${boundary}--${CRLF}`;
  const body = Buffer.concat([Buffer.from(header, "utf-8"), fileBuffer, Buffer.from(footer, "utf-8")]);

  const { statusCode, text } = await jiraHttpRequest(`${connection.server}/rest/api/2/issue/${issueKey}/attachments`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${connection.basicAuth}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "X-Atlassian-Token": "no-check",
      Accept: "application/json",
    },
    body,
    timeoutMs: 60_000,
    timeoutMessage: "Jira attachment 上传超时（60s）",
  });
  if (!isOk(statusCode)) throw new Error(`Jira attachment API 返回 HTTP ${statusCode}: ${text.slice(0, 200)}`);
  try {
    const data = JSON.parse(text) as Array<{ filename?: string }>;
    return data[0]?.filename ?? filename;
  } catch {
    return filename;
  }
}

/** 把 "/api/charts/log/.../can_signals.png" 解析为 log/ 目录下的真实文件路径；不安全路径返回 null */
export function resolveChartImageFile(chartImagePath: string): string | null {
  const prefix = "/api/charts/";
  if (!chartImagePath.startsWith(prefix)) return null;
  const relativePath = chartImagePath.slice(prefix.length);
  if (relativePath.includes("..") || !relativePath.endsWith(".png")) return null;
  const fullPath = path.join(process.cwd(), relativePath);
  if (!fullPath.startsWith(path.join(process.cwd(), "log"))) return null;
  return fullPath;
}

/** 回填评论：如有 CAN 信号图先上传为附件（失败仅回填文字），再追加 !文件名! 引用 */
export async function postJiraCommentWithChart(input: {
  connection: JiraConnection;
  issueKey: string;
  body: string;
  chartImagePath?: string;
}): Promise<{ commentId: string }> {
  const { connection, issueKey, body, chartImagePath } = input;
  let attachedFilename = "";
  if (chartImagePath) {
    const filePath = resolveChartImageFile(chartImagePath);
    if (filePath) {
      try {
        await fs.access(filePath);
        const filename = `can_signals_${issueKey.replace(/[^a-zA-Z0-9-]/g, "_")}.png`;
        console.log(`[Jira Comment] 正在上传 CAN 信号图到 ${issueKey}...`);
        attachedFilename = await uploadJiraAttachment(connection, issueKey, filePath, filename);
        console.log(`[Jira Comment] 图片上传成功: ${attachedFilename}`);
      } catch (imgErr) {
        console.warn(`[Jira Comment] 图片上传失败（将仅回填文字）: ${String(imgErr).slice(0, 100)}`);
      }
    }
  }

  const finalBody = attachedFilename ? `${body}\n\n!${attachedFilename}!` : body;
  console.log(`[Jira Comment] 正在回填评论到 ${issueKey}，内容长度: ${finalBody.length} 字符`);
  const result = await addJiraComment(connection, issueKey, finalBody);
  console.log(`[Jira Comment] 回填成功：${issueKey}，commentId=${result.id}`);
  return { commentId: result.id };
}
