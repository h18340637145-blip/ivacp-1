import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {runMeegleJson} from "@/server/meegle/cli";
const directories:string[]=[];
const children:number[]=[];
afterEach(async()=>{
 vi.unstubAllEnvs();
 for(const pid of children.splice(0)){try{process.kill(pid,"SIGKILL");}catch{}}
 for(const dir of directories.splice(0))await fs.rm(dir,{recursive:true,force:true});
});
it.each([false,true])("CLI wrapper timeout terminates native descendant (ignores TERM=%s)",async ignoreTerm=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"ivacp-cli-timeout-"));directories.push(dir);
 const pidFile=path.join(dir,"child.pid");
 const childFile=path.join(dir,"native.cjs");
 await fs.writeFile(childFile,`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));${ignoreTerm?"process.on('SIGTERM',()=>{});":""}setInterval(()=>{},1000);`);
 await fs.writeFile(path.join(dir,"meegle"),`#!${process.execPath}\nrequire('node:child_process').spawnSync(process.execPath,[${JSON.stringify(childFile)}],{stdio:'inherit'});\n`,{mode:0o755});
 vi.stubEnv("PATH",dir+path.delimiter+process.env.PATH);
 let settled=false;
 const pending=runMeegleJson(["workitem","query"],300).then(()=>({error:undefined}),error=>({error})).finally(()=>{settled=true;});
 await vi.waitFor(async()=>expect(await fs.readFile(pidFile,"utf8")).toMatch(/^\d+$/),{timeout:1000});
 const pid=Number(await fs.readFile(pidFile,"utf8"));children.push(pid);
 try {
  await vi.waitFor(()=>expect(settled).toBe(true),{timeout:1800});
  expect((await pending).error).toBeDefined();
  await vi.waitFor(()=>expect(()=>process.kill(pid,0)).toThrow(),{timeout:1800});
 } finally {try{process.kill(pid,"SIGKILL");}catch{}await pending;}
});
