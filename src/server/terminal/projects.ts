import fs from "node:fs/promises";
import path from "node:path";
import { loadPublishedVhal } from "./sync/vhal";
import type { TerminalProject } from "@/domain/terminal/types";

/** 读取 docs/project.json（终端工作台的项目 / 分支 / 仓库配置） */
export async function loadTerminalProjects(root = process.cwd()): Promise<TerminalProject[]> {
  const file = path.join(root, "docs/project.json");
  const raw = await fs.readFile(file, "utf8");
  const projects = JSON.parse(raw) as unknown;
  if (!Array.isArray(projects)) throw new Error("项目配置格式错误：根节点必须是数组");
  return Promise.all((projects as TerminalProject[]).map(async project => ({
    ...project,
    branches: await Promise.all(project.branches.map(async branch => ({ ...branch, syncedVhal: await loadPublishedVhal(root, project, branch) }))),
  })));
}
