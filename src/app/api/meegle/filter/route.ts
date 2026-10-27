import { z } from "zod";
import { HttpError, json, parseJson, requireSession, route } from "@/server/http/route";
import { runMeegleMqlFilter } from "@/server/meegle/mql-filter-run";

export const runtime = "nodejs";

/** 请求体在服务层逐项校验，保留旧版的字段级中文错误 */
const schema = z.unknown();

/** 按规则组 MQL 筛选飞书工作项并解析自动归属 */
export const POST = route(async (request) => {
  requireSession(request);
  const body = await parseJson(request, schema);
  try {
    return json(await runMeegleMqlFilter(body));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("飞书 MQL 筛选执行失败", error);
    throw new HttpError(500, "飞书 MQL 筛选执行失败");
  }
}, "飞书 MQL 筛选执行失败");
