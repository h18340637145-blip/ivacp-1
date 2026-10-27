import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";

export interface FeishuProcessResultRequest {
  source?: "jira" | "meegle";
  ruleGroupName: string;
  issueKey: string;
  issueUrl?: string;
  issueSummary: string;
  issueDescription?: string;
  status: "success" | "failed";
  replyText?: string;
  failureReason?: string;
  chartImagePath?: string;
  origin?: string;
  processedAt?: string;
}

interface FeishuWebhookResponse {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
}

const MAX_SUMMARY_CHARS = 500;
const MAX_DESCRIPTION_CHARS = 1_500;
const MAX_RESULT_CHARS = 4_000;
const MAX_FAILURE_CHARS = 1_500;

function getProxyUrl(): string | undefined {
  return (
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY
  );
}

function truncate(value: string | undefined, max: number): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}\n...(已截断)`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function resolveChartImageUrl(origin: string | undefined, chartImagePath: string | undefined): string {
  const base = (origin ?? "").trim();
  const relative = (chartImagePath ?? "").trim();
  if (!base || !relative.startsWith("/")) return "";
  try {
    const url = new URL(relative, base);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeIssueUrl(value: string | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function buildProcessResultCard(payload: FeishuProcessResultRequest) {
  const summary = truncate(payload.issueSummary, MAX_SUMMARY_CHARS);
  const description = truncate(payload.issueDescription, MAX_DESCRIPTION_CHARS);
  const replyText = truncate(payload.replyText, MAX_RESULT_CHARS);
  const failureReason = truncate(payload.failureReason, MAX_FAILURE_CHARS);
  const processedAt = payload.processedAt
    ? new Date(payload.processedAt).toLocaleString("zh-CN")
    : new Date().toLocaleString("zh-CN");
  const chartImageUrl = resolveChartImageUrl(payload.origin, payload.chartImagePath);
  const headerColor = payload.status === "success" ? "green" : "red";
  const statusText = payload.status === "success" ? "处理成功" : "处理失败";
  const sourceTitle = payload.source === "meegle" ? "飞书项目处理通知" : "Jira 处理通知";

  const fields = [
    `**规则组**：${escapeMarkdown(payload.ruleGroupName)}`,
    `**票号**：${escapeMarkdown(payload.issueKey)}`,
    `**结果**：${statusText}`,
    `**时间**：${processedAt}`,
  ];

  if (summary) {
    fields.push(`**主题**：${escapeMarkdown(summary)}`);
  }
  if (description) {
    fields.push(`**描述**：\n${escapeMarkdown(description)}`);
  }
  if (replyText) {
    fields.push(`**处理结果**：\n${escapeMarkdown(replyText)}`);
  }
  if (failureReason) {
    fields.push(`**失败原因**：\n${escapeMarkdown(failureReason)}`);
  }
  if (chartImageUrl) {
    fields.push(`**结果图片**：[打开图片](${chartImageUrl})`);
  } else if (payload.chartImagePath) {
    fields.push("**结果图片**：当前为 webhook-only 模式，无法直接上传本地图片到飞书");
  }
  const issueUrl = normalizeIssueUrl(payload.issueUrl);
  if (issueUrl) {
    fields.push(`**原票链接**：[${issueUrl}](${issueUrl})`);
  }

  return {
    msg_type: "interactive",
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: headerColor,
        title: {
          tag: "plain_text",
          content: `${sourceTitle} · ${statusText}`,
        },
      },
      elements: [
        {
          tag: "markdown",
          content: fields.join("\n\n"),
        },
        ...(chartImageUrl
          ? [{
              tag: "action",
              actions: [
                {
                  tag: "button",
                  text: {
                    tag: "plain_text",
                    content: "查看结果图片",
                  },
                  type: "default",
                  url: chartImageUrl,
                },
              ],
            }]
          : []),
      ],
    },
  };
}

async function postWebhook(webhookUrl: string, body: unknown): Promise<void> {
  const proxyUrl = getProxyUrl();
  const agent = proxyUrl
    ? new HttpsProxyAgent(proxyUrl)
    : new https.Agent({ rejectUnauthorized: false });

  const payload = JSON.stringify(body);
  const payloadBuf = Buffer.from(payload, "utf-8");
  const parsed = new URL(webhookUrl);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payloadBuf.byteLength,
        },
        agent,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          const statusCode = res.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Feishu webhook 返回 HTTP ${statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          let data: FeishuWebhookResponse;
          try { data = JSON.parse(text) as FeishuWebhookResponse; }
          catch { reject(new Error("Feishu webhook 返回格式异常")); return; }
          {
            if ((data.code ?? data.StatusCode ?? 0) !== 0) {
              reject(new Error(`Feishu webhook 返回 code=${data.code ?? data.StatusCode}: ${data.msg ?? data.StatusMessage ?? "unknown"}`));
              return;
            }
          }
          resolve();
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("Feishu webhook 请求超时（20s）")));
    req.write(payloadBuf);
    req.end();
  });
}


export async function notifyProcessResult(payload: FeishuProcessResultRequest): Promise<{ success: true }> {
  const webhook = process.env.NEXT_PUBLIC_FEISHU_WEBHOOK_URL?.trim();
  if (!webhook) throw new Error("NEXT_PUBLIC_FEISHU_WEBHOOK_URL 未配置");
  await postWebhook(webhook, buildProcessResultCard(payload));
  return { success: true };
}
