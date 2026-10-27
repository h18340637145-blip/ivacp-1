import { z } from "zod";
import { HttpError, json, parseJson, requireSession, route } from "@/server/http/route";
import { getJiraConnection } from "@/server/jira/connection";
import { postJiraCommentWithChart } from "@/server/jira/comment";

export const runtime = "nodejs";

const CommentSchema = z.object({
  issueKey: z.string().optional(),
  body: z.string().optional(),
  /** 例如 "/api/charts/log/<group>/<issue>/can_signals.png" */
  chartImagePath: z.string().optional(),
  jiraProvider: z.string().optional(),
});

/** POST /api/jira/comment：把分析结论（可附 CAN 信号图）回填为 Jira 评论 → { success, commentId? , error? } */
export const POST = route(async (request) => {
  requireSession(request, "reviewer");
  const { issueKey, body, chartImagePath, jiraProvider } = await parseJson(request, CommentSchema);
  const connection = getJiraConnection(jiraProvider);
  if (connection.missing.length > 0) {
    throw new HttpError(500, `Jira 环境变量未配置（${connection.missing.join(" / ")}）`, { success: false });
  }
  if (!issueKey || !body) throw new HttpError(400, "缺少 issueKey 或 body 参数", { success: false });

  try {
    const { commentId } = await postJiraCommentWithChart({ connection, issueKey, body, chartImagePath });
    return json({ success: true, commentId });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    console.error(`[Jira Comment] 回填失败: ${msg}`);
    throw new HttpError(500, msg, { success: false });
  }
}, "Jira 评论回填失败");
