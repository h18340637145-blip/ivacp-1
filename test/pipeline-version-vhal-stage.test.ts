import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,it,expect,vi} from "vitest";
const model=vi.hoisted(()=>vi.fn());
vi.mock("@/server/ai/qwen",()=>({chat:model}));
import { runVersionVhalCheck } from "@/server/pipeline/process/version-vhal-stage";
import {createPipelineMetrics} from "@/server/pipeline/metrics";
import type {ProcessContext} from "@/server/pipeline/process/context";
const dirs:string[]=[];
afterEach(async()=>{model.mockReset();for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
async function setup() {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"vhal-stage-"));dirs.push(root);
 const ctx={issueKey:"X-1",logRoot:root,request:{source:"jira",runId:"r1"},carModel:"D01",stages:{},logger:{log:vi.fn()},metrics:createPipelineMetrics({issueKey:"X-1",summary:"",ruleGroupId:"g",ruleGroupName:"g",carModel:"D01",attachRoot:root,logRoot:root})} as unknown as ProcessContext;
 return {root,ctx};
}
describe("shared version VHAL stage",()=>{
 it("accepts a complete AI matched decision without comparing strings itself",async()=>{
  const {ctx}=await setup();model.mockResolvedValue('{"result":"matched","socVersion":"1.2","sccVersion":"1.2","reason":"属于配合刷入"}');
  const r=await runVersionVhalCheck(ctx,{extractDir:"",tokens:[],records:[{buildInfo:"Buildinfo.txt",socVersion:"SOC(platform)-1.2",sccVersions:[{file:"SCC.dlt",version:"v1.2-build-date"}]}]});
  expect(r.socScc.result).toBe("matched");expect(r.stopReason).toBeUndefined();
 });
 it("uses AI to stop immediately on mismatch, with evidence files saved",async()=>{
  const {ctx}=await setup();model.mockResolvedValue('{"result":"mismatched","socVersion":"1","sccVersion":"2","reason":"版本不同"}');
  const r=await runVersionVhalCheck(ctx,{extractDir:"",tokens:["A"],records:[{buildInfo:"x/Buildinfo.txt",socVersion:"raw SOC",sccVersions:[{file:"x/SCC-1.dlt",version:"raw SCC"},{file:"x/SCC-2.dlt",version:"raw SCC2"}]}]});
  expect(r.stopReason).toBe("version_mismatch");expect(model).toHaveBeenCalledTimes(1);
  expect(r.resolution.status).toBe("skipped");
  expect(JSON.parse(await fs.readFile(path.join(ctx.logRoot,"soc-scc-version-check.json"),"utf8"))).toMatchObject({runId:"r1",result:"mismatched"});
  expect(await fs.readFile(path.join(ctx.logRoot,"version-vhal-check.md"),"utf8")).toContain("版本不同");
 });
 it.each(['not json','{"result":"matched","socVersion":null,"sccVersion":"2","reason":"ok"}'])("invalid AI output continues without pretending a match: %s",async raw=>{
  const {ctx}=await setup();model.mockResolvedValue(raw);
  const r=await runVersionVhalCheck(ctx,{extractDir:"",tokens:["A"],records:[{buildInfo:"Buildinfo.txt",socVersion:"SOC",sccVersions:[{file:"SCC.dlt",version:"SCC"}]}]});
  expect(r.socScc.result).toBe("unknown");expect(r.stopReason).toBeUndefined();expect(r.warnings.length).toBeGreaterThan(0);
 });
 it("does not invoke AI with missing versions and persists unknown",async()=>{
  const {ctx}=await setup();const r=await runVersionVhalCheck(ctx,{extractDir:"",tokens:[],records:[]});
  expect(model).not.toHaveBeenCalled();expect(r.socScc.result).toBe("unknown");
  expect(JSON.parse(await fs.readFile(path.join(ctx.logRoot,"vhal-signal-config-check.json"),"utf8"))).toMatchObject({status:"unknown",stop:false});
 });
});
