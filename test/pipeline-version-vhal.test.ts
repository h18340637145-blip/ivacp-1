import { describe, expect, it } from "vitest";
import { parseHashLine, chooseLatestHash, findCommits, versionFromCode } from "@/server/pipeline/version-vhal/resolution";
import { parseStep2SignalTokens } from "@/server/pipeline/signals";
import { modelFromDbc, checkSignalRows } from "@/server/pipeline/version-vhal/signals";

describe("VHAL version and signal policy", () => {
 it("keeps the full hash and selects build date rather than log order", () => {
  const a = parseHashLine("BoschVehicleHalHash: 6a5d61b-2026-10-13", "android/logcat", 1)!;
  const b = parseHashLine("BoschVehicleHalHash: abc1234-2026-10-12", "android/logcat", 2)!;
  expect(a.commitPrefix).toBe("6a5d61b");
  expect(chooseLatestHash([a,b]).selected).toEqual(a);
  expect(chooseLatestHash([a, {...a, commitPrefix: "bbbbbbb"}]).status).toBe("ambiguous");
  expect(chooseLatestHash([{...a, buildDate: "2026-02-30"}]).status).toBe("unknown");
 });
 it("retains single-letter case-sensitive Step2 tokens for the VHAL check",()=>{
  expect(parseStep2SignalTokens("A a Test_A",true)).toEqual(["A","a","Test_A"]);
 });
 it("only matches commitid fields and retains cross-branch conflicts", () => {
  const repo = { repoName: "vs", repoPath: "qnx/vs", branchName: "dev", "commid-rtcids-map": [{commitid: "6a5d61b123456", rtcids:["RTC1-1"]}] };
  const projects = [{projectName:"chery-8255", branches:[{name:"main",repos:[repo]}, {name:"other",repos:[repo]}]}];
  expect(findCommits(projects,"6a5d61b")).toHaveLength(2);
  expect(findCommits(projects,"RTC1")).toEqual([]);
  expect(versionFromCode("82552235")).toEqual({platform:"8255",version:"2.2.35"});
 });
 it.each([["car_D01.dbc","D01"],["car_D01_OS_APA.dbc","D01_OS_APA"],["car_D01_HW.dbc","D01_HW"],["car_T1L_FL1_Body.dbc","T1L_FL1"],["car_T1YA_IC2.dbc","T1YA"]])("extracts %s", (file,model) => expect(modelFromDbc(file)).toBe(model));
 it("checks both signal columns, exact Project tokens and all missing policy", () => {
  const rows = [{sheet:"second",row:5,project:"D01/D01_HW/T1J_FL2",up:"A",down:"B"}];
  const result = checkSignalRows(["A","B","C"],"D01",rows);
  expect(result.signals.map(s=>s.status)).toEqual(["configured","configured","signal_missing"]);
  expect(result.stop).toBe(false);
  expect(checkSignalRows(["C"],"D01",rows).stop).toBe(true);
  expect(checkSignalRows(["A"],"D010",rows).stop).toBe(true);
  expect(checkSignalRows([],"D01",rows).stop).toBe(false);
 });
 it("matches exact members of explicit signal lists without alias matching",()=>{
  const r=checkSignalRows(["A","B","C"],"D01",[{sheet:"main",row:2,project:"D01",up:"[A,\nB]",down:"C"}]);
  expect(r.signals.map(s=>s.status)).toEqual(["configured","configured","configured"]);
 });
 it("does not block for case-only differences or unknown Project semantics", () => {
  const row = {sheet:"main",row:2,project:"D01",up:"a",down:""};
  expect(checkSignalRows(["A"],"D01",[row])).toMatchObject({stop:false,signals:[{status:"signal_missing",caseMismatch:true}]});
  expect(checkSignalRows(["a"],"D01",[{...row,project:"ALL"}])).toMatchObject({stop:false,signals:[{status:"unknown"}]});
 });
});

it("matches the four ticket 7147061892 properties by Vehicle property ID and the same row Project",()=>{
 const tokens=["ISS_SWITCH_STS_463H_463","ICC_ISSFCTCMD_539H_539","FLZCU_9_POWERMODE_49D","FLZCU_9_FUELVEHPOWERMODE_49D"];
 const rows=[
  {sheet:"SETTINGS",row:566,project:"T1J_FL3",propertyId:tokens[0],up:"ISS_Switch_Sts_463h",down:"None"},
  {sheet:"SETTINGS",row:553,project:"T1J_FL3/T1YA",propertyId:tokens[1],up:"None",down:"ICC_ISSFctCmd_539h"},
  {sheet:"HVAC",row:74,project:"D01/D01_HW/T1J_FL2",propertyId:tokens[2],up:"FLZCU_9_PowerMode",down:"None"},
  {sheet:"HVAC",row:286,project:"T1J_FL3/T1YA",propertyId:tokens[2],up:"FLZCU_9_PowerMode",down:"None"},
  {sheet:"DrivingInfo",row:34,project:"T1J_FL3/T1YA",propertyId:tokens[3],up:"FLZCU_9_FuelVehPowerMode",down:"None"},
 ];
 const result=checkSignalRows(tokens,"T1J_FL3",rows);
 expect(result.signals.map(s=>s.status)).toEqual(Array(4).fill("configured"));expect(result.stop).toBe(false);
 expect(result.signals[0].hits).toEqual([{sheet:"SETTINGS",row:566,column:"Vehicle property ID",value:tokens[0],project:"T1J_FL3"}]);
});
it("keeps property matching exact, case-sensitive, model-specific and unknown-safe",()=>{
 const row={sheet:"main",row:2,project:"D01",propertyId:"PROP_1",up:"",down:""};
 expect(checkSignalRows(["PROP_1"],"D010",[row])).toMatchObject({stop:true,signals:[{status:"model_not_configured"}]});
 expect(checkSignalRows(["PROP"],"D01",[row])).toMatchObject({stop:true,signals:[{status:"signal_missing"}]});
 expect(checkSignalRows(["prop_1"],"D01",[row])).toMatchObject({stop:false,signals:[{status:"signal_missing",caseMismatch:true,caseCandidates:[{column:"Vehicle property ID"}]}]});
 expect(checkSignalRows(["PROP_1"],"D01",[{...row,projectUnknown:true}])).toMatchObject({stop:false,signals:[{status:"unknown"}]});
 expect(checkSignalRows(["PROP_1"],"D01",[{...row,project:"ALL"}])).toMatchObject({stop:false,signals:[{status:"unknown"}]});
});
