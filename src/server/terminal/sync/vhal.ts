import fs from "node:fs/promises";
import path from "node:path";
import type { TerminalBranchVhal } from "../../../domain/terminal/sync";
import type { TerminalBranchConfig, TerminalProject } from "../../../domain/terminal/types";
import { parseVhalVersion } from "../../pipeline/vhal-version";
import { gitBlobId } from "./remote";
import { branchKey, directoryName } from "./storage";

/** Read the final flattened header, including when multiple repos supplied type.h. */
export async function readSyncedHeader(directory: string, targetId: string): Promise<TerminalBranchVhal | undefined> {
  try {
    const file = path.join(directory, "type.h");
    if (!(await fs.lstat(file)).isFile()) return;
    return { targetId, ...parseVhalVersion(await fs.readFile(file, "utf8")) };
  } catch { return; }
}

/** Restore the displayed version only from a matching, intact published snapshot. */
export async function loadPublishedVhal(root: string, project: TerminalProject, branch: TerminalBranchConfig): Promise<TerminalBranchVhal | undefined> {
  try {
    directoryName(project.projectName); directoryName(branch.name);
    const base = path.join(root, "configuration");
    const directory = path.join(base, project.projectName, branch.name);
    for (const dir of [base, path.dirname(directory), directory]) {
      const stat = await fs.lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    }
    const stateFile = path.join(directory, ".sync-state.json");
    if (!(await fs.lstat(stateFile)).isFile()) return;
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    if (state.schemaVersion !== 1 || typeof state.targetId !== "string" || state.configurationKey !== branchKey(project, branch) || !Array.isArray(state.files)) return;
    const file = state.files.find((f: { name?: string }) => f?.name === "type.h");
    if (!file || typeof file.oid !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(file.oid)) return;
    const header = path.join(directory, "type.h");
    if (!(await fs.lstat(header)).isFile()) return;
    const content = await fs.readFile(header);
    if (gitBlobId(content, file.oid.length) !== file.oid) return;
    return { targetId: state.targetId, ...parseVhalVersion(content.toString("utf8")) };
  } catch { return; }
}
