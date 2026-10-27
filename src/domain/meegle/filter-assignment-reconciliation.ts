import type { Assignment, FilterAudit } from "@/domain/entities";

interface AutoAssignmentReconciliationInput {
  successfulRuleGroupIds: Iterable<string>;
  audits: Iterable<FilterAudit>;
  assignments: Iterable<Assignment>;
}

function identityKey(projectKey: string, workItemTypeKey: string, workItemId: number): string {
  return JSON.stringify([projectKey, workItemTypeKey, workItemId]);
}

/**
 * Returns stale assignment IDs for groups whose MQL query completed
 * successfully. Failed query groups are deliberately absent from the scope.
 */
export function autoAssignmentIdsToUnassign({
  successfulRuleGroupIds,
  audits,
  assignments,
}: AutoAssignmentReconciliationInput): string[] {
  const successfulGroups = new Set(
    Array.from(successfulRuleGroupIds).filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  );
  const retainedInRun = new Set(
    Array.from(audits)
      .filter((audit) => (
        (audit.decision === "assigned" || audit.decision === "skipped_manual_assignment")
        && audit.matchedRuleGroupId
        && successfulGroups.has(audit.matchedRuleGroupId)
      ))
      .map((audit) => `${audit.matchedRuleGroupId}:${identityKey(audit.projectKey, audit.workItemTypeKey, audit.workItemId)}`),
  );

  return Array.from(assignments)
    .filter((assignment) => {
      if (!successfulGroups.has(assignment.ruleGroupId)) return false;
      const key = `${assignment.ruleGroupId}:${identityKey(assignment.projectKey, assignment.workItemTypeKey, assignment.workItemId)}`;
      return !retainedInRun.has(key);
    })
    .map((assignment) => assignment.id);
}
