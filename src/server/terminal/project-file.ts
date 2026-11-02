import path from "node:path";
import { exists } from "./sync/storage";

/** 规范的默认项目配置文件（管理员维护，流水线也读取） */
export const CANONICAL_PROJECT_FILE = "docs/project.json";

/**
 * 把终端目标显示名转换为安全的文件名片段。
 * 仅保留字母、数字、下划线、点、连字符与中日韩文字；其余折叠为连字符。
 * 拒绝空值、超长与路径穿越，避免写出 docs/ 之外的文件。
 */
export function targetConfigSlug(targetName: string): string {
  const slug = (targetName ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!slug || slug.length > 100 || slug.includes("..")) {
    throw new Error(`终端目标名无法生成配置文件名：${targetName}`);
  }
  return slug;
}

/** 默认配置文件绝对路径：docs/project.json */
export function canonicalProjectFile(root: string): string {
  return path.join(root, CANONICAL_PROJECT_FILE);
}

/** 目标专属配置文件绝对路径：docs/project_<目标名>.json */
export function namedProjectFile(root: string, targetName: string): string {
  return path.join(root, "docs", `project_${targetConfigSlug(targetName)}.json`);
}

/**
 * 读取优先级（named_first）：给定目标且存在专属文件时用专属文件，
 * 否则回退到 docs/project.json。无目标（如流水线）时始终用 docs/project.json。
 */
export async function resolveProjectReadFile(root: string, targetName?: string): Promise<string> {
  if (targetName) {
    const named = namedProjectFile(root, targetName);
    if (await exists(named)) return named;
  }
  return canonicalProjectFile(root);
}

/** 导入写入位置：管理员写规范文件，其它登录用户写目标专属文件。 */
export function resolveImportWriteFile(root: string, targetName: string, isAdmin: boolean): string {
  return isAdmin ? canonicalProjectFile(root) : namedProjectFile(root, targetName);
}
