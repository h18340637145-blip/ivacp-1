import { json, notFound, route } from "@/server/http/route";
import { getItem } from "@/server/labeling/labeling";
import { labelingAction, requireLabelingSession } from "@/server/labeling/route-helpers";

export const runtime = "nodejs";

/** 单条标注条目详情（含预填建议与已有标注）：?id=<itemId> */
export const GET = route(async (request) => {
  const session = requireLabelingSession(request);
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const item = await labelingAction(() => getItem(session.username, id), "读取条目失败");
  if (!item) throw notFound("条目不存在");
  return json({ item });
}, "读取条目失败");
