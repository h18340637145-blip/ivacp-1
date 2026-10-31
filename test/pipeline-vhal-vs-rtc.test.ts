import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveVhal } from "@/server/pipeline/version-vhal/resolution";
import { runVersionVhalCheck, summarizeVersionVhal } from "@/server/pipeline/process/version-vhal-stage";
import { versionVhalCheckSchema } from "@/domain/analysis/version-vhal";
import { createPipelineMetrics } from "@/server/pipeline/metrics";
import { readSavedProcessResponse } from "@/server/meegle/saved-response";
import type { ProcessContext } from "@/server/pipeline/process/context";
import { versionVhalFixture } from "./helpers/version-vhal-fixture";

const sourceCommit = "82c3bd19de7003f4f2de20cbf6a9a8be6ccf7de1";
const vsCommit = "a0ffcea6b5db76730bde833e742ba01192befa6a";
const rtc = "RTC1-3103705";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
const mapping = (commitid = vsCommit, rtcids = [rtc]) => ({ commitid, rtcids });
const repo = (repoName: string, entries = [mapping()]) => ({ repoName, repoPath: `path/${repoName}`, branchName: `${repoName}-git-branch`, "commid-rtcids-map": entries });
async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vhal-vs-rtc-")); dirs.push(root);
    const logs = path.join(root, "android");
    const dir = path.join(root, "configuration/chery-8255/t1x-sop");
    const excel = path.join(root, "configuration/chery-8255/vhal/vhal2.2.36/CHERY_8255_VHAL_SIGNAL_V2.2.36.xlsx");
    await fs.mkdir(logs); await fs.mkdir(path.join(root, "docs"));
    await fs.mkdir(path.join(dir, "bak"), { recursive: true });
    await fs.mkdir(path.dirname(excel), { recursive: true }); await fs.writeFile(excel, "placeholder");
    await fs.writeFile(path.join(logs, "logcat.txt"), "BoschVehicleHalHash 82c3bd1-2026-10-20\n");
    const branch = { name: "t1x-sop", repos: [repo("automotive-custom", [mapping(sourceCommit)]), repo("vs")] };
    const projects = [{ projectName: "chery-8255", branches: [branch] }];
    const save = () => fs.writeFile(path.join(root, "docs/project.json"), JSON.stringify(projects));
    const archive = (commit = vsCommit, sub = "bak", code = "82552236", suffix = "") => fs.writeFile(path.join(dir, sub, `${commit}_${rtc}_${code}${suffix}`), "");
    await save();
    return { root, logs, dir, excel, branch, projects, save, archive };
}

describe("RTC association to VS archive", () => {
    it.each(["", "bak"])("uses the VS commit archive in %s and preserves source and association evidence", async sub => {
        const f = await fixture(); await f.archive(vsCommit, sub, "82552236", sub ? "" : ".h");
        const r = await resolveVhal(f.root, f.logs);
        expect(r).toMatchObject({ status: "ok", version: "2.2.36", excel: f.excel,
            candidates: [{ repoName: "automotive-custom", commitid: sourceCommit }],
            vsAssociation: { status: "ok", unmatchedRtcids: [], candidates: [{ repoName: "vs", commitid: vsCommit, matchedRtcids: [rtc] }], selected: { commitid: vsCommit } },
        });
        expect(r.archives).toHaveLength(1);
    });
    it("never falls back to the source commit archive", async () => {
        const f = await fixture(); await f.archive(sourceCommit);
        expect(await resolveVhal(f.root, f.logs)).toMatchObject({ status: "unknown", archives: [], vsAssociation: { selected: { commitid: vsCommit } } });
    });
    it("rejects archive prefixes shared by another VS commit even outside the matched RTC candidates", async () => {
        const f = await fixture();
        f.branch.repos[1]["commid-rtcids-map"].push(mapping("a0ffcea2222222222222222222222222222222222", ["RTC1-other"]));
        await f.save(); await f.archive("a0ffcea");
        expect(await resolveVhal(f.root, f.logs)).toMatchObject({ status: "ambiguous", vsAssociation: { selected: { commitid: vsCommit } }, archives: [{ commitCandidates: [vsCommit, "a0ffcea2222222222222222222222222222222222"] }] });
    });
    it("accepts a short archive prefix only when unique within the VS repository", async () => {
        const f = await fixture(); await f.archive("a0ffcea");
        expect(await resolveVhal(f.root, f.logs)).toMatchObject({ status: "ok", version: "2.2.36" });
    });
    it("stays in the same project and branches entry and matches complete RTC members", async () => {
        const f = await fixture();
        f.branch.repos[1]["commid-rtcids-map"] = [mapping(vsCommit, [rtc + "0"])];
        f.projects[0].branches.push({ name: "other", repos: [repo("vs")] });
        f.projects.push({ projectName: "other-project", branches: [{ name: "t1x-sop", repos: [repo("vs")] }] });
        await f.save(); await f.archive();
        expect(await resolveVhal(f.root, f.logs)).toMatchObject({ status: "unknown", vsAssociation: { status: "unknown", candidates: [], unmatchedRtcids: [rtc] } });
    });
    it("deduplicates multiple RTC paths to one VS commit and warns about unmatched RTC", async () => {
        const f = await fixture();
        f.branch.repos[0]["commid-rtcids-map"][0].rtcids = [rtc, "RTC1-2", "RTC1-missing"];
        f.branch.repos[1]["commid-rtcids-map"] = [mapping(vsCommit, [rtc]), mapping(vsCommit.toUpperCase(), ["RTC1-2"])];
        await f.save(); await f.archive();
        expect(await resolveVhal(f.root, f.logs)).toMatchObject({ status: "ok", vsAssociation: { status: "ok", candidates: [{ commitid: vsCommit, matchedRtcids: [rtc, "RTC1-2"] }], unmatchedRtcids: ["RTC1-missing"] } });
    });
    it("keeps different VS commits ambiguous even if archives carry the same version", async () => {
        const f = await fixture(); const other = "bbbbbbb123456789";
        f.branch.repos[1]["commid-rtcids-map"].push(mapping(other));
        await f.save(); await f.archive(); await f.archive(other);
        expect(await resolveVhal(f.root, f.logs)).toMatchObject({ status: "ambiguous", archives: [], vsAssociation: { status: "ambiguous", candidates: [{ commitid: vsCommit }, { commitid: other }] } });
    });
    it.each(["empty RTC", "blank RTC", "missing vs", "duplicate vs", "source is vs"])("handles %s without bypassing uniqueness", async scenario => {
        const f = await fixture();
        if (scenario === "empty RTC") f.branch.repos[0]["commid-rtcids-map"][0].rtcids = [];
        if (scenario === "blank RTC") f.branch.repos[0]["commid-rtcids-map"][0].rtcids = [" "];
        if (scenario === "missing vs") f.branch.repos.pop();
        if (scenario === "duplicate vs") f.branch.repos.push(repo("vs", [mapping("ccccccc123456")]));
        if (scenario === "source is vs") { f.branch.repos = [repo("vs", [mapping(sourceCommit), mapping(vsCommit)])]; }
        await f.save(); await f.archive();
        const status = ["duplicate vs", "source is vs"].includes(scenario) ? "ambiguous" : "unknown";
        const r = await resolveVhal(f.root, f.logs);
        expect(r).toMatchObject({ status, vsAssociation: { status } });
        expect(r.archives).toEqual([]);
        expect(r.reason.length).toBeGreaterThan(0);
    });
    it("retains initial prefix ambiguity before any VS selection", async () => {
        const f = await fixture(); f.projects[0].branches.push({ ...f.branch, name: "other" }); await f.save();
        const r = await resolveVhal(f.root, f.logs);
        expect(r).toMatchObject({ status: "ambiguous", candidates: [{ branchGroupName: "t1x-sop" }, { branchGroupName: "other" }] });
        expect(r).not.toHaveProperty("vsAssociation.selected");
    });
    it("keeps schema and saved-response recovery evidence while accepting legacy results", async () => {
        const f = await fixture(); await f.archive(); const legacy = versionVhalFixture();
        expect(versionVhalCheckSchema.parse(legacy)).toEqual(legacy);
        const resolution = await resolveVhal(f.root, f.logs);
        const check = { ...legacy, resolution };
        await fs.writeFile(path.join(f.root, "process-response.json"), JSON.stringify({ issueKey: "TEST-1", replyText: "结论", model: "test", versionVhalCheck: check }));
        const restored = await readSavedProcessResponse(f.root, "TEST-1", "结论");
        expect(restored?.versionVhalCheck).toMatchObject({ resolution: { vsAssociation: { selected: { commitid: vsCommit } } } });
        const summary = summarizeVersionVhal(check);
        expect(summary).toContain(sourceCommit); expect(summary).toContain(vsCommit); expect(summary).toContain(rtc);
    });
    it("persists association and unmatched RTC warnings in the shared stage", async () => {
        const f = await fixture(); f.branch.repos[0]["commid-rtcids-map"][0].rtcids.push("RTC1-missing"); await f.save(); await f.archive();
        const ctx = { issueKey: "TEST-1", logRoot: f.root, request: { source: "meegle", runId: "rtc-run" }, carModel: "D01", stages: {}, logger: { log: vi.fn() }, metrics: createPipelineMetrics({ issueKey: "TEST-1", summary: "", ruleGroupId: "g", ruleGroupName: "g", carModel: "D01", attachRoot: f.root, logRoot: f.root }) } as unknown as ProcessContext;
        const check = await runVersionVhalCheck(ctx, { records: [], extractDir: f.logs, tokens: [], root: f.root });
        expect(check.warnings.join(" ")).toContain("RTC1-missing");
        const stored = JSON.parse(await fs.readFile(path.join(f.root, "vhal-version-resolution.json"), "utf8"));
        expect(stored).toMatchObject({ runId: "rtc-run", vsAssociation: { selected: { commitid: vsCommit } } });
        expect(await fs.readFile(path.join(f.root, "version-vhal-check.md"), "utf8")).toContain(vsCommit);
    });
});
