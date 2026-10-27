import { z } from "zod";
import { HttpError, json, parseJson, requireSession, route } from "@/server/http/route";
import { getJiraConnection } from "@/server/jira/connection";
import { assignIssue, getAssigneeCandidates, getTransitions } from "@/server/jira/transition";

export const runtime = "nodejs";

type Params = { id: string; issueKey: string };

const AssignSchema = z.object({
  transitionId: z.string().optional(),
  targetUser: z.string().optional(),
  jiraProvider: z.string().optional(),
});

function toFailure(err: unknown): HttpError {
  const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
  return new HttpError(500, msg, { success: false });
}

/** GET：可用流转 + 候选经办人 → { success, transitions, assigneeCandidates } */
export const GET = route<Params>(async (request, { params }) => {
  requireSession(request, "analyst");
  const { issueKey } = await params;
  try {
    const connection = getJiraConnection(request.nextUrl.searchParams.get("provider"));
    const [transitions, assigneeCandidates] = await Promise.all([
      getTransitions(connection, issueKey),
      getAssigneeCandidates(connection, issueKey),
    ]);
    return json({ success: true, transitions, assigneeCandidates });
  } catch (err) {
    throw toFailure(err);
  }
});

/** POST：Jira 票流转只修改经办人，不修改票的状态 */
export const POST = route<Params>(async (request, { params }) => {
  requireSession(request, "reviewer");
  const { issueKey } = await params;
  const { transitionId, targetUser, jiraProvider } = await parseJson(request, AssignSchema);
  const connection = getJiraConnection(jiraProvider);
  const trimmedTargetUser = targetUser?.trim();
  if (!trimmedTargetUser) throw new HttpError(400, "缺少 targetUser (经办人) 参数", { success: false });

  try {
    await assignIssue(connection, issueKey, trimmedTargetUser);
  } catch (err) {
    throw toFailure(err);
  }
  return json({
    success: true,
    transitionId,
    transitionName: "指派经办人",
    targetStatus: "",
    assignedTo: trimmedTargetUser,
  });
});
