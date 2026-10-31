import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { HashCandidate, CommitCandidate, VersionVhalCheck } from "@/domain/analysis/version-vhal";
import { isArchiveFile } from "../archive";
import { isSupportedCanTrace } from "../signals";
import { isAndroidLog, isQnxLog } from "../log-extract";
import { throwIfPipelineCancelled } from "../process/runtime";
export function parseHashLine(rawLine: string, file: string, line: number): HashCandidate | undefined {
    const marker = rawLine.indexOf("BoschVehicleHalHash");
    if (marker < 0)
        return;
    const m = rawLine.slice(marker + "BoschVehicleHalHash".length).match(/\b([a-fA-F0-9]{6,40})-(\d{4}-\d{2}-\d{2})\b/);
    return m ? { rawHash: m[0], commitPrefix: m[1].toLowerCase(), buildDate: m[2], file, line, rawLine } : undefined;
}
function validDate(date: string) { const d = new Date(date); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date; }
export function chooseLatestHash(hashes: HashCandidate[]) {
    if (!hashes.length || hashes.some(h => !validDate(h.buildDate)))
        return { status: "unknown" as const };
    const newest = hashes.map(h => h.buildDate).sort().at(-1)!;
    const candidates = hashes.filter(h => h.buildDate === newest);
    if (new Set(candidates.map(h => h.commitPrefix)).size !== 1)
        return { status: "ambiguous" as const };
    return { status: "ok" as const, selected: candidates[0] };
}
export async function scanAndroidHashes(root: string): Promise<{
    hashes: HashCandidate[];
    warnings: string[];
}> {
    const hashes: HashCandidate[] = [], warnings: string[] = [];
    if (!root)
        return { hashes, warnings };
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
        throwIfPipelineCancelled();
        try {
            for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory())
                    await walk(full);
                else if (entry.isFile())
                    files.push(full);
            }
        }
        catch (error) {
            throwIfPipelineCancelled();
            warnings.push(`日志目录无法读取：${path.relative(root, dir)}：${String(error)}`);
        }
    };
    await walk(root);
    for (const file of files) {
        if (!isAndroidLog(file) || isQnxLog(file) || isArchiveFile(file) || isSupportedCanTrace(file))
            continue;
        throwIfPipelineCancelled();
        const stream = createReadStream(file, { encoding: "utf8" });
        const reader = createInterface({ input: stream, crlfDelay: Infinity });
        let line = 0;
        try {
            for await (const raw of reader) {
                throwIfPipelineCancelled();
                line++;
                const candidate = parseHashLine(raw, path.relative(root, file), line);
                if (candidate)
                    hashes.push(candidate);
                else if (raw.includes("BoschVehicleHalHash"))
                    warnings.push(`hash格式无法解析：${path.relative(root, file)}:${line}`);
            }
        }
        catch (error) {
            throwIfPipelineCancelled();
            warnings.push(`Android日志无法读取：${path.relative(root, file)}：${String(error)}`);
        }
        finally {
            reader.close();
            stream.destroy();
        }
    }
    return { hashes, warnings };
}
const objects = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : [];
const str = (v: unknown) => typeof v === "string" ? v : "";
export function findCommits(projects: unknown, prefix: string): CommitCandidate[] {
    return findCommitEntries(projects, prefix).map(entry => entry.candidate);
}
function commitCandidate(p: Record<string, unknown>, b: Record<string, unknown>, r: Record<string, unknown>, m: Record<string, unknown>): CommitCandidate {
    return { projectName: str(p.projectName), branchGroupName: str(b.name), repoName: str(r.repoName), repoPath: str(r.repoPath), gitBranchName: str(r.branchName), commitid: str(m.commitid), rtcids: Array.isArray(m.rtcids) ? m.rtcids.filter((v): v is string => typeof v === "string") : [] };
}
function findCommitEntries(projects: unknown, prefix: string) {
    const found: { candidate: CommitCandidate; project: Record<string, unknown>; branch: Record<string, unknown> }[] = [];
    for (const p of objects(projects))
        for (const b of objects(p.branches))
            for (const r of objects(b.repos))
                for (const m of objects(r["commid-rtcids-map"])) {
                    if (str(m.commitid).toLowerCase().startsWith(prefix.toLowerCase()))
                        found.push({ candidate: commitCandidate(p, b, r, m), project: p, branch: b });
                }
    return found;
}
function associateVs(entry: ReturnType<typeof findCommitEntries>[number]): NonNullable<VersionVhalCheck["resolution"]["vsAssociation"]> {
    const rtcids = [...new Set(entry.candidate.rtcids.filter(id => id.trim().length > 0))];
    const result: NonNullable<VersionVhalCheck["resolution"]["vsAssociation"]> = { status: "unknown", reason: "", candidates: [], unmatchedRtcids: [...rtcids] };
    if (!rtcids.length) {
        result.reason = "来源提交缺少有效 RTC，无法关联 VS 提交，继续分析";
        return result;
    }
    // Keep the exact containing JSON branch object; do not search another branch by name.
    const repos = objects(entry.branch.repos).filter(r => r.repoName === "vs");
    const matched = new Set<string>();
    for (const repo of repos) {
        const commits = new Map<string, typeof result.candidates[number]>();
        for (const mapping of objects(repo["commid-rtcids-map"])) {
            const candidate = commitCandidate(entry.project, entry.branch, repo, mapping);
            const links = rtcids.filter(id => candidate.rtcids.includes(id));
            if (!links.length) continue;
            links.forEach(id => matched.add(id));
            const key = candidate.commitid.toLowerCase();
            const previous = commits.get(key);
            if (previous) {
                previous.matchedRtcids = [...new Set([...previous.matchedRtcids, ...links])];
                previous.rtcids = [...new Set([...previous.rtcids, ...candidate.rtcids])];
            } else commits.set(key, { ...candidate, matchedRtcids: links });
        }
        result.candidates.push(...commits.values());
    }
    result.unmatchedRtcids = rtcids.filter(id => !matched.has(id));
    if (repos.length !== 1) {
        result.status = repos.length ? "ambiguous" : "unknown";
        result.reason = repos.length ? "同项目、同分支组存在多个 VS 仓库条目，无法唯一关联，继续分析" : "同项目、同分支组缺少 VS 仓库，继续分析";
    } else if (result.candidates.length !== 1) {
        result.status = result.candidates.length ? "ambiguous" : "unknown";
        result.reason = result.candidates.length ? "RTC 对应多个不同 VS 提交，继续分析" : "同项目、同分支组的 VS 仓库没有匹配 RTC 的提交，继续分析";
    } else if (!/^[a-fA-F0-9]{6,40}$/.test(result.candidates[0].commitid)) {
        result.reason = "RTC 对应的 VS commitid 格式无效，继续分析";
    } else {
        result.status = "ok";
        result.selected = result.candidates[0];
        result.reason = "已通过同项目、同分支组的 RTC 唯一关联 VS 提交";
    }
    return result;
}
export function versionFromCode(code: string) {
    if (!/^\d{8}$/.test(code))
        throw new Error("VHAL版本不是8位编码");
    return { platform: code.slice(0, 4), version: `${code[4]}.${code[5]}.${Number(code.slice(6))}` };
}
async function safeDirectory(root: string, ...parts: string[]) {
    if (parts.some(s => !s || s === "." || s === ".." || /[\\/]/.test(s)))
        throw new Error("配置目录名称无效");
    const base = await fs.realpath(root), dir = await fs.realpath(path.join(base, ...parts));
    const rel = path.relative(base, dir);
    if (rel.startsWith("..") || path.isAbsolute(rel))
        throw new Error("配置目录超出根目录");
    return dir;
}
export async function resolveVhal(root: string, extractDir: string): Promise<VersionVhalCheck["resolution"]> {
    const result: VersionVhalCheck["resolution"] = { status: "unknown", reason: "", hashes: [], candidates: [], archives: [] };
    try {
        const scanned = await scanAndroidHashes(extractDir);
        result.hashes = scanned.hashes;
        // An unreadable/malformed hash source cannot prove that the latest build was observed.
        if (scanned.warnings.length) {
            result.reason = scanned.warnings.join("；");
            return result;
        }
        const choice = chooseLatestHash(result.hashes);
        result.status = choice.status;
        if (!choice.selected) {
            result.reason = choice.status === "ambiguous" ? "最新编译日期存在不同hash，冲突已记录，继续分析" : "Android hash缺失或编译日期无效，继续分析";
            return result;
        }
        result.selectedHash = choice.selected;
        const entries = findCommitEntries(JSON.parse(await fs.readFile(path.join(root, "docs/project.json"), "utf8")), choice.selected.commitPrefix);
        result.candidates = entries.map(entry => entry.candidate);
        if (result.candidates.length !== 1) {
            result.status = result.candidates.length ? "ambiguous" : "unknown";
            result.reason = "提交或分支组无法唯一定位，已保留全部候选，继续分析";
            return result;
        }
        result.vsAssociation = associateVs(entries[0]);
        if (!result.vsAssociation.selected) {
            result.status = result.vsAssociation.status;
            result.reason = result.vsAssociation.reason;
            return result;
        }
        const c = result.vsAssociation.selected;
        const vsRepo = objects(entries[0].branch.repos).find(r => r.repoName === "vs")!;
        const vsCommits = [...new Set(objects(vsRepo["commid-rtcids-map"]).map(m => str(m.commitid).toLowerCase()).filter(Boolean))];
        const dir = await safeDirectory(path.join(root, "configuration"), c.projectName, c.branchGroupName);
        let archivePrefixConflict = false;
        for (const folder of [dir, path.join(dir, "bak")]) {
            const entries = await fs.readdir(folder, { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return []; throw error; });
            for (const entry of entries) {
                const match = /^([a-fA-F0-9]{6,40})_(.+)_(\d{8})(?:\.h)?$/.exec(entry.name);
                if (entry.isFile() && match && c.commitid.toLowerCase().startsWith(match[1].toLowerCase())) {
                    const commitCandidates = vsCommits.filter(commit => commit.startsWith(match[1].toLowerCase()));
                    if (commitCandidates.length !== 1) archivePrefixConflict = true;
                    result.archives.push({ file: path.join(folder, entry.name), code: match[3], commitCandidates });
                }
            }
        }
        if (archivePrefixConflict) {
            result.status = "ambiguous";
            result.reason = "VS 归档提交前缀存在冲突，无法唯一关联完整 VS commit，继续分析";
            return result;
        }
        const codes = [...new Set(result.archives.map(a => a.code))];
        if (codes.length !== 1) {
            result.status = codes.length ? "ambiguous" : "unknown";
            result.reason = codes.length ? "VS 提交归档版本冲突，继续分析" : "VS 提交归档版本缺失，继续分析";
            return result;
        }
        const v = versionFromCode(codes[0]);
        Object.assign(result, v);
        const vhalDir = await safeDirectory(path.join(root, "configuration"), c.projectName, "vhal", `vhal${v.version}`);
        result.excel = path.join(vhalDir, `CHERY_${v.platform}_VHAL_SIGNAL_V${v.version}.xlsx`);
        const real = await fs.realpath(result.excel);
        if (path.dirname(real) !== vhalDir)
            throw new Error("Excel文件超出版本目录");
        result.status = "ok";
        result.reason = "已按最新编译日期 hash、RTC 关联的唯一 VS 提交及归档定位";
    }
    catch (error) {
        throwIfPipelineCancelled();
        result.status = "unknown";
        result.reason = `VHAL定位失败：${String(error)}；继续分析`;
    }
    return result;
}
