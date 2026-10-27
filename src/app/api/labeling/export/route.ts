import { NextResponse } from "next/server";
import { route } from "@/server/http/route";
import { exportJsonl } from "@/server/labeling/labeling";
import { labelingAction, requireLabelingSession } from "@/server/labeling/route-helpers";

export const runtime = "nodejs";

/** 导出当前账号的有效标注为 JSONL 附件 */
export const GET = route(async (request) => {
  const session = requireLabelingSession(request);
  const body = await labelingAction(() => exportJsonl(session.username), "导出标注数据失败");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="labeled-data-${new Date().toISOString().slice(0, 10)}.jsonl"`,
    },
  });
}, "导出标注数据失败");
