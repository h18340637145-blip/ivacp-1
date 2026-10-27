import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { IssueAttachment } from "@/server/meegle/types";

const DEFAULT_API_BASE_URL = "https://mg-jira.auto-link.com.cn";

export interface MeeglePluginAttachmentContext {
  projectKey: string;
  workItemTypeKey: string;
  workItemId: string;
}

interface PluginAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  uploadedBy: string;
}

interface PluginAttachmentListResponse {
  ok?: boolean;
  data?: PluginAttachment[];
  error?: string;
}

function getApiBaseUrl(): string {
  return (process.env.MEEGLE_ATTACHMENT_PLUGIN_API_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

function buildContextQuery(context: MeeglePluginAttachmentContext): URLSearchParams {
  return new URLSearchParams({
    project_key: context.projectKey,
    work_item_type_key: context.workItemTypeKey,
    work_item_id: context.workItemId,
  });
}

function getProxyUrl(): string | undefined {
  return process.env.https_proxy
    || process.env.HTTPS_PROXY
    || process.env.http_proxy
    || process.env.HTTP_PROXY;
}

function requestPluginAttachmentList(url: string): Promise<PluginAttachmentListResponse> {
  return new Promise((resolve, reject) => {
    const proxyUrl = getProxyUrl();
    const agent = proxyUrl
      ? new HttpsProxyAgent(proxyUrl)
      : new https.Agent({ rejectUnauthorized: false });
    const request = https.get(url, {
      agent,
      headers: { Accept: "application/json" },
      rejectUnauthorized: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const statusCode = response.statusCode || 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`附件插件列表请求失败: HTTP ${statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as PluginAttachmentListResponse);
        } catch {
          reject(new Error("附件插件返回格式无效"));
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(30_000, () => request.destroy(new Error("附件插件列表请求超时")));
  });
}

export function buildPluginAttachmentDownloadUrl(
  context: MeeglePluginAttachmentContext,
  attachmentId: string,
): string {
  const query = buildContextQuery(context);
  query.set("download", "1");
  return `${getApiBaseUrl()}/api/files/download/${encodeURIComponent(attachmentId)}?${query}`;
}

export async function fetchMeeglePluginAttachments(
  context: MeeglePluginAttachmentContext,
  fetchImpl?: typeof fetch,
): Promise<IssueAttachment[]> {
  const url = `${getApiBaseUrl()}/api/files/list?${buildContextQuery(context)}`;
  let payload: PluginAttachmentListResponse;
  if (fetchImpl) {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`附件插件列表请求失败: HTTP ${response.status}`);
    }
    payload = await response.json() as PluginAttachmentListResponse;
  } else {
    payload = await requestPluginAttachmentList(url);
  }
  if (!payload.ok || !Array.isArray(payload.data)) {
    throw new Error(payload.error || "附件插件返回格式无效");
  }

  return payload.data
    .filter((attachment) => attachment.id && attachment.name)
    .map((attachment) => ({
      id: attachment.id,
      filename: attachment.name,
      size: Number(attachment.size) || 0,
      mimeType: attachment.type || "application/octet-stream",
      created: attachment.uploadedAt || "",
      authorName: attachment.uploadedBy || "",
      contentUrl: buildPluginAttachmentDownloadUrl(context, attachment.id),
    }));
}