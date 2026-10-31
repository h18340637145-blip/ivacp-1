vi.mock("@/server/pipeline/validate-dbc",()=>({validateDbcFiles:vi.fn(async()=>undefined)}));
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectEffectiveConfiguration } from "@/server/pipeline/process/effective-configuration";
import { configurationFor } from "@/server/pipeline/process/effective-context";
import { gitBlobId } from "@/server/terminal/sync/remote";
import type { ProcessContext } from "@/server/pipeline/process/context";
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function setup() {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"auto-config-"));roots.push(root);
 const directory=path.join(root,"configuration/p/sop"),logRoot=path.join(root,"run"),logs=path.join(root,"logs");
 await fs.mkdir(directory,{recursive:true});await fs.mkdir(path.join(root,"docs"));await fs.mkdir(logRoot);await fs.mkdir(logs);
 const content:Record<string,string>={"config.json":'[{"prop":"Test","up_signal":"A"}]',"car_T1J_FL3.dbc":'VERSION ""\nBO_ 1 Message: 8 ECU\n SG_ A : 0|8@1+ (1,0) [0|255] "" ECU\n',"vehicle.proto":"enum Property_ID { Test = 1; }","type.h":'#define VER_PRO_CFG "82552238"'};
 const manifest={schemaVersion:1,targetId:"t",fingerprint:"current",configurationKey:JSON.stringify(["p","~/workspace","sop",[["api-public","api","branch_sop"],["vs","vs","vehicle_sop"]]]),syncedAt:"2026-10-31",files:Object.entries(content).map(([name,bytes])=>({name,oid:gitBlobId(Buffer.from(bytes))})),repos:[{repoName:"api-public",repoPath:"api",branchName:"branch_sop",latestSyncedCommitId:"a".repeat(40)},{repoName:"vs",repoPath:"vs",branchName:"vehicle_sop",latestSyncedCommitId:"b".repeat(40)}]};
 for(const [file,bytes]of Object.entries(content))await fs.writeFile(path.join(directory,file),bytes);
 await fs.writeFile(path.join(directory,".sync-state.json"),JSON.stringify(manifest));
 const project=[{projectName:"p",mainPath:"~/workspace",branches:[{name:"sop",repos:[{repoName:"api-public",repoPath:"api",branchName:"branch_sop"},{repoName:"vs",repoPath:"vs",branchName:"vehicle_sop","commid-rtcids-map":[{commitid:"b".repeat(40),rtcids:["RTC1-1"]}]}]}]}];
 await fs.writeFile(path.join(root,"docs/project.json"),JSON.stringify(project));
 const models={"T1J-FL3-8255":{aliases:["T1JFL3"],json:"config.json",dbc:["car_T1J_FL3.dbc"],proto:"vehicle.proto"}};
 const ctx={request:{issueKey:"TEST-1",summary:"[T1JFL3] issue",ruleGroupId:"g",rawData:{},prompts:{},basePaths:{json_dir:path.join(root,"manual"),dbc_dir:path.join(root,"manual"),proto_dir:path.join(root,"manual")},modelToFiles:models},summary:"[T1JFL3] issue",carModel:"",logRoot,logger:{log:vi.fn()},stages:{}} as unknown as ProcessContext;
 const records=[{buildInfo:"cycle/Buildinfo.txt",socVersion:"branch_sop_2026.44.5",sccVersions:[{file:"cycle/Scc.dlt",version:"ES11_2026.44.5_T1JFL3"}]}];
 return {root,directory,ctx,records,content,manifest,project,logs};
}
describe("effective branch configuration",()=>{
 it("uses current branch files through exact group aliases and freezes bytes without changing request or run identity",async()=>{
  const f=await setup(),original=structuredClone(f.ctx.request);
  const result=await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs});
  expect(result.mode).toBe("auto");expect(result.actual.carModel).toBe("T1J-FL3-8255");
  expect(f.ctx.request).toEqual(original);expect(f.ctx.carModel).toBe("");
  const effective=configurationFor(f.ctx);expect(effective.basePaths?.json_dir).toContain(f.ctx.logRoot);
  const frozen=path.join(effective.basePaths!.json_dir,"config.json");
  await fs.writeFile(path.join(f.directory,"config.json"),"changed");expect(await fs.readFile(frozen,"utf8")).toBe(f.content["config.json"]);
  expect(result.actual.manifestFingerprint).toBe("current");
  expect(JSON.parse(await fs.readFile(path.join(f.ctx.logRoot,"effective-config-resolution.json"),"utf8"))).toMatchObject({mode:"auto"});
 });
 it.each(["missing versions","unknown alias","case alias","missing proto","bad json","incomplete model","conflicting title","invalid manifest","tampered file"])("falls back as a whole: %s",async scenario=>{
  const f=await setup();let records=f.records;
  if(scenario==="missing versions")records=[];
  if(scenario==="unknown alias")f.ctx.request.modelToFiles!["T1J-FL3-8255"].aliases=[];
  if(scenario==="case alias")records[0].sccVersions[0].version="ES11_2026.44.5_t1jfl3";
  if(scenario==="missing proto")await fs.rm(path.join(f.directory,"vehicle.proto"));
  if(scenario==="bad json"){await fs.writeFile(path.join(f.directory,"config.json"),"bad");f.manifest.files[0].oid=gitBlobId(Buffer.from("bad"));await fs.writeFile(path.join(f.directory,".sync-state.json"),JSON.stringify(f.manifest));}
  if(scenario==="incomplete model")f.ctx.request.modelToFiles!["T1J-FL3-8255"].proto="";
  if(scenario==="conflicting title"){f.ctx.request.modelToFiles!.other={aliases:["Other"],json:"other.json",dbc:[],proto:""};f.ctx.summary="[Other] issue";}
  if(scenario==="invalid manifest")await fs.rm(path.join(f.directory,".sync-state.json"));
  if(scenario==="tampered file")await fs.writeFile(path.join(f.directory,"config.json"),"tampered");
  const result=await selectEffectiveConfiguration(f.ctx,{root:f.root,records,extractDir:f.logs});
  expect(result.mode).toBe("manual");expect(result.reason).toBeTruthy();
  expect(configurationFor(f.ctx).basePaths).toEqual(f.ctx.request.basePaths);
  expect(configurationFor(f.ctx).modelToFiles).toEqual(f.ctx.request.modelToFiles);
 });
 it("uses unique hash evidence to disambiguate shared SOC branches without selecting historical files",async()=>{
  const f=await setup();f.project[0].branches.push({name:"other",repos:[{repoName:"api-public",repoPath:"api",branchName:"branch_sop"},{repoName:"vs",repoPath:"vs",branchName:"other_vs"}]});
  await fs.writeFile(path.join(f.root,"docs/project.json"),JSON.stringify(f.project));
  await fs.writeFile(path.join(f.logs,"logcat.txt"),`BoschVehicleHalHash ${"b".repeat(7)}-2026-10-20`);
  const result=await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs});
  expect(result.mode).toBe("auto");expect(result.candidates).toHaveLength(2);expect(result.actual.branchGroupName).toBe("sop");
 });
 it("retains ambiguity and defaults when shared branches have no disambiguating hash",async()=>{
  const f=await setup();f.project[0].branches.push({name:"other",repos:[{repoName:"api-public",repoPath:"api",branchName:"branch_sop"}]});await fs.writeFile(path.join(f.root,"docs/project.json"),JSON.stringify(f.project));
  expect(await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs})).toMatchObject({mode:"manual",candidates:[{branchGroupName:"sop"},{branchGroupName:"other"}]});
 });
 it("falls back for conflicting cycles and duplicate aliases",async()=>{
  const f=await setup();f.ctx.request.modelToFiles!.other={aliases:["T1JFL3"],json:"other.json",dbc:[],proto:""};
  expect((await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs})).mode).toBe("manual");
  delete f.ctx.request.modelToFiles!.other;
  const records=[...f.records,{...f.records[0],socVersion:"different_2026.44.5"}];
  expect((await selectEffectiveConfiguration(f.ctx,{root:f.root,records,extractDir:f.logs})).mode).toBe("manual");
 });
});
it("freezes available manual files without borrowing automatic files when a manual input is missing",async()=>{
 const f=await setup();const manual=f.ctx.request.basePaths!.json_dir;await fs.mkdir(manual);
 await fs.writeFile(path.join(manual,"config.json"),"[]");await fs.writeFile(path.join(manual,"vehicle.proto"),f.content["vehicle.proto"]);
 const result=await selectEffectiveConfiguration(f.ctx,{root:f.root,records:[],extractDir:f.logs});
 expect(result.mode).toBe("manual");expect(result.actual.files.map(file=>file.kind)).toEqual(["json","proto"]);
 const effective=configurationFor(f.ctx);expect(effective.basePaths?.json_dir).toContain(f.ctx.logRoot);
 await fs.writeFile(path.join(manual,"config.json"),"changed");expect(await fs.readFile(path.join(effective.basePaths!.json_dir,"config.json"),"utf8")).toBe("[]");
 expect(await fs.stat(path.join(effective.basePaths!.dbc_dir,"car_T1J_FL3.dbc")).catch(()=>null)).toBeNull();
});
it("rejects an incomplete synchronized manifest even when the selected model files are present",async()=>{
 const f=await setup();f.manifest.files.push({name:"missing-other.json",oid:"c".repeat(40)});await fs.writeFile(path.join(f.directory,".sync-state.json"),JSON.stringify(f.manifest));
 expect((await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs})).mode).toBe("manual");
});
it("loads every comma-separated JSON file from the selected immutable configuration",async()=>{
 const {loadModelConfig}=await import("@/server/pipeline/process/prepare");const f=await setup();
 f.ctx.request.modelToFiles!["T1J-FL3-8255"].json="config.json, other.json";
 const extra='[{"prop":"Other","up_signal":"B"}]';await fs.writeFile(path.join(f.directory,"other.json"),extra);f.manifest.files.push({name:"other.json",oid:gitBlobId(Buffer.from(extra))});await fs.writeFile(path.join(f.directory,".sync-state.json"),JSON.stringify(f.manifest));
 expect((await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs})).mode).toBe("auto");
 expect((await loadModelConfig(f.ctx)).parsedConfigItems).toHaveLength(2);
});
it("marks explicit SOC/hash conflicts and refuses partial version extraction evidence",async()=>{
 const f=await setup();f.project[0].branches.push({name:"other",repos:[{repoName:"vs",repoPath:"vs",branchName:"other_vs","commid-rtcids-map":[{commitid:"c".repeat(40),rtcids:["RTC1-2"]}]}]});await fs.writeFile(path.join(f.root,"docs/project.json"),JSON.stringify(f.project));
 await fs.writeFile(path.join(f.logs,"logcat.txt"),`BoschVehicleHalHash ${"c".repeat(7)}-2026-10-20`);
 expect(await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs})).toMatchObject({mode:"manual",identityConflict:true});
 await fs.rm(path.join(f.logs,"logcat.txt"));
 expect((await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs,warnings:["SCC版本解析失败"]})).mode).toBe("manual");
});
it("keeps separate immutable snapshots when legacy calls reuse a run directory",async()=>{
 const f=await setup();const first=await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs});
 const second=await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs});
 expect(first.mode).toBe("auto");expect(second.mode).toBe("auto");expect(second.actual.files[0].snapshot).not.toBe(first.actual.files[0].snapshot);
 expect(await fs.readFile(first.actual.files[0].snapshot,"utf8")).toBe(f.content["config.json"]);
});
it("normalizes the proto filename and persists raw pairs and repository identities",async()=>{
 const {loadModelConfig}=await import("@/server/pipeline/process/prepare");const f=await setup();f.ctx.request.modelToFiles!["T1J-FL3-8255"].proto=" vehicle.proto ";
 const result=await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs});
 expect(result.evidence.records).toEqual(f.records);expect(result.actual.repos?.[0]).toMatchObject({repoName:"api-public",commitid:"a".repeat(40)});
 expect((await loadModelConfig(f.ctx)).protoContent).toContain("enum Property_ID");
});
it.each(["targetId","syncedAt","headerFile","rtcids"])("falls back before publishing an invalid manifest field: %s",async field=>{
 const f=await setup();const state=JSON.parse(await fs.readFile(path.join(f.directory,".sync-state.json"),"utf8"));
 if(field==="headerFile")state.headerFile="not-present";else if(field==="rtcids")state.repos[0].rtcids=123;else state[field]=123;
 await fs.writeFile(path.join(f.directory,".sync-state.json"),JSON.stringify(state));
 expect((await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs})).mode).toBe("manual");
});
it("does not treat the legacy substring model detector as an explicit identity conflict",async()=>{
 const f=await setup();f.ctx.carModel="T1J";
 f.ctx.request.modelToFiles!.T1J={aliases:["T1J"],json:"older.json",dbc:[],proto:""};
 const result=await selectEffectiveConfiguration(f.ctx,{root:f.root,records:f.records,extractDir:f.logs});
 expect(result.mode).toBe("auto");expect(result.actual.carModel).toBe("T1J-FL3-8255");expect(f.ctx.carModel).toBe("T1J");
});
