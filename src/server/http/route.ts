import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { hasRole, type AuthRole, type AuthSession } from "@/domain/auth/permissions";
import { readSessionFromRequest } from "@/server/auth/session";

/**
 * API 路由统一约定：
 * - 业务代码抛出 HttpError(status, 中文消息)，由 route() 转成 `{ error }` JSON。
 * - 其他异常按 500 返回，消息取 error.message。
 * - 入参用 zod 校验：await parseJson(request, schema)。
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, extra?: Record<string, unknown>) => new HttpError(400, message, extra);
export const notFound = (message = "资源不存在") => new HttpError(404, message);

export function errorResponse(error: unknown, fallback = "服务器内部错误"): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status });
  }
  const message = error instanceof Error && error.message ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

type RouteContext<P> = { params: Promise<P> };
type Handler<P> = (request: NextRequest, context: RouteContext<P>) => Promise<Response> | Response;

/** 包装路由处理器，统一错误格式 */
export function route<P = Record<string, string>>(handler: Handler<P>, fallbackError?: string): Handler<P> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(`[api] ${request.method} ${request.nextUrl.pathname}`, error);
      return errorResponse(error, fallbackError);
    }
  };
}

export async function parseJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("请求体不是有效的 JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    throw badRequest(field ? `参数 ${field} 无效：${issue.message}` : (issue?.message ?? "参数无效"));
  }
  return parsed.data;
}

export function parseQuery<S extends z.ZodType>(request: NextRequest, schema: S): z.infer<S> {
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(`查询参数 ${issue?.path.join(".") ?? ""} 无效：${issue?.message ?? ""}`);
  }
  return parsed.data;
}

/** 读取当前登录会话（proxy 已拦截未登录请求，这里再次校验以获取用户信息） */
export function requireSession(request: Request, role: AuthRole = "analyst"): AuthSession {
  const session = readSessionFromRequest(request);
  if (!session) throw new HttpError(401, "未登录或登录已过期");
  if (!hasRole(session, role)) throw new HttpError(403, "当前角色无权执行该操作");
  return session;
}

export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}
