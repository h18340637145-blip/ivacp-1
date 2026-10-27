import { z } from "zod";
import { badRequest, json, parseJson, requireSession, route } from "@/server/http/route";
import { fetchJiraHandoverAt } from "@/server/handover/handover";

export const runtime = "nodejs";

const HandoverSchema = z.object({
  issueKey: z.string().optional(),
  jiraProvider: z.string().optional(),
});

/** POST /api/jira/handover：读取工单最近一次转交给当前处理人的时间 → { handoverAt?: ISO } */
export const POST = route(async (request) => {
  requireSession(request, "analyst");
  const { issueKey, jiraProvider } = await parseJson(request, HandoverSchema);
  if (!issueKey) throw badRequest("issueKey is required");
  const handoverAt = await fetchJiraHandoverAt(issueKey, jiraProvider);
  return json({ handoverAt: handoverAt?.toISOString() });
}, "读取 Jira 转交时间失败");
