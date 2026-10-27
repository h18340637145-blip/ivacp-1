import { json, route } from "@/server/http/route";
import { listItems } from "@/server/labeling/labeling";
import { labelingAction, requireLabelingSession } from "@/server/labeling/route-helpers";

export const runtime = "nodejs";

/** 标注条目列表：?source=jira|meegle&status=all|todo|done&reviewStatus=&scene=bench|vehicle|none|all&q=&limit= */
export const GET = route(async (request) => {
  const session = requireLabelingSession(request);
  const params = request.nextUrl.searchParams;
  const source = params.get("source");
  const status = params.get("status");
  const scene = params.get("scene");
  const result = await labelingAction(
    () =>
      listItems(session.username, {
        source: source === "jira" || source === "meegle" ? source : undefined,
        status: status === "todo" || status === "done" ? status : "all",
        reviewStatus: params.get("reviewStatus") ?? undefined,
        scene: scene === "bench" || scene === "vehicle" || scene === "none" ? scene : "all",
        query: params.get("q") ?? undefined,
        limit: Number(params.get("limit")) || undefined,
      }),
    "读取标注条目失败",
  );
  return json(result);
}, "读取标注条目失败");
