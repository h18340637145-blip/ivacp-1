import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalSessionManager, type TerminalChannel } from "../terminal-gateway/session-manager";
import type { ServerTerminalMessage } from "@/domain/terminal/types";
const roots:string[]=[];
afterEach(async()=>{for(const r of roots.splice(0))await fs.rm(r,{recursive:true,force:true})});
async function setup(allowed=true) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"sync-gateway-"));roots.push(root);await fs.mkdir(path.join(root,"docs"));
 await fs.writeFile(path.join(root,"docs/project.json"),JSON.stringify([{projectName:"p",mainPath:"~/remote",scriptPath:"",branches:[{name:"b",repos:[{repoName:"r",repoPath:"r",branchName:"main"}]}]}]));
 const events:ServerTerminalMessage[]=[];
 const channel={runCommand:vi.fn(async()=>({stdout:"a".repeat(40)+"\0RTC1-1\n\0",stderr:"",code:0})),write:vi.fn(),close:vi.fn(),setWindow(){},on(){return this}} as unknown as TerminalChannel;
 const fallback=vi.fn(async()=>{throw new Error("must reuse channel")});
 const manager=new TerminalSessionManager({targets:[{id:"t",name:"T",host:"unused",port:22,username:"x",description:"",environment:"test",riskLevel:"normal",guardMode:"soft"}],connectSsh:async()=>channel,runRemoteCommand:fallback,uploadRemoteFile:async()=>{},send:m=>events.push(m),audit:async()=>{},canSync:()=>allowed,syncRoot:root});
 const sessionId=await manager.connect({type:"connect",targetId:"t",cols:80,rows:24});return {root,manager,sessionId,events,channel,fallback};
}
it("sync requires an authenticated admin even when debugging Gateway auth is disabled",async()=>{
 const f=await setup(false);try {await expect(f.manager.syncProjects({type:"syncProjects",sessionId:f.sessionId,requestId:"sync-1"})).rejects.toThrow("管理员");expect(f.channel.runCommand).not.toHaveBeenCalled();}finally{f.manager.disconnectAll("test")}
});
it("sync reuses the authenticated SSH channel and sends correlated progress and results without closing PTY",async()=>{
 const f=await setup();try {await f.manager.syncProjects({type:"syncProjects",sessionId:f.sessionId,requestId:"sync-1"});expect(f.fallback).not.toHaveBeenCalled();expect(f.channel.close).not.toHaveBeenCalled();expect(f.events).toContainEqual(expect.objectContaining({type:"syncProgress",requestId:"sync-1",sessionId:f.sessionId}));expect(f.events).toContainEqual(expect.objectContaining({type:"syncResult",requestId:"sync-1",report:expect.objectContaining({totalProjects:1,completedBranches:1})}));}finally{f.manager.disconnectAll("test")}
});
it("disconnect prevents late SSH results from publishing local files or mappings",async()=>{
 const f=await setup();let release!:(r:{stdout:string;stderr:string;code:number})=>void;
 vi.mocked(f.channel.runCommand!).mockImplementation(()=>new Promise(resolve=>{release=resolve}));
 const sync=f.manager.syncProjects({type:"syncProjects",sessionId:f.sessionId,requestId:"sync-1"});await vi.waitFor(()=>expect(release).toBeTruthy());
 f.manager.disconnectAll("test");release({stdout:"a".repeat(40)+"\0RTC1-1\n\0",stderr:"",code:0});await sync;
 expect(f.events.some(e=>e.type==="syncResult")).toBe(false);expect(await fs.stat(path.join(f.root,"configuration/p/b")).catch(()=>null)).toBeNull();
});
