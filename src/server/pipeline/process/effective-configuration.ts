import { z } from "zod";
import { validateDbcFiles } from "../validate-dbc";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { extractCarModelFromTitle } from "@/domain/issue-source/jira-workflow";
import { resolveModelAlias } from "@/domain/rule-groups/model-files";
import type { ConfigurationResolution } from "@/domain/analysis/effective-configuration";
import type { ProcessContext } from "./context";
import type { LogVersions } from "../log-versions";
import type { TerminalProject, TerminalBranchConfig } from "@/domain/terminal/types";
import { readProjects, branchKey } from "@/server/terminal/sync/storage";
import { gitBlobId } from "@/server/terminal/sync/remote";
import { scanAndroidHashes, chooseLatestHash, findCommits } from "../version-vhal/resolution";
import { throwIfPipelineCancelled } from "./runtime";
import type { EffectiveConfiguration } from "./effective-context";
const oidSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const manifestSchema = z.object({ schemaVersion: z.literal(1), targetId: z.string().min(1), syncedAt: z.string(), fingerprint: z.string().min(1), configurationKey: z.string(), headerFile: z.string().min(1).optional(), files: z.array(z.object({ name: z.string(), oid: oidSchema })), repos: z.array(z.object({ repoName: z.string(), repoPath: z.string(), branchName: z.string(), latestSyncedCommitId: oidSchema, rtcids: z.array(z.string().regex(/^RTC1-\d+$/)).optional() })) });
type Candidate = {
    project: TerminalProject;
    branch: TerminalBranchConfig;
};
type FileSpec = {
    kind: "json" | "dbc" | "proto" | "vhal";
    name: string;
    root: string;
};
const digest = (content: Buffer) => createHash("sha256").update(content).digest("hex");
function fileNames(value: string | string[] | undefined): string[] {
    if (Array.isArray(value))
        return [...new Set(value.map(v => v.trim()).filter(Boolean))];
    if (!value?.trim())
        return [];
    if (value.trim().startsWith("[")) {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed) || !parsed.every(v => typeof v === "string"))
            throw new Error("文件列表无效");
        return fileNames(parsed);
    }
    return [...new Set(value.split(/[,，;；\n]/).map(v => v.trim()).filter(Boolean))];
}
function relativeFile(name: string) {
    if (!name || path.isAbsolute(name) || /[\\\x00-\x1f]/.test(name) || name.split("/").some(p => !p || p === "." || p === ".."))
        throw new Error(`文件名不是安全相对路径：${name}`);
    return name;
}
function specs(config: EffectiveConfiguration, strict = true): FileSpec[] {
    const model = config.modelToFiles?.[config.carModel];
    const bases = config.basePaths;
    if (!model || !bases)
        throw new Error("缺少车型文件或基础路径配置");
    const json = fileNames(model.json), dbc = fileNames(model.dbc), proto = model.proto?.trim();
    if (strict && (!json.length || !dbc.length || !proto))
        throw new Error("车型 JSON、DBC、Proto 文件集合不完整");
    return [...json.map(name => ({ kind: "json" as const, name: relativeFile(name), root: bases.json_dir })), ...dbc.map(name => ({ kind: "dbc" as const, name: relativeFile(name), root: bases.dbc_dir })), ...(proto ? [{ kind: "proto" as const, name: relativeFile(proto), root: bases.proto_dir }] : [])];
}
function validate(content: Buffer, file: FileSpec) {
    const text = content.toString("utf8");
    if (file.kind === "json" && !Array.isArray(JSON.parse(text)))
        throw new Error(`信号 JSON 不是数组：${file.name}`);
    if (file.kind === "proto" && !/\benum\s+Property_ID\s*\{/.test(text))
        throw new Error(`Proto 缺少 Property_ID：${file.name}`);
    if (file.kind === "dbc" && (!/\bBO_\s+\d+\s/.test(text) || !/\bSG_\s+/.test(text)))
        throw new Error(`DBC 无法识别报文或信号：${file.name}`);
}
/** Read all inputs before publishing a run-local immutable copy. */
async function freeze(ctx: ProcessContext, config: EffectiveConfiguration, auto?: {
    directory: string;
    manifestText: string;
}): Promise<{
    config: EffectiveConfiguration;
    files: ConfigurationResolution["actual"]["files"];
}> {
    const list = specs(config, !!auto);
    // type.h remains optional metadata, as in the original pipeline.
    const header = { kind: "vhal" as const, name: "type.h", root: config.basePaths!.proto_dir };
    if (await fs.stat(path.join(header.root, header.name)).then(s => s.isFile(), () => false))
        list.push(header);
    const loaded: {
        spec: FileSpec;
        source: string;
        bytes: Buffer;
    }[] = [];
    const manifest = auto ? JSON.parse(auto.manifestText) : undefined;
    for (const spec of list) {
        throwIfPipelineCancelled();
        const source = path.resolve(spec.root, spec.name);
        if (!auto && !(await fs.stat(source).then(stat => stat.isFile(), () => false)))
            continue;
        const real = await fs.realpath(source);
        if ((auto && real !== source) || !(await fs.stat(source)).isFile())
            throw new Error(`配置文件不是普通文件：${source}`);
        if (auto && (!real.startsWith(auto.directory + path.sep)))
            throw new Error("配置路径超出分支目录");
        const bytes = await fs.readFile(source);
        if (auto)
            validate(bytes, spec);
        if (auto) {
            const expected = manifest.files.find((f: {
                name: string;
                oid: string;
            }) => f.name === spec.name);
            if (!expected || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expected.oid) || gitBlobId(bytes, expected.oid.length) !== expected.oid)
                throw new Error(`同步文件与清单不一致：${spec.name}`);
        }
        loaded.push({ spec, source, bytes });
    }
    if (!loaded.length)
        throw new Error("用户配置未找到可冻结的文件");
    for (const item of loaded) {
        throwIfPipelineCancelled();
        if (digest(await fs.readFile(item.source)) !== digest(item.bytes))
            throw new Error("配置文件在读取期间变化");
    }
    if (auto && await fs.readFile(path.join(auto.directory, ".sync-state.json"), "utf8") !== auto.manifestText)
        throw new Error("同步快照在读取期间变化");
    const stage = await fs.mkdtemp(path.join(ctx.logRoot, ".config-stage-"));
    const snapshot = path.join(ctx.logRoot, "effective-config", randomUUID());
    await fs.mkdir(path.dirname(snapshot), { recursive: true });
    try {
        const files: ConfigurationResolution["actual"]["files"] = [];
        for (const item of loaded) {
            const dir = item.spec.kind === "vhal" ? "proto" : item.spec.kind;
            const target = path.join(stage, dir, item.spec.name);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, item.bytes);
            files.push({ kind: item.spec.kind, source: item.source, snapshot: path.join(snapshot, dir, item.spec.name), sha256: digest(item.bytes) });
        }
        if (auto)
            await validateDbcFiles(loaded.filter(item => item.spec.kind === "dbc").map(item => path.join(stage, "dbc", item.spec.name)));
        throwIfPipelineCancelled();
        await fs.rename(stage, snapshot);
        const basePaths = { json_dir: path.join(snapshot, "json"), dbc_dir: path.join(snapshot, "dbc"), proto_dir: path.join(snapshot, "proto") };
        const model = config.modelToFiles![config.carModel];
        const modelToFiles = { ...config.modelToFiles, [config.carModel]: { ...model, json: JSON.stringify(fileNames(model.json)), dbc: fileNames(model.dbc), proto: model.proto.trim() } };
        return { config: { ...config, basePaths, modelToFiles }, files };
    }
    finally {
        await fs.rm(stage, { recursive: true, force: true });
    }
}
function describe(r: ConfigurationResolution): string {
    return ["## 本次基础配置", `来源：${r.mode === "auto" ? "日志自动匹配（分支当前配置）" : "用户默认配置"}；${r.reason}`, `配置车型：${r.actual.carModel || "未识别"}；项目/分支组：${r.actual.projectName ?? "用户配置"}/${r.actual.branchGroupName ?? "用户配置"}`, `原运行车型：${r.requested.carModel || "未识别"}；工单提取车型：${r.evidence.ticketModel || "无"}；日志车型：${r.evidence.logModels.join(", ") || "无"}`, ...r.actual.files.map(f => `- ${f.kind}：${f.source}；本次快照=${f.snapshot}；SHA256=${f.sha256}`), ...r.warnings.map(w => `提示：${w}`), "采用分支当前配置不表示已经验证日志历史整套配置配套。"].join("\n");
}
export async function selectEffectiveConfiguration(ctx: ProcessContext, input: {
    root?: string;
    records: LogVersions[];
    extractDir: string;
    warnings?: string[];
}): Promise<ConfigurationResolution> {
    const root = path.resolve(input.root ?? process.cwd());
    const ticketModel = extractCarModelFromTitle(ctx.summary);
    const models = ctx.request.modelToFiles ?? {};
    const titleKey = resolveModelAlias(ticketModel, models);
    const manual: EffectiveConfiguration = { carModel: ctx.carModel || titleKey || "", basePaths: ctx.request.basePaths, modelToFiles: models };
    const result: ConfigurationResolution = { schemaVersion: 1, mode: "manual", reason: "", requested: { carModel: ctx.carModel, basePaths: ctx.request.basePaths, modelToFiles: ctx.request.modelToFiles }, evidence: { ticketModel, logModels: [], socVersions: input.records.map(r => r.socVersion), records: structuredClone(input.records) }, candidates: [], actual: { carModel: manual.carModel, files: [] }, warnings: [], summary: "" };
    ctx.analysisConfig = manual;
    try {
        throwIfPipelineCancelled();
        if (input.warnings?.length) {
            result.warnings.push(...input.warnings);
            throw new Error("日志版本提取不完整，回退用户配置");
        }
        if (!input.records.length)
            throw new Error("未取得 SOC/SCC，回退用户配置");
        if (!titleKey)
            throw new Error("工单车型没有唯一完整匹配当前规则组别名");
        const projects = await readProjects(path.join(root, "docs/project.json"));
        let candidates: Candidate[] | undefined;
        for (const record of input.records) {
            if (!record.socVersion || !record.sccVersions.length)
                throw new Error("SOC/SCC 配对缺失");
            const base = record.socVersion.replace(/_\d{4}\.\d+\.\d+(?:\.\d+)?$/, "");
            if (base === record.socVersion)
                throw new Error("SOC 构建版本无法识别");
            const found: Candidate[] = [];
            for (const project of projects)
                for (const branch of project.branches)
                    if (branch.repos.some(repo => repo.branchName === base))
                        found.push({ project, branch });
            if (!found.length)
                throw new Error("SOC 未匹配 project.json 中的分支");
            for (const candidate of found)
                if (!result.candidates.some(c => c.projectName === candidate.project.projectName && c.branchGroupName === candidate.branch.name))
                    result.candidates.push({ projectName: candidate.project.projectName, branchGroupName: candidate.branch.name });
            if (candidates && JSON.stringify(candidates.map(c => [c.project.projectName, c.branch.name])) !== JSON.stringify(found.map(c => [c.project.projectName, c.branch.name]))) {
                result.identityConflict = true;
                throw new Error("多个日志配对的项目/分支冲突");
            }
            candidates = found;
            for (const scc of record.sccVersions) {
                const token = scc.version.match(/_\d{4}\.\d+\.\d+(?:\.\d+)?_([A-Za-z0-9_-]+)$/)?.[1];
                if (!token)
                    throw new Error("SCC 车型无法解析");
                result.evidence.logModels.push(token);
                const key = resolveModelAlias(token, models);
                if (!key || key !== titleKey) {
                    if (key && key !== titleKey)
                        result.identityConflict = true;
                    throw new Error("日志车型别名未唯一命中或与工单车型冲突");
                }
            }
        }
        // The legacy detector used substring matching; only an exact title identity
        // can conflict with the explicitly configured alias, never a substring hit.
        if (ctx.carModel && ctx.carModel !== titleKey && ticketModel === ctx.carModel) {
            result.identityConflict = true;
            throw new Error("原规则组工单车型与日志配置车型冲突");
        }
        const scanned = await scanAndroidHashes(input.extractDir);
        if (scanned.warnings.length)
            throw new Error(scanned.warnings.join("；"));
        if (scanned.hashes.length) {
            const choice = chooseLatestHash(scanned.hashes);
            if (!choice.selected)
                throw new Error("日志 hash 存在歧义或日期无效");
            const commits = findCommits(projects, choice.selected.commitPrefix);
            if (commits.length !== 1)
                throw new Error("日志 hash 不能唯一定位项目/分支");
            result.evidence.hashReason = `${choice.selected.rawHash} → ${commits[0].projectName}/${commits[0].branchGroupName}；来源=${choice.selected.file}:${choice.selected.line}`;
            candidates = candidates!.filter(c => c.project.projectName === commits[0].projectName && c.branch.name === commits[0].branchGroupName);
            if (!candidates.length) {
                result.identityConflict = true;
                throw new Error("SOC 与日志 hash 的项目/分支冲突");
            }
        }
        if (candidates?.length !== 1)
            throw new Error("项目/分支组无法唯一确定");
        const chosen = candidates[0], directory = path.resolve(root, "configuration", chosen.project.projectName, chosen.branch.name);
        if (await fs.realpath(directory) !== directory)
            throw new Error("自动配置目录不能经过符号链接");
        const manifestText = await fs.readFile(path.join(directory, ".sync-state.json"), "utf8"), manifest = manifestSchema.parse(JSON.parse(manifestText));
        if (manifest.schemaVersion !== 1 || manifest.configurationKey !== branchKey(chosen.project, chosen.branch) || !Array.isArray(manifest.files) || typeof manifest.fingerprint !== "string" || !Array.isArray(manifest.repos) || manifest.repos.length !== chosen.branch.repos.length || manifest.repos.some((r: {
            repoName: string;
            repoPath: string;
            branchName: string;
            latestSyncedCommitId: string;
        }, i: number) => r.repoName !== chosen.branch.repos[i].repoName || r.repoPath !== chosen.branch.repos[i].repoPath || r.branchName !== chosen.branch.repos[i].branchName || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(r.latestSyncedCommitId)))
            throw new Error("同步清单缺失、身份不符或快照不完整");
        if (manifest.headerFile !== undefined) {
            relativeFile(manifest.headerFile);
            if (!manifest.files.some(f => f.name === manifest.headerFile))
                throw new Error("当前 VHAL 版本文件不在同步清单中");
        }
        const seenFiles = new Set<string>();
        for (const file of manifest.files) {
            throwIfPipelineCancelled();
            if (typeof file?.name !== "string" || typeof file.oid !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(file.oid) || seenFiles.has(file.name))
                throw new Error("同步清单文件记录无效");
            relativeFile(file.name);
            seenFiles.add(file.name);
            const source = path.resolve(directory, file.name);
            if (await fs.realpath(source) !== source || !(await fs.lstat(source)).isFile() || gitBlobId(await fs.readFile(source), file.oid.length) !== file.oid)
                throw new Error(`同步快照文件缺失或校验失败：${file.name}`);
        }
        const selected: EffectiveConfiguration = { carModel: titleKey, basePaths: { json_dir: directory, dbc_dir: directory, proto_dir: directory }, modelToFiles: models };
        const frozen = await freeze(ctx, selected, { directory, manifestText });
        ctx.analysisConfig = frozen.config;
        result.mode = "auto";
        result.reason = "已按日志唯一匹配规则组车型并采用分支当前完整配置";
        result.actual = { carModel: titleKey, projectName: chosen.project.projectName, branchGroupName: chosen.branch.name, directory, manifestFingerprint: manifest.fingerprint, syncedAt: manifest.syncedAt, targetId: manifest.targetId, headerFile: manifest.headerFile, repos: manifest.repos.map((r: {
                repoName: string;
                repoPath: string;
                branchName: string;
                latestSyncedCommitId: string;
                rtcids?: string[];
            }) => ({ repoName: r.repoName, repoPath: r.repoPath, gitBranchName: r.branchName, commitid: r.latestSyncedCommitId, rtcids: r.rtcids })), files: frozen.files };
    }
    catch (error) {
        throwIfPipelineCancelled();
        result.reason = String(error instanceof Error ? error.message : error);
        result.warnings.push("自动匹配未完成，整体回退用户默认路径与文件集合，不混合来源");
        try {
            const frozen = await freeze(ctx, manual);
            ctx.analysisConfig = frozen.config;
            result.actual.files = frozen.files;
        }
        catch (fallbackError) {
            throwIfPipelineCancelled();
            result.warnings.push(`用户配置未能完整冻结，保持原有分析能力：${String(fallbackError instanceof Error ? fallbackError.message : fallbackError)}`);
            ctx.analysisConfig = manual;
        }
    }
    result.summary = describe(result);
    ctx.configurationResolution = result;
    ctx.stages.CONFIGURATION_RESOLUTION = `${result.mode}：${result.reason}`;
    await fs.writeFile(path.join(ctx.logRoot, "effective-config-resolution.json"), JSON.stringify(result, null, 2));
    await fs.writeFile(path.join(ctx.logRoot, "effective-config-check.md"), result.summary);
    ctx.logger.log("CONFIGURATION_RESOLUTION", result.summary);
    return result;
}
