import {afterAll,afterEach,beforeAll,describe,expect,it} from "vitest";
import {chromium,type Browser,type BrowserContext,type Page} from "playwright";
import {AUTH_SESSION_COOKIE,createSessionToken} from "@/server/auth/session";
import {writeFile} from "node:fs/promises";
const baseURL=process.env.IVACP_BROWSER_BASE_URL;
describe.skipIf(!baseURL)("飞书筛选超时浏览器恢复",()=>{
 let browser:Browser,context:BrowserContext,page:Page;
 let release:()=>void=()=>{};let calls=0;
 beforeAll(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.IVACP_BROWSER_EXECUTABLE});
  context=await browser.newContext({baseURL,viewport:{width:1280,height:900}});context.setDefaultTimeout(20000);
  await context.addCookies([{name:AUTH_SESSION_COOKIE,value:createSessionToken({username:"filter-timeout-browser",displayName:"筛选验收",role:"admin"}),url:baseURL!}]);
  await context.route("**/api/backup/**",r=>r.fulfill({json:{configured:false}}));
  await context.route("**/api/meegle/filter",async r=>{
   calls++;
   if(calls===1)await new Promise<void>(resolve=>{release=resolve;});
   await r.fulfill({json:{runId:`r-${calls}`,successfulRuleGroupIds:["timeout-browser"],filterResults:{"timeout-browser":[]},audits:[]}}).catch(()=>{});
  });
  page=await context.newPage();
  await page.addInitScript(()=>{
   const original=window.setTimeout.bind(window);
   // Only accelerate this request deadline; global clock mocks distort Dexie liveQuery after reload.
   window.setTimeout=((handler:TimerHandler,timeout?:number,...args:unknown[])=>original(handler,timeout===90_000?1000:timeout,...args)) as typeof window.setTimeout;
  });
  await page.goto("/");await page.getByText("创建第一个规则组",{exact:true}).waitFor();
  await page.evaluate(async()=>{
   const database=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("IvacpDB");r.onsuccess=()=>resolve(r.result);});
   try {await new Promise<void>((resolve,reject)=>{const tx=database.transaction("ruleGroups","readwrite");tx.objectStore("ruleGroups").put({id:"timeout-browser",name:"飞书超时验收",jql:"",meegleMql:"SELECT * FROM `p`.`issue`",expand:"",base_paths:{json_dir:"",dbc_dir:"",proto_dir:""},model_to_files:{},prompts:{},sortOrder:0,createdAt:new Date(),updatedAt:new Date()});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{database.close();}
  });
  await page.reload();await page.getByRole("heading",{name:"飞书超时验收",exact:true}).waitFor();
 });
 afterEach(async test=>{if(test.task.result?.state==="fail"){await writeFile("/tmp/ivacp-filter-browser-failure.txt",page.url()+"\n"+await page.locator("body").innerText());await page.screenshot({path:"/tmp/ivacp-filter-browser-failure.png",fullPage:true});}});
 afterAll(async()=>{release();await context?.close();await browser?.close();});
 it("达到截止时间退出等待，允许重试；迟到响应不覆盖新运行",async()=>{
  const card=page.getByRole("article",{name:"规则组 飞书超时验收"});
  const button=card.getByRole("button",{name:"筛选工单",exact:true});
  await button.click();await expect.poll(()=>calls).toBe(1);
  await card.getByText("运行中",{exact:true}).waitFor();
  await card.getByText("已过期",{exact:true}).waitFor();
  await expect.poll(()=>button.isEnabled()).toBe(true);
  await button.click();await card.getByText("已完成",{exact:true}).waitFor();
  release();
  await page.reload();await card.getByText("已完成",{exact:true}).waitFor();
  expect(calls).toBe(2);
 });
});
