import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {afterEach,describe,it,expect,vi} from "vitest";
import {resolveVhal,scanAndroidHashes} from "@/server/pipeline/version-vhal/resolution";
import {readVhalWorkbook} from "@/server/pipeline/version-vhal/workbook";
import {checkSignalRows} from "@/server/pipeline/version-vhal/signals";
import {runVersionVhalCheck} from "@/server/pipeline/process/version-vhal-stage";
import {createPipelineMetrics} from "@/server/pipeline/metrics";
import type {ProcessContext} from "@/server/pipeline/process/context";
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
const exec=promisify(execFile);
async function fixture() {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"vhal-files-"));dirs.push(root);
 const logs=path.join(root,"android");await fs.mkdir(logs);await fs.mkdir(path.join(root,"docs"));
 const dir=path.join(root,"configuration/chery-8255/main");await fs.mkdir(path.join(dir,"bak"),{recursive:true});
 const excelDir=path.join(root,"configuration/chery-8255/vhal/vhal2.2.35");await fs.mkdir(excelDir,{recursive:true});
 const excel=path.join(excelDir,"CHERY_8255_VHAL_SIGNAL_V2.2.35.xlsx");
 const commitid="6a5d61b123456789012345678901234567890123";
 const project=[{projectName:"chery-8255",branches:[{name:"main",repos:[{repoName:"vs",repoPath:"vs",branchName:"dev", "commid-rtcids-map":[{commitid,rtcids:["RTC1-1","RTC1-2"]}]}]}]}];
 await fs.writeFile(path.join(root,"docs/project.json"),JSON.stringify(project));
 await fs.writeFile(path.join(logs,"logcat.txt"),"BoschVehicleHalHash: 6a5d61b-2026-10-13\n");
 return {root,logs,dir,excel,commitid,project};
}
export async function writeWorkbook(file:string,propertyColumn="I") {
 // Minimal actual OOXML zip; dimension deliberately lies, as observed in real files.
 const script=`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="cover" sheetId="1" r:id="r1"/><sheet name="business" sheetId="2" r:id="r2"/></sheets></workbook>')
 z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>')
 z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>')
 z.writestr('xl/worksheets/sheet2.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetData><row r="1"><c r="E1" t="inlineStr"><is><t>Project</t></is></c><c r="${propertyColumn}1" t="inlineStr"><is><t>Vehicle property ID</t></is></c><c r="S1" t="inlineStr"><is><t>MCU UP</t></is></c><c r="T1" t="inlineStr"><is><t>IVI DOWN</t></is></c></row><row r="7"><c r="E7" t="inlineStr"><is><t>D01/D01_HW</t></is></c><c r="${propertyColumn}7" t="inlineStr"><is><t>Test_PROP</t></is></c><c r="S7" t="inlineStr"><is><t>Test_A</t></is></c><c r="T7" t="inlineStr"><is><t>Test_B</t></is></c></row><row r="8"><c r="E8" t="inlineStr"><is><t>D01</t></is></c><c r="${propertyColumn}8" t="inlineStr"><is><t>PROP_ONLY</t></is></c></row></sheetData></worksheet>')`;
 await exec("python3",["-c",script,file]);
}
describe("VHAL real filesystem and xlsx",()=>{
 it.each(["", "bak"])("resolves archive in %s without reading unrelated current type.h",async sub=>{
  const f=await fixture();await fs.writeFile(path.join(f.dir,sub,`${f.commitid}_RTC1-1_82552235${sub?"":".h"}`),"");
  await fs.writeFile(path.join(f.dir,"type.h"),"#define VER_PRO_CFG 82552236");await writeWorkbook(f.excel);
  const r=await resolveVhal(f.root,f.logs);expect(r).toMatchObject({status:"ok",version:"2.2.35",platform:"8255",excel:f.excel});expect(r.selectedHash).toMatchObject({commitPrefix:"6a5d61b",buildDate:"2026-10-13",file:"logcat.txt"});expect(r.candidates[0].rtcids).toEqual(["RTC1-1","RTC1-2"]);
  const book=await readVhalWorkbook(r.excel!);expect(book.sheets).toEqual(["business"]);expect(book.rows[0].row).toBe(7);
  expect(checkSignalRows(["Test_A","Test_B"],"D01",book.rows).signals.map(s=>s.status)).toEqual(["configured","configured"]);
 });
 it.each([
  [["Test_A","Test_B"],false],[["Test_PROP","PROP_ONLY"],false],[["Test_A","Absent"],false],[["Absent"],true],[["test_a"],false],
 ] as const)("complete stage checks %j and stop=%s with persisted evidence",async(tokens,stop)=>{
  const f=await fixture();await fs.writeFile(path.join(f.dir,`${f.commitid}_RTC1-1_82552235`),"");await writeWorkbook(f.excel);
  const ctx={issueKey:"TEST-1",logRoot:f.root,request:{source:"jira",runId:"r",modelToFiles:{D01:{dbc:["car_D01.dbc"]}}},carModel:"D01",stages:{},logger:{log:vi.fn()},metrics:createPipelineMetrics({issueKey:"TEST-1",summary:"",ruleGroupId:"g",ruleGroupName:"g",carModel:"D01",attachRoot:f.root,logRoot:f.root})} as unknown as ProcessContext;
  const check=await runVersionVhalCheck(ctx,{records:[],extractDir:f.logs,tokens:[...tokens],root:f.root});
  expect(check.config.stop).toBe(stop);expect(check.resolution.status).toBe("ok");expect(check.resolution.excelSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(check.stopReason).toBe(stop?"all_signals_missing":undefined);
  const saved=JSON.parse(await fs.readFile(path.join(f.root,"vhal-signal-config-check.json"),"utf8"));
  expect(saved).toMatchObject({runId:"r",stop});
  if(tokens.some(token=>token==="PROP_ONLY"))expect(saved.signals).toMatchObject([{hits:[{column:"Vehicle property ID"}]},{hits:[{column:"Vehicle property ID"}]}]);
 });
 it("does not truncate hash scan at 20 and excludes QNX even with .log suffix",async()=>{
  const f=await fixture();await fs.writeFile(path.join(f.logs,"logcat.txt"),Array.from({length:30},(_,i)=>`BoschVehicleHalHash: ${i.toString(16).padStart(7,"a")}-2026-10-12`).join("\n")+"\nBoschVehicleHalHash: 6a5d61b-2026-10-13");
  await fs.writeFile(path.join(f.logs,"qnx.log"),"BoschVehicleHalHash: bbbbbbb-2026-10-30");
  const scanned=await scanAndroidHashes(f.logs);expect(scanned.hashes).toHaveLength(31);expect(scanned.hashes.at(-1)?.commitPrefix).toBe("6a5d61b");
 });
 it("reports unreadable subdirectories instead of claiming a complete hash scan",async()=>{
  const f=await fixture();const blocked=path.join(f.logs,"blocked");await fs.mkdir(blocked);
  const readdir=fs.readdir.bind(fs);
  const spy=vi.spyOn(fs,"readdir").mockImplementation(((dir:unknown,...args:unknown[])=>{
   if(String(dir)===blocked)return Promise.reject(new Error("unreadable"));
   return (readdir as (...a:unknown[])=>unknown)(dir,...args);
  }) as typeof fs.readdir);
  try {expect((await scanAndroidHashes(f.logs)).warnings.join(" ")).toContain("unreadable");}
  finally{spy.mockRestore();}
 });
 it("persists candidates instead of resolving cross-branch conflict",async()=>{
  const f=await fixture();f.project[0].branches.push({...f.project[0].branches[0],name:"other"});await fs.writeFile(path.join(f.root,"docs/project.json"),JSON.stringify(f.project));
  expect(await resolveVhal(f.root,f.logs)).toMatchObject({status:"ambiguous",candidates:[{branchGroupName:"main"},{branchGroupName:"other"}]});
 });
 it("refuses contradictory archives and reports unreadable excel as unknown",async()=>{
  const f=await fixture();for(const code of ["82552235","82552236"])await fs.writeFile(path.join(f.dir,`${f.commitid}_RTC1-1_${code}`),"");
  expect(await resolveVhal(f.root,f.logs)).toMatchObject({status:"ambiguous"});
  await fs.rm(path.join(f.dir,`${f.commitid}_RTC1-1_82552236`));
  expect(await resolveVhal(f.root,f.logs)).toMatchObject({status:"unknown"});
  await fs.writeFile(f.excel,"corrupt");await expect(readVhalWorkbook(f.excel)).rejects.toThrow("Excel解析失败");
 });
});
it("keeps VHAL and signal status unknown after a detected log identity conflict",async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.dir,`${f.commitid}_RTC1-1_82552235`),"");await writeWorkbook(f.excel);
 const ctx={issueKey:"TEST-1",logRoot:f.root,request:{source:"jira",runId:"r",modelToFiles:{D01:{dbc:["car_D01.dbc"]}}},carModel:"D01",configurationResolution:{identityConflict:true},stages:{},logger:{log:vi.fn()},metrics:createPipelineMetrics({issueKey:"TEST-1",summary:"",ruleGroupId:"g",ruleGroupName:"g",carModel:"D01",attachRoot:f.root,logRoot:f.root})} as unknown as ProcessContext;
 const r=await runVersionVhalCheck(ctx,{records:[],extractDir:f.logs,tokens:["Absent"],root:f.root});
 expect(r.resolution.status).toBe("unknown");expect(r.config.status).toBe("unknown");expect(r.stopReason).toBeUndefined();
});

it.each(["I","AA"])("reads property headers in column %s and retains property-only rows",async column=>{
 const f=await fixture();await writeWorkbook(f.excel,column);
 const book=await readVhalWorkbook(f.excel);
 expect(book.warnings).toEqual([]);
 expect(book.rows).toMatchObject([{row:7,propertyId:"Test_PROP",up:"Test_A",down:"Test_B"},{row:8,propertyId:"PROP_ONLY",up:"",down:""}]);
 expect(checkSignalRows(["Test_PROP","PROP_ONLY"],"D01",book.rows)).toMatchObject({stop:false,signals:[{status:"configured",hits:[{column:"Vehicle property ID"}]},{status:"configured",hits:[{column:"Vehicle property ID"}]}]});
});
it("continues reading legacy workbooks without a Vehicle property ID header",async()=>{
 const f=await fixture();await writeWorkbook(f.excel);
 await exec("python3",["-c",`import zipfile,sys,re,xml.etree.ElementTree as E
file=sys.argv[1]
with zipfile.ZipFile(file) as z: entries={n:z.read(n) for n in z.namelist()}
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
tree=E.fromstring(entries['xl/worksheets/sheet2.xml'])
for row in tree.findall('m:sheetData/m:row',ns):
 for cell in list(row):
  if re.fullmatch(r'I[0-9]+',cell.attrib.get('r','')): row.remove(cell)
entries['xl/worksheets/sheet2.xml']=E.tostring(tree)
with zipfile.ZipFile(file,'w') as z:
 for name,content in entries.items():z.writestr(name,content)
`,f.excel]);
 const book=await readVhalWorkbook(f.excel);
 expect(book.warnings).toEqual([]);expect(book.rows).toHaveLength(1);expect(book.rows[0].propertyId).toBe("");
 expect(checkSignalRows(["Test_A","Test_B"],"D01",book.rows)).toMatchObject({stop:false,signals:[{status:"configured"},{status:"configured"}]});
});
