/**
 * 客户端统一请求封装：JSON 请求体、统一错误信息（服务端返回 { error } 时使用其中文提示）。
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  /** 自动 JSON 序列化并设置 Content-Type */
  json?: unknown;
  body?: BodyInit | null;
}

export async function apiFetch<T = unknown>(url: string, init: ApiFetchInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const message =
      (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : undefined) ?? `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}
