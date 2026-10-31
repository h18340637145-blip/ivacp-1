import {configurationFixture} from "./helpers/configuration-fixture";
import {afterAll,beforeAll,describe,it,expect} from "vitest";
import {chromium,type Browser,type BrowserContext,type Page} from "playwright";
import {AUTH_SESSION_COOKIE,createSessionToken} from "@/server/auth/session";
import {versionVhalFixture,versionVhalVsFixture} from "./helpers/version-vhal-fixture";
const baseURL=process.env.IVACP_BROWSER_BASE_URL;
describe.skipIf(!baseURL)("版本与VHAL检查浏览器闭环",()=>{
 let browser:Browser,context:BrowserContext,page:Page;
 const errors:string[]=[];
 let responseCheck = versionVhalFixture();
 beforeAll(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.IVACP_BROWSER_EXECUTABLE});
  context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}});context.setDefaultTimeout(20000);
  await context.addCookies([{name:AUTH_SESSION_COOKIE,value:createSessionToken({username:"vhal-browser",displayName:"检查验收",role:"admin"}),url:baseURL!}]);
  await context.route("**/api/backup/**",r=>r.fulfill({json:{configured:false}}));
  await context.route("**/api/jira/handover",r=>r.fulfill({json:{}}));
  await context.route("**/api/feishu/process-result",r=>r.fulfill({json:{success:true}}));
  await context.route("**/api/embeddings",r=>r.fulfill({json:{model:"test",embeddings:[]}}));
  await context.route("**/api/issues/process",r=>{
   const body=r.request().postDataJSON();return r.fulfill({json:{issueKey:"TEST-1",analysisRunId:body.runId,analysisGroupName:"VHAL验收组",replyText:"继续后续分析的结论",model:"test",versionVhalCheck:responseCheck,configurationResolution:configurationFixture(responseCheck.resolution.status==="ok"?"auto":"manual"),stages:{SOC_SCC_VERSION_CHECK:"unknown",VHAL_VERSION_RESOLUTION:responseCheck.resolution.status,VHAL_SIGNAL_CONFIG_CHECK:responseCheck.config.status}}});
  });
  page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");await page.getByText("创建第一个规则组",{exact:true}).waitFor();
  await page.evaluate(async()=>{
   const database=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("IvacpDB");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   try {await new Promise<void>((resolve,reject)=>{
    const tx=database.transaction(["ruleGroups","snapshots"],"readwrite");
    tx.objectStore("ruleGroups").put({id:"vhal-g",name:"VHAL验收组",jql:"project = TEST",expand:"",base_paths:{json_dir:"",dbc_dir:"",proto_dir:""},model_to_files:{},prompts:{},sortOrder:0,createdAt:new Date(),updatedAt:new Date()});
    tx.objectStore("snapshots").put({id:"vhal-s",source:"jira",jiraProvider:"default",ticketKey:"TEST-1",ruleGroupId:"vhal-g",origin:"filter",title:"D01 检查",rawData:{description:"测试"},createdAt:new Date()});
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
   });}finally{database.close();}
  });
 });
 afterAll(async()=>{await context?.close();await browser?.close();});
 it("分析响应保存至IndexedDB，刷新后可查看未知、冲突和完整证据",async()=>{
  await page.goto("/tickets/jira/TEST-1?group=vhal-g&provider=default");
  await page.getByRole("button",{name:"开始分析",exact:true}).click();
  await page.getByRole("heading",{name:"版本与 VHAL 配置检查",exact:true}).waitFor();
  await page.getByText("hash冲突，继续分析",{exact:true}).waitFor();
  await page.reload();await page.getByRole("heading",{name:"版本与 VHAL 配置检查",exact:true}).waitFor();
  await page.getByRole("heading",{name:"本次基础配置",exact:true}).waitFor();
  await page.getByText("查看配置来源与回退证据",{exact:true}).click();
  await page.getByText("用户默认基础配置：SOC/SCC缺失，整体回退",{exact:true}).waitFor();
  await page.getByText("查看检查证据与逐信号结果",{exact:true}).click();
  await page.getByText("版本检查：unknown；hash冲突，继续分析",{exact:true}).waitFor();
  for(const width of [375,768,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);}
  expect(errors).toEqual([]);
 });
 it("RTC关联的来源与VS提交经保存、刷新和重跑历史保留",async()=>{
  responseCheck=versionVhalVsFixture();
  await page.getByRole("button",{name:"重新分析",exact:true}).click();
  await page.locator("dd").filter({hasText:"2.2.36"}).waitFor();
  await page.reload();
  await page.locator("dd").filter({hasText:"2.2.36"}).waitFor();
  await page.getByRole("heading",{name:"本次基础配置",exact:true}).waitFor();
  await page.getByText("查看配置来源与回退证据",{exact:true}).click();
  await page.getByText("自动基础配置：chery-8255 / t1x-sop；T1J-FL3-8255；已冻结分支当前配置",{exact:true}).waitFor();
  await page.getByText("查看检查证据与逐信号结果",{exact:true}).click();
  const summary=page.locator("pre").filter({hasText:"用于定位归档的 VS commit"}).first();
  await expect.poll(()=>summary.textContent()).toContain("82c3bd19de7003f4f2de20cbf6a9a8be6ccf7de1");
  expect(await summary.textContent()).toContain("a0ffcea6b5db76730bde833e742ba01192befa6a");
  expect(await summary.textContent()).toContain("Vehicle property ID=Test_PROP");
  await page.getByRole("button",{name:"重新分析",exact:true}).click();
  await page.getByRole("button",{name:"重新分析",exact:true}).waitFor({state:"visible"});
  await page.getByRole("tab",{name:/历史/}).click();
  const history=page.getByRole("tabpanel",{name:/历史/});
  // History contains both the legacy unknown run and the RTC run; select by evidence.
  await history.getByRole("heading",{name:"本次基础配置",exact:true}).first().waitFor();
  const rtcEvidence=history.locator("details").filter({hasText:"用于定位归档的 VS commit"}).first();
  await rtcEvidence.locator("summary").first().click();
  await rtcEvidence.locator("pre").first().waitFor();
  expect(errors).toEqual([]);
 });
});
