import { z } from "zod";
import { json, parseJson, requireSession, route } from "@/server/http/route";
import { cancelMeegleRun } from "@/server/meegle/cancel";

export const runtime = "nodejs";

/** 身份字段在服务层逐项校验（不合法统一返回 400） */
const schema = z.record(z.string(), z.unknown());

/** 停止进行中的飞书分析运行 */
export const POST = route(async (request) => {
  requireSession(request);
  return json(await cancelMeegleRun(await parseJson(request, schema)));
}, "取消飞书分析失败");
