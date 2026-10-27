import { z } from "zod";
import { json, parseJson, requireSession, route } from "@/server/http/route";
import { searchJiraIssues } from "@/server/jira/filter";

export const runtime = "nodejs";

const FilterSchema = z.object({
  jql: z.string(),
  provider: z.string().optional(),
});

/** POST /api/jira/filter：按 JQL 搜索 Jira 工单 → { issues, total } */
export const POST = route(async (request) => {
  requireSession(request, "analyst");
  const { jql, provider } = await parseJson(request, FilterSchema);
  return json(await searchJiraIssues(jql, provider));
}, "Jira 搜索失败");
