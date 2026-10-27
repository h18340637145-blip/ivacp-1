export interface MeegleClassification {
  carModel: string;
  project: string;
  platform: string;
}

export interface MeegleRuleGroupMatchTarget {
  id: string;
  name: string;
  model_to_files?: Record<string, unknown>;
}

export interface MeegleAssignmentDecision {
  decision: "assigned" | "unassigned";
  ruleGroupId?: string;
  ruleGroupName?: string;
  score: number;
  reason: string;
}

export function shouldApplyAutoAssignment(assignment?: {
  assignmentSource?: "manual" | "auto";
  ruleGroupId: string;
}): boolean {
  return assignment?.assignmentSource !== "manual";
}

const projectAliases: Record<string, string> = {
  "奇瑞": "chery",
  chery: "chery",
  "吉利": "geely",
  geely: "geely",
  "捷途": "jitu",
  jitu: "jitu",
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[-_\s]/g, "");
}

export function normalizeMeegleClassification(value: MeegleClassification): MeegleClassification {
  const projectKey = value.project.trim().toLowerCase();
  return {
    carModel: normalizeToken(value.carModel),
    project: projectAliases[projectKey] ?? normalizeToken(value.project),
    platform: normalizeToken(value.platform),
  };
}

function includesToken(haystack: string, token: string): boolean {
  return Boolean(token) && haystack.includes(token);
}

export function decideMeegleAssignment(
  classification: MeegleClassification,
  ruleGroups: MeegleRuleGroupMatchTarget[],
): MeegleAssignmentDecision {
  const normalized = normalizeMeegleClassification(classification);
  if (!normalized.carModel && !normalized.project && !normalized.platform) {
    return { decision: "unassigned", score: 0, reason: "模型未识别出车型、项目或平台" };
  }

  const candidates = ruleGroups.map((group) => {
    const groupName = normalizeToken(group.name);
    const modelMatched = Object.keys(group.model_to_files ?? {})
      .map(normalizeToken)
      .some((model) => model === normalized.carModel);
    const nameModelMatched = includesToken(groupName, normalized.carModel);
    const nameProjectMatched = includesToken(groupName, normalized.project);
    const namePlatformMatched = includesToken(groupName, normalized.platform);
    const projectPlatformMatched = nameProjectMatched && namePlatformMatched;
    const modelPlatformMatched = nameModelMatched && namePlatformMatched;
    const nameFullMatched = nameModelMatched && nameProjectMatched && namePlatformMatched;
    const score = modelMatched ? 100
      : nameFullMatched ? 90
      : modelPlatformMatched ? 85
      : nameModelMatched && projectPlatformMatched ? 85
      : nameModelMatched ? 80
      : projectPlatformMatched ? 40
      : 0;
    const reason = modelMatched
      ? "车型配置归一化精确匹配"
      : nameFullMatched
        ? "规则组名称车型+项目+平台完全匹配"
        : modelPlatformMatched
          ? "规则组名称车型+平台匹配"
          : nameModelMatched && projectPlatformMatched
            ? "规则组名称车型+项目平台匹配"
            : nameModelMatched
              ? "规则组名称车型匹配"
              : projectPlatformMatched
                ? "项目与平台联合匹配"
                : "未达到自动分配条件";
    return { group, score, reason };
  });
  const highestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
  const best = candidates.filter((candidate) => candidate.score === highestScore);
  if (highestScore < 40) {
    return { decision: "unassigned", score: highestScore, reason: "车型或项目平台信息不足，未达到自动分配条件" };
  }
  if (best.length !== 1) {
    return { decision: "unassigned", score: highestScore, reason: "多个规则组匹配分数相同，保留待分配" };
  }
  return {
    decision: "assigned",
    ruleGroupId: best[0].group.id,
    ruleGroupName: best[0].group.name,
    score: best[0].score,
    reason: best[0].reason,
  };
}
