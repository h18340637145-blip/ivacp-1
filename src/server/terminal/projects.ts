import fs from "node:fs/promises";
import path from "node:path";
import type { TerminalProject } from "@/domain/terminal/types";

/** 读取 docs/project.json（终端工作台的项目 / 分支 / 仓库配置） */
export async function loadTerminalProjects(): Promise<TerminalProject[]> {
  const file = path.join(process.cwd(), "docs/project.json");
  const raw = await fs.readFile(file, "utf8");
  const projects = JSON.parse(raw) as unknown;
  if (!Array.isArray(projects)) throw new Error("项目配置格式错误：根节点必须是数组");
  return projects as TerminalProject[];
}
