import path from "node:path";

/** 未显式传入 projectKey 时使用的飞书空间（与旧版 PROJECT_KEY 默认值一致） */
export function meegleDefaultProjectKey(): string {
  return process.env.PROJECT_KEY || "6a3124c5681f717f59901004";
}

/** 查询可流转状态时使用的飞书用户 key */
export function meegleOperatorUserKey(): string {
  return process.env.USER_KEY || "7665621138738908345";
}

/** 分析运行产物根目录（log/<规则组>/<车型>/<issueKey>/<runId>） */
export function meegleLogBase(): string {
  return path.join(process.cwd(), "log");
}
