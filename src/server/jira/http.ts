import http from "node:http";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";

/** 系统代理（https_proxy / HTTPS_PROXY / http_proxy / HTTP_PROXY） */
export function getProxyUrl(): string | undefined {
  return (
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY
  );
}

/** 有代理走代理；否则 HTTPS 关闭证书校验（内网自签名证书） */
export function makeAgent(proxyUrl?: string) {
  return proxyUrl
    ? new HttpsProxyAgent(proxyUrl)
    : new https.Agent({ rejectUnauthorized: false });
}

export interface JiraHttpOptions {
  method: "GET" | "POST" | "PUT";
  headers?: Record<string, string | number>;
  body?: Buffer | string;
  timeoutMs: number;
  timeoutMessage: string;
  /** 允许 http:// 服务地址（状态流转接口兼容内网 http Jira） */
  allowHttp?: boolean;
}

export interface JiraHttpResponse {
  statusCode: number;
  text: string;
}

/** 发送 Jira REST 请求并返回原始状态码与文本，不对状态码做判断 */
export function jiraHttpRequest(url: string, options: JiraHttpOptions): Promise<JiraHttpResponse> {
  const parsed = new URL(url);
  const isHttps = !options.allowHttp || parsed.protocol === "https:";
  const client = isHttps ? https : http;
  const proxyUrl = getProxyUrl();
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;
  const bodyBuf = options.body === undefined ? undefined : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body, "utf-8");

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: {
          ...options.headers,
          ...(bodyBuf ? { "Content-Length": bodyBuf.byteLength } : {}),
        },
        agent,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf-8") }));
      },
    );
    req.on("error", reject);
    req.setTimeout(options.timeoutMs, () => req.destroy(new Error(options.timeoutMessage)));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

export const isOk = (statusCode: number) => statusCode >= 200 && statusCode < 300;
