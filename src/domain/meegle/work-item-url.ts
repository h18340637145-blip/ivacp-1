/** 飞书项目工单原文地址：https://project.feishu.cn/{空间 simple_name}/{工作项类型}/detail/{工作项 ID} */
export const MEEGLE_BASE_URL = "https://project.feishu.cn";

export function buildMeegleWorkItemUrl(
  identity: { projectKey: string; workItemTypeKey: string; workItemId: number | string },
  env: { simpleName?: string; baseUrl?: string } = {
    simpleName: process.env.NEXT_PUBLIC_MEEGLE_PROJECT_SIMPLE_NAME,
    baseUrl: process.env.NEXT_PUBLIC_MEEGLE_BASE_URL,
  },
): string {
  const base = (env.baseUrl?.trim() || MEEGLE_BASE_URL).replace(/\/+$/, "");
  const space = env.simpleName?.trim() || identity.projectKey;
  return `${base}/${encodeURIComponent(space)}/${encodeURIComponent(identity.workItemTypeKey)}/detail/${encodeURIComponent(String(identity.workItemId))}`;
}
