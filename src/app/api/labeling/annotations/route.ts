import { z } from "zod";
import { badRequest, json, parseJson, route } from "@/server/http/route";
import { deleteAnnotation, saveAnnotation } from "@/server/labeling/labeling";
import { labelingAction, requireLabelingSession } from "@/server/labeling/route-helpers";

export const runtime = "nodejs";

const SaveSchema = z.object({ itemId: z.string().min(1), annotation: z.unknown() });

/** 保存（新增或覆盖）当前账号对某条目的标注，revision 自增 */
export const PUT = route(async (request) => {
  const session = requireLabelingSession(request, true);
  const body = await parseJson(request, SaveSchema);
  const annotation = await labelingAction(
    () => saveAnnotation(session.username, session.username, body.itemId, body.annotation),
    "保存标注失败",
  );
  return json({ annotation });
}, "保存标注失败");

/** 撤销标注：DELETE ?id=<itemId> */
export const DELETE = route(async (request) => {
  const session = requireLabelingSession(request, true);
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) throw badRequest("缺少条目 ID");
  await labelingAction(() => deleteAnnotation(session.username, id), "撤销标注失败");
  return json({ ok: true });
}, "撤销标注失败");
