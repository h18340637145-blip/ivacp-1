import { z } from "zod";
import { HttpError } from "@/server/http/route";

/** 规则组字段由 store.normalizeInput 统一校验，路由只要求请求体是 JSON 对象 */
export const RuleGroupBodySchema = z.record(z.string(), z.unknown());

/** 旧版规则组写接口把校验/业务错误统一返回 400 */
export function rethrowAsBadRequest(error: unknown, fallback: string): never {
  if (error instanceof HttpError) throw error;
  throw new HttpError(400, error instanceof Error ? error.message : fallback);
}
