import "fake-indexeddb/auto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {RuleGroup} from "@/domain/entities";
import {db} from "@/shared/db/database";
import {runGroupFilter,loadRuleGroupFilters} from "@/features/workflow/filter-service";
import {FILTER_RUN_TIMEOUT_MS} from "@/domain/issue-source/jira-workflow";
import {emptyPrompts} from "@/domain/rule-groups/form";
const group:RuleGroup={id:"timeout-group",name:"超时组",sortOrder:0,jql:"",meegleMql:"SELECT * FROM `p`.`issue`",expand:"",base_paths:{json_dir:"",dbc_dir:"",proto_dir:""},model_to_files:{},prompts:emptyPrompts(),createdAt:new Date(),updatedAt:new Date()};
beforeEach(async()=>{await db.open();await Promise.all(db.tables.map(t=>t.clear()));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("a stalled request cannot keep filtering busy beyond the deadline",async()=>{
 let release!:(r:Response)=>void;let expire: (()=>void)|undefined;
 const timer=setTimeout;
 const timerSpy=vi.spyOn(globalThis,"setTimeout").mockImplementation(((callback:()=>void,ms?:number,...args:unknown[])=>{
  if(ms===FILTER_RUN_TIMEOUT_MS || ms===90_000)expire=callback;
  return timer(callback,ms,...args);
 }) as typeof setTimeout);
 vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(r=>{release=r;})));
 let settled=false;
 const pending=runGroupFilter(group,[group]).finally(()=>{settled=true;});
 await vi.waitFor(()=>expect(release).toBeTypeOf("function"));
 try {
  expect(expire).toBeTypeOf("function");expire!();
  await vi.waitFor(()=>expect(settled).toBe(true),{timeout:500});
  expect((await pending).meegle.status).toBe("expired");
 } finally {
  release(new Response(JSON.stringify({runId:"r",successfulRuleGroupIds:[group.id],filterResults:{[group.id]:[]},audits:[]})));
  await pending;timerSpy.mockRestore();
 }
 expect((await loadRuleGroupFilters(group)).summary.meegle.status).toBe("expired");
});
it("reading an expired active run recovers it even without remounting the page",async()=>{
 await db.filterRuns.put({id:"stale",ruleGroupId:group.id,source:"meegle",query:group.meegleMql!,status:"running",issueCount:0,createdAt:new Date(Date.now()-FILTER_RUN_TIMEOUT_MS-1000)});
 expect((await loadRuleGroupFilters(group)).summary.meegle.status).toBe("expired");
});
