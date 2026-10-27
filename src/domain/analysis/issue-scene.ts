/**
 * 问题场景：台架（bench）/ 实车（vehicle），由票据标题中的「台架」「实车」标志判定。
 * 两种场景分析工作流相同，但结论口径不同；历史案例召回只在同场景内进行。
 */
export type IssueScene = "bench" | "vehicle";

export const ISSUE_SCENE_INFO: Record<IssueScene, { keyword: string; label: string; replyTag: string; conclusionRule: string }> = {
  bench: {
    keyword: "台架",
    label: "台架问题",
    replyTag: "【台架问题】",
    conclusionRule: "台架环境，请测试确认是否模拟信号上报。",
  },
  vehicle: {
    keyword: "实车",
    label: "实车问题",
    replyTag: "【实车问题】",
    conclusionRule: "实车环境，vehicle 通路正常，请按需求确认原因并转对应模块分析。",
  },
};

/** 标题同时出现两个标志时，取最先出现的那个；都没有时返回 undefined */
export function detectIssueScene(summary: string | undefined | null): IssueScene | undefined {
  const text = summary ?? "";
  let best: { scene: IssueScene; index: number } | undefined;
  for (const scene of Object.keys(ISSUE_SCENE_INFO) as IssueScene[]) {
    const index = text.indexOf(ISSUE_SCENE_INFO[scene].keyword);
    if (index >= 0 && (!best || index < best.index)) best = { scene, index };
  }
  return best?.scene;
}

/**
 * 召回范围：当前票场景已知时只保留同场景历史样本；
 * 当前票无场景标志时不限场景（保持原行为）。
 */
export function filterBySameScene<T>(
  currentScene: IssueScene | undefined,
  samples: T[],
  summaryOf: (sample: T) => string | undefined,
): T[] {
  if (!currentScene) return samples;
  return samples.filter((sample) => detectIssueScene(summaryOf(sample)) === currentScene);
}

/** Step 5 / 摘要分析注入的场景提示块；无场景时为空 */
export function buildIssueScenePromptBlock(scene: IssueScene | undefined): string {
  if (!scene) return "";
  const info = ISSUE_SCENE_INFO[scene];
  return [
    "<问题场景>",
    `本票为${info.label}（标题含「${info.keyword}」）。分析流程不变，但结论必须按${info.label}口径给出：`,
    `- ${info.conclusionRule}`,
    `结论开头无需再写${info.replyTag}，系统会自动添加。`,
    "</问题场景>",
  ].join("\n");
}

/** 在最终结论开头加场景标注；已带标注时不重复添加 */
export function applyIssueSceneReplyTag(reply: string, scene: IssueScene | undefined): string {
  if (!scene || !reply.trim()) return reply;
  const tag = ISSUE_SCENE_INFO[scene].replyTag;
  const body = reply.replace(/^\s+/, "");
  return body.startsWith(tag) ? body : `${tag}\n${body}`;
}
