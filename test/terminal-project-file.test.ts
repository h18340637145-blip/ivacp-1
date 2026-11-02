import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalProjectFile,
  namedProjectFile,
  resolveImportWriteFile,
  resolveProjectReadFile,
  targetConfigSlug,
} from "@/server/terminal/project-file";
import { describeTerminalProjects, loadTerminalProjects } from "@/server/terminal/projects";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-file-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  return root;
}
const project = {
  projectName: "p",
  mainPath: "~/remote",
  scriptPath: "",
  branches: [{ name: "b", repos: [{ repoName: "r", repoPath: "r", branchName: "main" }] }],
};

describe("project-file helpers", () => {
  it("生成安全的配置文件名并拒绝穿越与非法输入", () => {
    expect(targetConfigSlug("测试 环境/A")).toBe("测试-环境-A");
    expect(() => targetConfigSlug("..")).toThrow();
    expect(() => targetConfigSlug("   ")).toThrow();
    expect(() => targetConfigSlug("a".repeat(101))).toThrow();
    expect(() => targetConfigSlug("a/../b")).toThrow();
  });
  it("named 文件位于 docs/ 下且带 project_ 前缀", async () => {
    const root = await setup();
    expect(namedProjectFile(root, "环境A")).toBe(path.join(root, "docs", "project_环境A.json"));
    expect(canonicalProjectFile(root)).toBe(path.join(root, "docs/project.json"));
  });
  it("named_first：存在专属文件时优先，否则回退规范文件", async () => {
    const root = await setup();
    expect(await resolveProjectReadFile(root, "环境A")).toBe(canonicalProjectFile(root));
    await fs.writeFile(namedProjectFile(root, "环境A"), "[]");
    expect(await resolveProjectReadFile(root, "环境A")).toBe(namedProjectFile(root, "环境A"));
    expect(await resolveProjectReadFile(root)).toBe(canonicalProjectFile(root));
  });
  it("导入写入位置：管理员写规范文件，其它用户写专属文件", async () => {
    const root = await setup();
    expect(resolveImportWriteFile(root, "环境A", true)).toBe(canonicalProjectFile(root));
    expect(resolveImportWriteFile(root, "环境A", false)).toBe(namedProjectFile(root, "环境A"));
  });
});

describe("终端项目配置缺失降级", () => {
  it("配置缺失时 loadTerminalProjects 返回空数组", async () => {
    const root = await setup();
    expect(await loadTerminalProjects(root, "环境A")).toEqual([]);
  });
  it("describeTerminalProjects 标记缺失与可写位置", async () => {
    const root = await setup();
    const missing = await describeTerminalProjects(root, { targetName: "环境A", isAdmin: false });
    expect(missing.configMissing).toBe(true);
    expect(missing.projects).toEqual([]);
    expect(missing.canImportCanonical).toBe(false);

    await fs.writeFile(canonicalProjectFile(root), JSON.stringify([project]));
    const present = await describeTerminalProjects(root, { targetName: "环境A", isAdmin: true });
    expect(present.configMissing).toBe(false);
    expect(present.projects[0]?.projectName).toBe("p");
    expect(present.canImportCanonical).toBe(true);
  });
});
