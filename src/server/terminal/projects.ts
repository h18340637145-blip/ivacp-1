import fs from "node:fs/promises";
import { loadPublishedVhal } from "./sync/vhal";
import { validateProjects, exists } from "./sync/storage";
import { canonicalProjectFile, namedProjectFile, resolveProjectReadFile } from "./project-file";
import type { TerminalProject } from "@/domain/terminal/types";

async function mapSyncedVhal(root: string, projects: TerminalProject[]): Promise<TerminalProject[]> {
  return Promise.all(projects.map(async project => ({
    ...project,
    branches: await Promise.all(project.branches.map(async branch => ({ ...branch, syncedVhal: await loadPublishedVhal(root, project, branch) }))),
  })));
}

/** 读取当前生效的项目配置，并附带来源与可写位置信息（供路由与界面展示） */
export async function describeTerminalProjects(
  root: string,
  options: { targetName?: string; isAdmin: boolean },
): Promise<{ projects: TerminalProject[]; configMissing: boolean; sourceFile: string; canImportCanonical: boolean }> {
  const file = await resolveProjectReadFile(root, options.targetName);
  const present = await exists(file);
  const projects = present ? await mapSyncedVhal(root, validateProjects(JSON.parse(await fs.readFile(file, "utf8")))) : [];
  const writeFile = options.isAdmin
    ? canonicalProjectFile(root)
    : options.targetName
      ? namedProjectFile(root, options.targetName)
      : canonicalProjectFile(root);
  return { projects, configMissing: !present, sourceFile: file, canImportCanonical: options.isAdmin && writeFile === canonicalProjectFile(root) };
}

/**
 * 读取终端工作台的项目 / 分支 / 仓库配置。
 * 按 named_first 解析：给定目标且存在 docs/project_<目标名>.json 时优先，否则 docs/project.json。
 * 配置缺失时返回空数组（终端切换分支 / 同步等功能据此禁用），不抛错。
 */
export async function loadTerminalProjects(root = process.cwd(), targetName?: string): Promise<TerminalProject[]> {
  const file = await resolveProjectReadFile(root, targetName);
  if (!(await exists(file))) return [];
  return mapSyncedVhal(root, validateProjects(JSON.parse(await fs.readFile(file, "utf8"))));
}
