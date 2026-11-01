import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
import {slides} from './content.mjs';
const ROOT='/Users/huo2wx/coding/nextjs/ivacp/ivacp-vs';
const B=path.join(ROOT,'docs/loop-engineering/team-sharing-build'),O=path.join(ROOT,'output/ivacp-team-sharing-20261101');
const FONT='Microsoft YaHei';
const C={bg:'#F5F2EC',ink:'#242A27',muted:'#636A65',green:'#316754',pale:'#E6EEE8',red:'#AE412D',redPale:'#F6E8E2',line:'#CECFC6',white:'#FFFFFF'};
const p=Presentation.create({slideSize:{width:1600,height:900}});p.theme.defaultFont=FONT;
function tx(s,text,x,y,w,h,size=28,color=C.ink,bold=false,align='left'){const t=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});t.text=text;t.text.style={typeface:FONT,fontSize:size,color,bold,alignment:align};t.text.insets=0;return t;}
function node(s,text,x,y,w=310,h=110,tone='normal'){const n=s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill:tone==='red'?C.redPale:tone==='green'?C.pale:C.white,line:{fill:tone==='red'?C.red:tone==='green'?C.green:C.line,width:1.7}});n.text=text;n.text.style={typeface:FONT,fontSize:26,color:tone==='red'?C.red:C.ink,bold:false,alignment:'center',verticalAlignment:'middle'};n.text.insets={left:12,right:12,top:14,bottom:12};return n;}
function conn(s,a,b,from='right',to='left',red=false){return s.shapes.connect(a,b,{kind:from==='right'&&to==='left'?'straight':'elbow',fromSide:from,toSide:to,line:{fill:red?C.red:C.green,width:2.5},tail:{type:'triangle',width:'med',length:'med'}});}
function arrow(s,x1,x2,y,label='',color=C.green){const reverse=x2<x1;s.shapes.add({geometry:'connector',kind:'straight',position:{left:Math.min(x1,x2),top:y,width:Math.abs(x2-x1),height:0},line:{fill:color,width:2.2},...(reverse?{head:{type:'triangle'}}:{tail:{type:'triangle'}})});if(label)tx(s,label,Math.min(x1,x2)+8,y-32,Math.abs(x2-x1)-16,30,24,C.ink);}
function line(s,x1,y1,x2,y2,dashed=false){s.shapes.add({geometry:'connector',kind:'straight',position:{left:x1,top:y1,width:x2-x1,height:y2-y1},line:{fill:C.line,width:1.5,style:dashed?'dashed':'solid'}});}
function table(s,values,x,y,w,h,widths,size=26){const t=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width:w,height:h,columnWidths:widths,values});t.borders.assign({fill:C.line,width:1});for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){const cell=t.getCell(r,c);cell.fill=r===0?C.ink:r%2===0?'#EAE7E0':C.bg;cell.text.style={typeface:FONT,fontSize:size,color:r===0?C.white:C.ink,bold:r===0};}return t;}
function base(d,i){const s=p.slides.add();s.background.fill=C.bg;tx(s,d.title,65,43,1465,72,46,C.ink,true);tx(s,d.sub,67,132,1460,64,28,C.muted);tx(s,d.take,67,784,1460,55,27,d.status.startsWith('未来')?C.red:C.green,true);tx(s,d.status,67,855,1320,28,20,C.muted);tx(s,String(i+1).padStart(2,'0'),1472,852,65,32,21,C.muted);return s;}
function flow(s,labels,y=240,rows=2){const n=labels.length,cols=Math.ceil(n/rows),w=(1460-(cols-1)*60)/cols,h=112;const a=[];for(let i=0;i<n;i++){const r=Math.floor(i/cols),c=r%2?cols-1-i%cols:i%cols;const item=node(s,labels[i],68+c*(w+60),y+r*230,w,h,i===n-1?'green':'normal');if(i){const last=a[i-1];conn(s,last,item,r===Math.floor((i-1)/cols)?(r%2?'left':'right'):'bottom',r===Math.floor((i-1)/cols)?(r%2?'right':'left'):'top');}a.push(item);}return a;}
function sequence(s,actors,msgs){const start=155,end=1445,step=(end-start)/(actors.length-1),xs=actors.map((_,i)=>start+i*step);actors.forEach((a,i)=>{node(s,a,xs[i]-113,208,226,65,'green');line(s,xs[i],282,xs[i],752,true);});msgs.forEach((m,i)=>{const y=320+i*55;arrow(s,xs[m[0]],xs[m[1]],y,m[2],m[3]?C.red:C.green);});}
function para(s,head,body,x,y,w=680){tx(s,head,x,y,w,44,32,C.green,true);tx(s,body,x,y+58,w,150,28);}
const sourceAudit={};let manuscript='# IVACP 项目介绍：逐页讲解稿\n\n讲解总时长约 35 分钟。页码与 PPT 一一对应。技术现状依据本次源码静态核对，历史验证未重跑。未来留言板方案尚未实现。\n\n';
for(let i=0;i<slides.length;i++){
 const d=slides[i],s=base(d,i);
 switch(d.kind){
 case 'cover':{
  // 主标题可编辑，概念图片不承担架构证据。
  s.shapes.items[0].text='IVACP';s.shapes.items[0].position={left:65,top:65,width:680,height:100};s.shapes.items[0].text.style={typeface:FONT,fontSize:74,bold:true,color:C.ink};
  s.shapes.items[1].text='车辆智能分析与协作平台';s.shapes.items[1].position={left:70,top:185,width:670,height:100};s.shapes.items[1].text.style={typeface:FONT,fontSize:43,bold:true,color:C.ink};
  tx(s,'飞书工单与证据链\n版本与配置确认\n后续小功能的 Loop 迭代',70,342,635,210,34);
  tx(s,'同组技术分享   2026.11.01   约 35 分钟',70,620,1000,48,26,C.muted);
  s.images.add({blob:new Uint8Array(await fs.readFile(path.join(O,'assets/ivacp-concept.png'))),contentType:'image/png',fit:'cover',position:{left:760,top:195,width:770,height:500},alt:'AI 概念插图：车辆电子分析、信号与证据层'});break;}
 case 'features':table(s,[['使用路径','主要功能','团队需要了解的边界'],['配置与入口','规则组、模板、筛票、指定 Jira 单票','按来源、站点、车型与权限配置'],['分析与判断','CAN 曲线、日志、版本、AI / 人工复核','查看结果、复核与回填分别操作'],['团队协作','统计报告、标注、纠错样本、few-shot','统计范围、人工真值与账号隔离'],['知识与助手','对话、知识库、记忆、笔记','引用来源、用户隔离、取消与并发'],['运维与扩展','终端、配置同步、备份迁移、API、评测','白名单远端、隔离验证与独立授权']],68,225,1460,498,[270,570,620]);break;
 case 'architecture':{
 const ui=node(s,'浏览器 app / features\n页面、交互与任务编排',70,230,390,112,'green');
 const idb=node(s,'IndexedDB / Dexie\n快照、任务、结果与助手数据',70,495,390,112);
 const api=node(s,'Next.js API / server\n鉴权、适配与流水线',600,230,390,112,'green');
 const sql=node(s,'MySQL\n业务镜像与团队能力',600,495,390,112);
 const ext=node(s,'Jira REST / 飞书 CLI\nQwen / 本地 CAN 工具',1140,230,390,112);
 const disk=node(s,'本地运行产物与配置\nlog / configuration / 缓存',1140,495,390,112);
 conn(s,ui,api);conn(s,api,ext);conn(s,ui,idb,'bottom','top');conn(s,api,sql,'bottom','top');conn(s,api,disk,'bottom','top');
 tx(s,'同源请求',472,246,125,32,21);tx(s,'外部适配',1010,246,110,32,21);
 tx(s,'domain 提供纯规则，shared 提供数据库与通用工具',70,623,1420,32,24,C.muted);
 const term=node(s,'浏览器终端',70,683,390,66),gw=node(s,'独立 terminal-gateway',600,683,390,66,'green'),ssh=node(s,'白名单 SSH 目标',1140,683,390,66);conn(s,term,gw);conn(s,gw,ssh);tx(s,'WebSocket',472,663,125,30,20,C.muted);tx(s,'SSH',1010,663,110,30,20,C.muted);break;}
 case 'identity':table(s,[['身份 / 实体','示意关系','约束作用'],['工单来源身份','P + issue + 12345；Jira 另含站点','跨项目 / 类型 / 站点分开关联'],['规则组与 assignment','ruleGroupId + 当前工作项归属','当前归属可变化，结果与历史保留'],['筛票与分析快照','filterRun 候选；process 输入快照','原输入与之后的原票刷新分开'],['任务与运行','processTask.id = runId','防重、迟到响应门禁与独立产物'],['结果与历史','result 关联 task / snapshot / assignment','显式重跑归档，恢复核对原 run']],68,225,1460,498,[300,590,570]);break;
 case 'feishuFlow':flow(s,['登录与规则组\n角色、MQL、车型文件','筛票与唯一归属\n工作项身份和审计','任务与输入快照\n独立 task / runId','共享分析与证据\nCAN、日志和配置','保存、展示与恢复\n完整产物与最新运行','人工复核与回填\n独立授权和记账']);tx(s,'同一主线示例：P / issue / 12345，来源字段为 meegle',68,720,1400,40,26,C.muted);break;
 case 'mql':{
 const a=flow(s,['解析项目 / MQL','查询目标与优先组','按 sortOrder / id 判归属','最新运行事务提交'],225,1);
 table(s,[['返回情形','归属与结果处理','界面与后续'],['成功（含空结果）','更新命中，解除未命中归属','保留分析结果和历史'],['目标 / 比较查询失败','不提交本次归属清理','记录失败，不能展示旧快照冒充本轮'],['超时与迟到响应','90 秒截止，拒绝旧运行提交','CLI 默认 30 秒，允许独立新运行']],68,440,1460,275,[380,560,520],25);break;}
 case 'contextSequence':sequence(s,['浏览器详情','上下文 API','本票缓存','飞书 CLI'],[[0,1,'查看原票上下文，携带完整工单身份'],[1,2,'先读 context.json 与图片映射'],[2,1,'命中有效缓存则返回'],[1,3,'缺失或手动刷新时，只读字段 / 评论'],[1,3,'按预算下载缺失图片'],[1,2,'校验后发布缓存，失败保留旧内容'],[1,0,'返回富文本与同源鉴权图片']]);break;
 case 'pipeline':flow(s,['下载与解压\n附件分类、缺失提前结束','有效配置冻结\nSOC / SCC 与别名','Step1 需求提取\n评论和已有上下文','Step2 信号映射\nJSON / Proto 真候选','CAN 与 Step3\n局部并行后汇总证据','版本 / VHAL 检查\n明确条件可提前结束','Step4 日志摘要\nAndroid / QNX','Step5 结论与校准\n完整产物后发布成功']);tx(s,'证据包括：signals、CAN 摘要、extract、evidence-packet、版本与有效配置报告',68,724,1460,40,25,C.muted);break;
 case 'configuration':{
 flow(s,['解压提取版本\n同目录 SOC / SCC','项目分支与完整别名\nhash 可用时交叉消歧','校验同步清单与文件\nJSON / Proto / DBC','冻结到当前 run\n实际路径与 SHA-256'],225,1);
 const fallback=node(s,'任一步失败或身份冲突\n整套回退用户配置',68,480,440,130,'red');
 const frozen=node(s,'冻结可用用户文件\n保留原缺失能力边界',565,480,440,130);
 const audit=node(s,'保存 requested 与 actual\n原运行身份保持',1080,480,450,130,'green');
 conn(s,fallback,frozen);conn(s,frozen,audit);tx(s,'自动成功与手动回退都留档，禁止混用不同来源的配置集合',68,695,1460,44,29,C.red,true);break;}
 case 'versions':{
 table(s,[['来源','提取与选择规则','结果用途'],['Buildinfo.txt','MAIN_VERSION，按目录保留','SOC 原文和配置分支候选'],['同目录 Scc-*.dlt','解码 payload，取 [Vip-App]App:','SCC 原文、配对与车型别名'],['Android hash 行','hash + 编译日期，最新日期唯一','来源提交与历史 VHAL 追溯']],68,220,1460,300,[345,600,515],26);
 table(s,[['逐对比较的结果','matched','unknown','mismatched'],['结构校验后按结果分支','全部明确匹配，继续','缺失或不确定，继续','任一明确不一致，停止']],68,585,1460,150,[350,370,370,370],25);break;}
 case 'vhal':{
 flow(s,['Android 最新编译 hash\n唯一来源 commit','来源 commit 的 RTC\n限定同项目 / 分支组','唯一 VS commit\nRTC 完整匹配','根目录 / bak 归档\n82552236 → 2.2.36','对应 VHAL Excel\n读取前后摘要一致','三列精确匹配与 Project\n按实际 DBC 识别车型'],215,2);
 tx(s,'精确匹配 Vehicle property ID / MCU UP / IVI DOWN，Project 验证完整车型',68,640,1460,46,27,C.muted);
 tx(s,'停止条件：非空待查列表全部确认缺少或车型未配置，且无仅大小写差异豁免',68,710,1460,52,27,C.red,true);break;}
 case 'recoverySequence':sequence(s,['浏览器','IndexedDB','分析 / 恢复 API','运行产物','飞书写接口'],[[0,1,'事务创建 task 与输入快照'],[0,2,'提交 process(runId)'],[2,3,'完整响应后发布 success'],[0,1,'核对最新 run 后保存结果'],[0,2,'刷新后 recover(原 run)'],[2,3,'核对产物，重签凭据'],[0,1,'人工复核后事务领取回填'],[0,4,'评论与流转分别授权、分别记账']]);break;
 case 'reliability':table(s,[['证据层次','当前可说明的事实','不能据此推导'],['本次源码核对','身份、冻结、门禁、保存顺序有实现','本次真实工单端到端成功'],['历史隔离测试','服务、事务、CLI、离线 CAN、浏览器有记录','外部系统、所有业务与实车已验收'],['指标与人工真值','EGR、信号召回、关键判断及覆盖率','接地率等于解票准确率'],['运行与恢复','同进程可显式停止，完整成功产物可恢复','重启后任意断点继续执行'],['功能与迁移状态','多数主要入口已接通','全部目标与真实数据验收已结束']],68,225,1460,498,[300,590,570]);break;
 case 'harnessLoop':table(s,[['开发问题','Harness 提供依据','Loop 组织推进'],['做什么与边界','产品、架构、角色、接口和数据规则','当前一个已授权目标与验收'],['如何执行','分层代码、工具、测试与文档','调查、最小改动、验证、反馈'],['失败怎么办','保留约束与有效检查','带新假设修复，触及条件则交接'],['如何续接','可追溯资料与历史','交接顶部记录证据和下一步']],68,230,1460,425,[320,570,570]);tx(s,'项目落点：AGENTS.md 驱动开发方式，session-handoff.md 保存当前目标',68,705,1460,44,29,C.green,true);break;
 case 'loop':{
 const a=node(s,'一个小目标\n范围和验收',68,225,320,112),b=node(s,'最小调查与改动\n保留现有分层',448,225,320,112),c=node(s,'相关验证\n结果与证据',828,225,320,112),d=node(s,'达标交付\n同步文档与交接',1208,225,320,112,'green');conn(s,a,b);conn(s,b,c);conn(s,c,d);
 const f=node(s,'未达标且有新假设\n最多 2 轮修复',448,495,320,130,'red'),stop=node(s,'重复失败 / 上限 / 歧义\n记录证据和下一步',828,495,320,130),user=node(s,'交用户决定\n不降低验收标准',1208,495,320,130,'green');conn(s,c,f,'left','right',true);conn(s,f,b,'top','bottom',true);conn(s,c,stop,'bottom','top');conn(s,stop,user);tx(s,'适合：可复现缺陷、字段与交互改进、验收明确的小功能',68,705,1460,44,29,C.green,true);break;}
 case 'futureArchitecture':{
 flow(s,['建议与作者身份\n可见范围 / 状态','只读筛选 Agent\n去重、分类、补充信息','策略与开发授权\n管理员规则 / 任务合同','持久开发队列\n幂等领取与暂停','隔离开发 worker\n固定基线与预算','验证与差异审查\n测试、构建、预览','受控合入与发布\n最小部署凭据','版本与副作用账本\n健康检查、回退']);tx(s,'新增设施均待设计与实现；建议、任务、开发 run、候选版本分别关联',68,724,1460,40,25,C.red);break;}
 case 'futureSequence':sequence(s,['建议 / 用户','筛选 Agent','策略 / 开发者','开发 worker','发布控制'],[[0,1,'提交建议（不可信输入）'],[1,2,'筛选与候选任务'],[2,3,'A 确认 / B 预授权'],[3,2,'候选与验证证据'],[2,4,'验收与差异通过后决定合入'],[4,0,'部署与健康检查，记录候选版本'],[4,2,'失败回退上一已验证版本并暂停',true]]);break;
 case 'roadmap':{
 table(s,[['阶段','新增范围','独立验收出口'],['1 建议收集与筛选','状态、去重、后台审核与补充信息','建议可追踪，筛选不越权执行'],['2 人工确认后开发','任务合同、隔离 worker、验证预览','可复现候选、失败恢复，暂不自动上线'],['3 低风险受控发布','预授权策略、版本账本、暂停回退','全部发布条件满足，健康失败可回退']],68,225,1460,345,[350,550,560]);
 tx(s,'五个重点',68,620,1460,45,32,C.green,true);
 tx(s,'完整身份　　配置与历史版本分开　　unknown 不当通过\n完整产物才能恢复　　授权范围内使用 Loop',68,682,1460,85,29);break;}
 }
 const refs=[];for(const [rel,term] of d.sources){const full=path.join(ROOT,rel);const content=await fs.readFile(full,'utf8');const lines=content.split('\n');const idx=term?lines.findIndex(l=>l.includes(term)):0;const line=idx>=0?idx+1:1;refs.push(`${rel}:${line}${term?'；定位：'+term:''}`);sourceAudit[rel]={sha256:createHash('sha256').update(content).digest('hex')};}
 const note=`第 ${i+1} 页：${d.title}\n建议讲解：${d.time} 分钟\n证据状态：${d.status}\n\n${d.notes}\n\n讲解重点：${d.take}\n\n源码 / 文档依据（本次静态核对）：\n${refs.map(x=>'- '+x).join('\n')}\n`;
 s.speakerNotes.text=note;
 manuscript+=`## 第 ${String(i+1).padStart(2,'0')} 页：${d.title}\n\n建议时长：${d.time} 分钟。证据状态：${d.status}。\n\n**本页重点：${d.take}**\n\n${d.notes.replaceAll('\n','\n\n')}\n\n依据：\n\n${refs.map(x=>'- '+x).join('\n')}\n\n`;
}
await fs.writeFile(path.join(O,'IVACP项目介绍-逐页讲解稿.md'),manuscript);
await fs.writeFile(path.join(B,'sources.json'),JSON.stringify(sourceAudit,null,2));
await fs.writeFile(path.join(B,'deck.json'),JSON.stringify(p.toProto()));
await (await PresentationFile.exportPptx(p)).save(path.join(B,'candidate.pptx'));
for(let i=0;i<p.slides.items.length;i++){const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(B,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));console.log('已渲染 '+(i+1)+'/18');}
console.log('总时长 '+slides.reduce((s,d)=>s+d.time,0)+' 分钟，来源 '+Object.keys(sourceAudit).length+' 文件');
