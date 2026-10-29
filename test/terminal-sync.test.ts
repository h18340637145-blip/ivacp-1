import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runTerminalSync } from "@/server/terminal/sync/runner";
import { gitBlobId, type SyncReader } from "@/server/terminal/sync/remote";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "sync-store-")); roots.push(root); await fs.mkdir(path.join(root, "docs"));
 const repo = { repoName: "r", repoPath: "repo", branchName: "local", custom: "preserve" };
 await fs.writeFile(path.join(root, "docs/project.json"), JSON.stringify(["p1", "p2"].map(projectName => ({ projectName, mainPath: "~/remote", scriptPath: "unused", custom: 1, branches: [{ name: "main", repos: [repo] }] }))));
 const bytes = new Map<string, Buffer>(); let current = "a".repeat(40);
 const makeFile = (name: string, content: string, source = `tools/json/deep/${name}`) => { const b = Buffer.from(content), oid = gitBlobId(b); bytes.set(oid,b); return { name, source, oid, repoDir: "repo" }; };
 let files = [makeFile("any.json", "one"), makeFile("type.h", "header", "tools/scripts/deep/type.h")];
 const reader: SyncReader = { snapshot: async () => ({ commitid: current, rtcids: ["RTC1-3103704"], files, warnings: [] }), readFile: vi.fn(async file => bytes.get(file.oid)!) };
 return { root, reader, makeFile, set: (commit: string, next = files) => { current = commit; files = next; }, output: path.join(root, "configuration/p1/main") };
}
it("syncs every project; skips complete snapshots; repairs missing files; replaces and removes managed files on changed commits", async () => {
 const f = await fixture(); const run = () => runTerminalSync({ root: f.root, targetId: "t", reader: f.reader });
 expect((await run()).branches.map(b => b.status)).toEqual(["updated", "updated"]);
 expect(await fs.readdir(f.output)).toEqual([".sync-state.json", "any.json", "type.h"]);
 expect((await run()).branches[0].status).toBe("unchanged"); expect(f.reader.readFile).toHaveBeenCalledTimes(4);
 await fs.unlink(path.join(f.output, "type.h")); expect((await run()).branches[0].status).toBe("repaired");
 await fs.writeFile(path.join(f.output,"unmanaged.txt"), "keep");
 f.set("b".repeat(40), [f.makeFile("any.json", "two")]);
 expect((await run()).branches[0].status).toBe("updated");
 expect(await fs.readFile(path.join(f.output, "any.json"), "utf8")).toBe("two");
 expect(await fs.readFile(path.join(f.output, "bak/any.json"), "utf8")).toBe("one");
 expect(await fs.stat(path.join(f.output, "type.h")).catch(() => null)).toBeNull();
 expect(await fs.readFile(path.join(f.output, "unmanaged.txt"), "utf8")).toBe("keep");
 const saved = JSON.parse(await fs.readFile(path.join(f.root,"docs/project.json"),"utf8"));
 expect(saved[0].branches[0].repos[0]).toMatchObject({ custom: "preserve", "commid-rtcids-map": [{ commitid: "a".repeat(40), rtcids: ["RTC1-3103704"] }, { commitid: "b".repeat(40), rtcids: ["RTC1-3103704"] }] });
 f.set("a".repeat(40), [f.makeFile("any.json", "one")]); expect((await run()).branches[0].status).toBe("updated");
 expect(JSON.parse(await fs.readFile(path.join(f.root,"docs/project.json"),"utf8"))[0].branches[0].repos[0]["commid-rtcids-map"]).toHaveLength(2);
});
it("backs up flattened name conflicts, later files win, and failed downloads preserve the complete prior branch", async () => {
 const f = await fixture(); const run = () => runTerminalSync({ root:f.root,targetId:"t",reader:f.reader }); await run();
 f.set("b".repeat(40), [f.makeFile("any.json","two","tools/json/a/any.json"),f.makeFile("any.json","three","tools/json/b/any.json")]);
 expect((await run()).branches[0].backupCount).toBeGreaterThan(0);
 expect(await fs.readFile(path.join(f.output,"any.json"),"utf8")).toBe("three");
 expect(await fs.readFile(path.join(f.output,"bak/any.json"),"utf8")).toBe("two");
 f.set("c".repeat(40)); const original=f.reader.readFile; f.reader.readFile=async () => {throw new Error("transfer failed")};
 expect((await run()).branches.every(b=>b.status==="failed")).toBe(true);
 expect(await fs.readFile(path.join(f.output,"any.json"),"utf8")).toBe("three"); f.reader.readFile=original;
 const saved=JSON.parse(await fs.readFile(path.join(f.root,"docs/project.json"),"utf8")); expect(saved[0].branches[0].repos[0]["commid-rtcids-map"]).toHaveLength(2);
});
it("rejects overlapping runs and traversal configuration, releases the lock on errors", async () => {
 const f=await fixture(); let release!:()=>void; const pending=new Promise<void>(resolve=>{release=resolve});
 let entered!:()=>void; const started=new Promise<void>(resolve=>{entered=resolve});
 const snapshot=f.reader.snapshot; f.reader.snapshot=async (...a) => {entered();await pending;return snapshot(...a)};
 const first=runTerminalSync({root:f.root,targetId:"t",reader:f.reader});
 await started;
 await expect(runTerminalSync({root:f.root,targetId:"t",reader:f.reader})).rejects.toThrow("同步任务"); release();await first;
 const config=JSON.parse(await fs.readFile(path.join(f.root,"docs/project.json"),"utf8")); config[0].projectName="../escape";await fs.writeFile(path.join(f.root,"docs/project.json"),JSON.stringify(config));
 await expect(runTerminalSync({root:f.root,targetId:"t",reader:f.reader})).rejects.toThrow("目录名");
});

it("recovers a published snapshot with missing files and a leftover previous directory", async()=>{
 const f=await fixture();const run=()=>runTerminalSync({root:f.root,targetId:"t",reader:f.reader});await run();
 await fs.cp(f.output,path.join(f.root,"configuration/p1/.main.sync-previous"),{recursive:true});
 await fs.unlink(path.join(f.output,"any.json"));await fs.writeFile(path.join(f.output,"local.txt"),"preserve");
 expect((await run()).branches[0].status).toBe("repaired");expect(await fs.readFile(path.join(f.output,"any.json"),"utf8")).toBe("one");
 const entries=await fs.readdir(path.join(f.root,"configuration/p1"));const damaged=entries.find(e=>e.includes(".sync-damaged-"))!;
 expect(await fs.readFile(path.join(f.root,"configuration/p1",damaged,"local.txt"),"utf8")).toBe("preserve");
});
it("rejects corrupt recovery identities without polluting commit history", async()=>{
 const f=await fixture();const run=()=>runTerminalSync({root:f.root,targetId:"t",reader:f.reader});await run();
 await fs.cp(f.output,path.join(f.root,"configuration/p1/.main.sync-previous"),{recursive:true});
 const file=path.join(f.output,".sync-state.json"),state=JSON.parse(await fs.readFile(file,"utf8"));state.repos[0].latestSyncedCommitId="bad";await fs.writeFile(file,JSON.stringify(state));
 expect((await run()).branches[0].status).toBe("failed");
 const config=JSON.parse(await fs.readFile(path.join(f.root,"docs/project.json"),"utf8"));expect(config[0].branches[0].repos[0]["commid-rtcids-map"]).toHaveLength(1);
});

it("keeps a successful publication when old backup cleanup fails, and recovers on the next run", async()=>{
 const f=await fixture();const run=()=>runTerminalSync({root:f.root,targetId:"t",reader:f.reader});await run();f.set("b".repeat(40),[f.makeFile("any.json","new")]);
 const remove=fs.rm.bind(fs);const spy=vi.spyOn(fs,"rm").mockImplementation(async (file,...rest)=>{
  if(String(file).endsWith(".main.sync-previous"))throw new Error("simulated cleanup failure");return remove(file,...rest);
 });
 let report;try{report=await run()}finally{spy.mockRestore()}
 expect(report.branches[0].status).toBe("updated");expect(report.branches[0].repos[0].warnings.join(" ")).toContain("旧恢复备份");
 expect(await fs.readFile(path.join(f.output,"any.json"),"utf8")).toBe("new");
 expect((await run()).branches[0].status).toBe("unchanged");
 expect(await fs.stat(path.join(f.root,"configuration/p1/.main.sync-previous")).catch(()=>null)).toBeNull();
});
it("isolates directory failures to one project and refuses local symlink escapes",async()=>{
 const f=await fixture();const outside=path.join(f.root,"outside");await fs.mkdir(outside);await fs.mkdir(path.join(f.root,"configuration"));await fs.symlink(outside,path.join(f.root,"configuration/p1"));
 const report=await runTerminalSync({root:f.root,targetId:"t",reader:f.reader});expect(report.branches.map(b=>b.status)).toEqual(["failed","updated"]);expect(await fs.readdir(outside)).toEqual([]);
});
it("detects configuration changes during transfer and preserves existing snapshot/history",async()=>{
 const f=await fixture();const run=()=>runTerminalSync({root:f.root,targetId:"t",reader:f.reader});await run();f.set("b".repeat(40),[f.makeFile("new.json","new")]);
 const read=f.reader.readFile;let changed=false;
 f.reader.readFile=async file=>{if(!changed){changed=true;const configFile=path.join(f.root,"docs/project.json"),config=JSON.parse(await fs.readFile(configFile,"utf8"));config[0].branches[0].repos[0].branchName="changed";await fs.writeFile(configFile,JSON.stringify(config));}return read(file)};
 const report=await run();expect(report.branches[0].status).toBe("failed");expect(report.branches[0].error).toContain("配置已变化");expect(await fs.readFile(path.join(f.output,"any.json"),"utf8")).toBe("one");
});

it("never follows a lock symlink or creates its outside target",async()=>{
 const f=await fixture();await fs.mkdir(path.join(f.root,"configuration"));const outside=path.join(f.root,"outside-lock");await fs.symlink(outside,path.join(f.root,"configuration/.sync-lock"));
 await expect(runTerminalSync({root:f.root,targetId:"t",reader:f.reader})).rejects.toThrow();
 expect(await fs.lstat(outside).catch(()=>null)).toBeNull();
});
it("does not perform crash-recovery writes for an already canceled task",async()=>{
 const f=await fixture();const run=()=>runTerminalSync({root:f.root,targetId:"t",reader:f.reader});await run();
 await fs.cp(f.output,path.join(f.root,"configuration/p1/.main.sync-previous"),{recursive:true});
 const file=path.join(f.root,"docs/project.json"),config=JSON.parse(await fs.readFile(file,"utf8"));delete config[0].branches[0].repos[0]["commid-rtcids-map"];await fs.writeFile(file,JSON.stringify(config));
 const controller=new AbortController();controller.abort(new Error("canceled"));
 const report=await runTerminalSync({root:f.root,targetId:"t",reader:f.reader,signal:controller.signal});expect(report.branches.every(b=>b.status==="failed")).toBe(true);
 expect(JSON.parse(await fs.readFile(file,"utf8"))[0].branches[0].repos[0]["commid-rtcids-map"]).toBeUndefined();
 expect(await fs.stat(path.join(f.root,"configuration/p1/.main.sync-previous"))).toBeTruthy();
});

it("persists VHAL from the final winning type.h, restores it on reload, and clears invalid/removed versions",async()=>{
 const {loadTerminalProjects}=await import("@/server/terminal/projects");
 const f=await fixture();const run=()=>runTerminalSync({root:f.root,targetId:"t",reader:f.reader});
 f.set("a".repeat(40),[f.makeFile("type.h",'#define VER_PRO_CFG "82552235"',"tools/scripts/a/type.h"),f.makeFile("type.h",'#define VER_PRO_CFG\t"82552236"',"tools/scripts/b/type.h")]);
 const first=await run();expect(first.branches[0].vhal).toEqual({targetId:"t",raw:"82552236",platform:"8255",version:"22.36"});
 const manifestFile=path.join(f.output,".sync-state.json"),manifest=JSON.parse(await fs.readFile(manifestFile,"utf8"));expect(manifest.vhal.raw).toBe("82552236");
 expect((await loadTerminalProjects(f.root))[0].branches[0].syncedVhal?.raw).toBe("82552236");
 delete manifest.vhal;await fs.writeFile(manifestFile,JSON.stringify(manifest));
 expect((await run()).branches[0].vhal?.raw).toBe("82552236");expect(JSON.parse(await fs.readFile(manifestFile,"utf8")).vhal.raw).toBe("82552236");
 f.set("b".repeat(40),[f.makeFile("type.h","invalid")]);expect((await run()).branches[0].vhal).toBeUndefined();
 expect((await loadTerminalProjects(f.root))[0].branches[0].syncedVhal).toBeUndefined();
 f.set("c".repeat(40),[]);expect((await run()).branches[0].vhal).toBeUndefined();
});


it("merges all recent commits and corrects RTC mappings even when files are unchanged", async () => {
 const f = await fixture();
 const run = () => runTerminalSync({ root: f.root, targetId: "t", reader: f.reader });
 await run();
 const snapshot = f.reader.snapshot;
 const history = [{ commitid: "a".repeat(40), rtcids: ["RTC1-42", "RTC1-43"] }, { commitid: "b".repeat(40), rtcids: [] }];
 f.reader.snapshot = async (...args) => ({ ...await snapshot(...args), history });
 expect((await run()).branches[0].status).toBe("unchanged");
 const saved = JSON.parse(await fs.readFile(path.join(f.root, "docs/project.json"), "utf8"));
 expect(saved[0].branches[0].repos[0]["commid-rtcids-map"]).toEqual(history);
 expect(saved[1].branches[0].repos[0]["commid-rtcids-map"]).toEqual(history);
});

it("archives changed type.h with the pre-sync mapping and old header version", async () => {
 const f = await fixture();
 const run = () => runTerminalSync({ root: f.root, targetId: "t", reader: f.reader });
 const old = '#define VER_PRO_CFG "82552236"';
 f.set("a".repeat(40), [f.makeFile("type.h", old)]);
 await run();
 // The config mapping is the naming authority, rather than the incoming Git log.
 const configFile = path.join(f.root, "docs/project.json");
 const config = JSON.parse(await fs.readFile(configFile, "utf8"));
 config[0].branches[0].repos[0]["commid-rtcids-map"][0].rtcids = ["RTC1-42", "RTC1-43"];
 await fs.writeFile(configFile, JSON.stringify(config));
 f.set("b".repeat(40), [f.makeFile("type.h", '#define VER_PRO_CFG "82552237"')]);
 expect((await run()).branches[0].status).toBe("updated");
 const archive = path.join(f.output, "bak", "a".repeat(40) + "_RTC1-42_RTC1-43_82552236");
 expect(await fs.readFile(archive, "utf8")).toBe(old);
 expect(await fs.readFile(path.join(f.output, "type.h"), "utf8")).toContain("82552237");
 expect((await run()).branches[0].status).toBe("unchanged");
 expect(await fs.readdir(path.join(f.output, "bak"))).toEqual([path.basename(archive)]);
});


it("keeps old header archives across later syncs and does not archive identical content", async () => {
 const f = await fixture();
 const run = () => runTerminalSync({ root: f.root, targetId: "t", reader: f.reader });
 const header = (version: string) => f.makeFile("type.h", `#define VER_PRO_CFG "${version}"`);
 f.set("a".repeat(40), [header("82552236")]); await run();
 f.set("b".repeat(40), [header("82552236")]); await run();
 expect(await fs.stat(path.join(f.output, "bak")).catch(() => null)).toBeNull();
 f.set("c".repeat(40), [header("82552237")]); await run();
 f.set("d".repeat(40), [header("82552238")]); await run();
 expect(await fs.readdir(path.join(f.output, "bak"))).toEqual([
   "b".repeat(40) + "_RTC1-3103704_82552236", "c".repeat(40) + "_RTC1-3103704_82552237",
 ]);
});

it("uses the previous winning repository for type.h naming when another repo replaces it", async () => {
 const f = await fixture();
 const configFile = path.join(f.root, "docs/project.json");
 const config = JSON.parse(await fs.readFile(configFile, "utf8"));
 for (const project of config) project.branches[0].repos.push({ repoName: "other", repoPath: "other", branchName: "local" });
 await fs.writeFile(configFile, JSON.stringify(config));
 const run = () => runTerminalSync({ root: f.root, targetId: "t", reader: f.reader });
 let next = false;
 f.reader.snapshot = async (_project, repo) => ({
   commitid: (repo.repoName === "r" ? "a" : "b").repeat(40), rtcids: [repo.repoName === "r" ? "RTC1-1" : "RTC1-2"], warnings: [],
   files: repo.repoName === (next ? "other" : "r") ? [f.makeFile("type.h", `#define VER_PRO_CFG "${next ? "82552237" : "82552236"}"`)] : [],
 });
 await run(); next = true;
 expect((await run()).branches[0].status).toBe("updated");
 expect(await fs.readFile(path.join(f.output, "bak", "a".repeat(40) + "_RTC1-1_82552236"), "utf8")).toContain("82552236");
});

it("leaves the old snapshot and config intact if type.h archive name is already used by different bytes", async () => {
 const f = await fixture();
 const run = () => runTerminalSync({ root: f.root, targetId: "t", reader: f.reader });
 f.set("a".repeat(40), [f.makeFile("type.h", '#define VER_PRO_CFG "82552236"')]); await run();
 await fs.mkdir(path.join(f.output, "bak"));
 const archive = path.join(f.output, "bak", "a".repeat(40) + "_RTC1-3103704_82552236");
 await fs.writeFile(archive, "previous archive");
 const before = await fs.readFile(path.join(f.root, "docs/project.json"), "utf8");
 f.set("b".repeat(40), [f.makeFile("type.h", '#define VER_PRO_CFG "82552237"')]);
 expect((await run()).branches[0].status).toBe("failed");
 expect(await fs.readFile(path.join(f.output, "type.h"), "utf8")).toContain("82552236");
 expect(await fs.readFile(archive, "utf8")).toBe("previous archive");
 // The independent second project can still succeed.
 const saved = JSON.parse(await fs.readFile(path.join(f.root, "docs/project.json"), "utf8"));
 expect(saved[0]).toEqual(JSON.parse(before)[0]);
});
