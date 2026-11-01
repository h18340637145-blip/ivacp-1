import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
import {createCanvas} from '@napi-rs/canvas';
import {pages} from './content.mjs';
const ROOT='/Users/huo2wx/coding/nextjs/ivacp/ivacp-vs',B=path.join(ROOT,'docs/loop-engineering/team-sharing-10-build'),O=path.join(ROOT,'output/ivacp-team-sharing-10pages-20261101');
const FONT='Microsoft YaHei',C={bg:'#F5F2EC',ink:'#242A27',muted:'#636A65',green:'#316754',pale:'#E6EEE8',red:'#AE412D',redPale:'#F6E8E2',line:'#CECFC6',white:'#FFFFFF'};
const p=Presentation.create({slideSize:{width:1600,height:900}});p.theme.defaultFont=FONT;
const cv=createCanvas(20,20).getContext('2d'),checks=[];
function tx(s,text,x,y,w,h,size=28,color=C.ink,bold=false,name=''){const t=s.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});t.text=text;t.text.style={typeface:FONT,fontSize:size,color,bold};t.text.insets=0;return t;}
function node(s,text,x,y,w=280,h=108,tone='normal'){cv.font=`28px "${FONT}"`;for(const l of text.split('\n')){const width=cv.measureText(l).width;if(width>w-16)checks.push({where:'图示节点',text:l,width,limit:w-16});}const n=s.shapes.add({geometry:'rect',name:'技术图节点',position:{left:x,top:y,width:w,height:h},fill:tone==='red'?C.redPale:tone==='green'?C.pale:C.white,line:{fill:tone==='red'?C.red:tone==='green'?C.green:C.line,width:1.8}});n.text=text;n.text.style={typeface:FONT,fontSize:28,color:tone==='red'?C.red:C.ink,alignment:'center',verticalAlignment:'middle'};n.text.insets={left:8,right:8,top:10,bottom:10};return n;}
function conn(s,a,b,from='right',to='left',red=false){return s.shapes.connect(a,b,{kind:from==='right'&&to==='left'&&Math.abs((a.position.top+a.position.height/2)-(b.position.top+b.position.height/2))<1?'straight':'elbow',fromSide:from,toSide:to,line:{fill:red?C.red:C.green,width:2.5},tail:{type:'triangle',width:'med',length:'med'}});}
function caption(s,text,x,y,w=290,red=false){return tx(s,text,x,y,w,38,25,red?C.red:C.muted);}
function arrow(s,x1,x2,y,label,color=C.green){s.shapes.add({geometry:'connector',name:'时序消息',kind:'straight',position:{left:Math.min(x1,x2),top:y,width:Math.abs(x2-x1),height:0},line:{fill:color,width:2.3},...(x2<x1?{head:{type:'triangle'}}:{tail:{type:'triangle'}})});tx(s,label,Math.min(x1,x2)+8,y-34,Math.abs(x2-x1)-16,32,27);}
function lifeline(s,x,y,h){s.shapes.add({geometry:'connector',name:'时序生命线',kind:'straight',position:{left:x,top:y,width:0,height:h},line:{fill:C.line,width:1.5,style:'dashed'}});}
function flow(s,labels,cols=3,y=240,dy=220,w=280,h=108){const a=[];for(let i=0;i<labels.length;i++){let row=Math.floor(i/cols),col=row%2?cols-1-i%cols:i%cols;let n=node(s,labels[i],80+col*320,y+row*dy,w,h,i===labels.length-1?'green':'normal');if(i){const same=row===Math.floor((i-1)/cols);conn(s,a[i-1],n,same?(row%2?'left':'right'):'bottom',same?(row%2?'right':'left'):'top');}a.push(n);}return a;}
function explanations(s,d){d.groups.forEach(([head,body],i)=>{const y=226+i*134;tx(s,head,1085,y,445,40,31,C.green,true,`解释组${i+1}-标题`);tx(s,body,1085,y+48,445,78,28,C.ink,false,`解释组${i+1}-内容`);cv.font=`28px "${FONT}"`;for(const line of body.split('\n')){const width=cv.measureText(line).width;if(width>445)checks.push({slide:d.title,where:head,text:line,width});}});}
const audit={},mapping=[];let manuscript='# IVACP 项目介绍：10 页图文版逐页讲解稿\n\n总时长约 35 分钟。新版保留原 18 页文件，按指定十个主题重组，每页一张可编辑技术图、4 组关键解释和一句结论。细节、异常与源码依据保留在讲解备注及本稿。\n\n';
for(let i=0;i<pages.length;i++){
 const d=pages[i],s=p.slides.add();s.background.fill=C.bg;
 tx(s,d.title,65,44,1470,70,46,C.ink,true,'页面主题');tx(s,d.sub,67,133,1460,55,28,C.muted,false,'主题说明');
 explanations(s,d);tx(s,d.take,67,789,1460,54,28,d.kind==='future'?C.red:C.green,true,'一句结论');tx(s,d.status,67,856,1350,28,20,C.muted,false,'证据状态');tx(s,String(i+1).padStart(2,'0'),1470,852,65,32,21,C.muted,false,'页码');
 switch(d.kind){
 case 'value':{
 const ticket=node(s,'问题工单\n描述、评论与附件',80,235),config=node(s,'车型与版本配置\nJSON / DBC / Proto',80,475),core=node(s,'IVACP\n组织分析与协作',400,355,280,120,'green'),evidence=node(s,'分析证据与结论\n曲线、日志和来源',720,235),review=node(s,'人工复核与回填\n纠错与业务决定',720,475),asset=node(s,'团队资产\n样本、模板与知识',400,650,280,90);
 conn(s,ticket,core,'right','left');conn(s,config,core,'right','left');conn(s,core,evidence,'right','left');conn(s,core,review,'right','left');conn(s,core,asset,'bottom','top');break;}
 case 'architecture':{
 const ui=node(s,'浏览器\n页面与任务编排',80,230),api=node(s,'Next.js 服务\n鉴权、适配与分析',400,230,280,108,'green'),ext=node(s,'Jira / 飞书 CLI\nQwen / CAN 工具',720,230);
 const idb=node(s,'IndexedDB\n浏览器业务状态',80,460),sql=node(s,'MySQL\n镜像与团队能力',400,460),disk=node(s,'本地文件\n运行产物与配置',720,460);
 conn(s,ui,api);conn(s,api,ext);conn(s,ui,idb,'bottom','top');conn(s,api,sql,'bottom','top');conn(s,api,disk,'bottom','top');
 const term=node(s,'浏览器终端',80,660,280,75),gw=node(s,'独立终端网关',400,660,280,75,'green'),ssh=node(s,'白名单 SSH',720,660,280,75);conn(s,term,gw);conn(s,gw,ssh);break;}
 case 'feishu':flow(s,['已有登录与规则组\nMQL、车型与提示词','筛票与唯一归属\n完整工单身份','创建任务与快照\n独立 task / runId','共享分析\n证据与配置判断','保存、展示与恢复\n完整产物与运行门禁','人工复核与回填\n独立授权、分别记账'],3,250,250);break;
 case 'input':{
 const rows=[['字段、评论与附件','分析输入快照\n固定本次 rawData'],['原票富文本与图片','本票查看缓存\n不覆盖旧分析 run'],['Buildinfo / 同目录 DLT','SOC / SCC 原文\n保留目录与文件来源']];
 rows.forEach(([a,b],r)=>{let y=240+r*170;const l=node(s,a,80,y,350,110),rr=node(s,b,580,y,420,110,r===0?'green':'normal');conn(s,l,rr);});break;}
 case 'evidence':{
 const labels=['下载、解压与配置','Step1 需求提取','Step2 真实信号映射','CAN 与 Step3 汇合','证据整理与版本检查','Step4 日志摘要','Step5 结论与校准','完整产物后发布成功'];const a=[];
 labels.forEach((label,k)=>{const row=Math.floor(k/2),col=row%2?1-k%2:k%2;const n=node(s,label,80+col*520,220+row*140,400,92,k===7?'green':'normal');if(k){const same=row===Math.floor((k-1)/2);conn(s,a[k-1],n,same?(row%2?'left':'right'):'bottom',same?(row%2?'right':'left'):'top');}a.push(n);});break;}
 case 'config':{
 const identity=node(s,'版本、分支与完整别名\n唯一候选',80,235,480,112),check=node(s,'同步清单与文件验证\n内容、身份与读取一致性',80,420,480,112),freeze=node(s,'冻结当前有效配置\nrun/effective-config',80,615,480,112,'green'),fallback=node(s,'失败或身份冲突\n整套用户配置回退',680,420,320,112,'red'),auditnode=node(s,'requested / actual\n原运行身份保持',680,615,320,112,'green');
 conn(s,identity,check,'bottom','top');conn(s,check,freeze,'bottom','top');conn(s,check,fallback,'right','left',true);conn(s,fallback,auditnode,'bottom','top');conn(s,freeze,auditnode);caption(s,'成功',260,560,100);caption(s,'失败',585,382,90,true);break;}
 case 'vhal':{
 const a=flow(s,['最新编译日期 hash\n唯一来源 commit','同项目 / 分支组\n来源 RTC 列表','唯一 VS commit\nRTC 完整匹配','根目录 / bak 归档\n解析 VHAL 版本','对应 VHAL Excel\n读取前后摘要一致','信号配置检查\n核对大小写与车型'],3,235,215,280,106);
 const stop=node(s,'Vehicle property ID / MCU UP / IVI DOWN 精确匹配\nProject 校验完整车型，全部确认缺少且无豁免才停止',80,660,920,80,'green');conn(s,a[5],stop,'bottom','top');break;}
 case 'recovery':{
 const actors=['浏览器','IndexedDB','业务服务','运行产物','飞书平台'],xs=[120,325,530,735,940];actors.forEach((a,k)=>{node(s,a,xs[k]-90,220,180,66,'green');lifeline(s,xs[k],294,450);});
 const msgs=[[0,1,'创建 task'],[0,2,'提交 runId'],[2,3,'完整响应'],[2,3,'完成标记'],[0,1,'最新运行提交'],[0,2,'按原 run 恢复'],[2,0,'重签凭据后恢复'],[0,1,'人工复核领取'],[0,4,'评论 / 流转分别授权与记账']];msgs.forEach(([a,b,text],k)=>arrow(s,xs[a],xs[b],330+k*49,text));break;}
 case 'loop':{
 const a=node(s,'单一目标\n范围与验收',80,240),b=node(s,'调查与最小改动',400,240),c=node(s,'相关验证',720,240,280,108,'green'),done=node(s,'达标交付\n文档与交接同步',720,510,280,112,'green'),fix=node(s,'未达标且有新假设\n最多 2 轮修复',400,510,280,112,'red'),human=node(s,'阻塞或达到上限\n记录后交接',80,510,280,112);
 conn(s,a,b);conn(s,b,c);conn(s,c,done,'bottom','top');conn(s,c,fix,'left','right',true);conn(s,fix,b,'top','bottom',true);conn(s,fix,human,'left','right');caption(s,'Harness 持续提供产品、架构、权限和检查依据',80,700,920);break;}
 case 'future':{
 const labels=['建议收集\n作者与状态','只读筛选\n去重、补充信息','授权与任务合同\n范围及验收','持久开发队列\n幂等与暂停','隔离 Loop\n基线及预算','验证与预览\n测试、差异审查','受控合入与部署\n分别满足条件','健康与版本账本\n失败回退、暂停'];const a=[];labels.forEach((label,k)=>{const row=Math.floor(k/4),col=row%2?3-k%4:k%4;const n=node(s,label,80+col*240,250+row*260,220,120,k===7?'green':'normal');if(k){const same=row===Math.floor((k-1)/4);conn(s,a[k-1],n,same?(row%2?'left':'right'):'bottom',same?(row%2?'right':'left'):'top');}a.push(n);});break;}
 }
 const refs=[];for(const [rel,term] of d.sources){const content=await fs.readFile(path.join(ROOT,rel),'utf8');const idx=term?content.split('\n').findIndex(l=>l.includes(term)):0;refs.push(`${rel}:${idx<0?1:idx+1}${term?'；定位：'+term:''}`);audit[rel]={sha256:createHash('sha256').update(content).digest('hex')};}
 const outline=d.groups.map(([h,b])=>`- ${h}：${b.replaceAll('\n','')}`).join('\n');
 const note=`第 ${i+1} 页：${d.title}\n建议讲解：${d.time} 分钟\n证据状态：${d.status}\n\n四组关键解释：\n${outline}\n\n详细讲解：\n${d.notes}\n\n本页结论：${d.take}\n\n源码 / 文档依据（静态核对，未重跑业务验收）：\n${refs.map(x=>'- '+x).join('\n')}\n`;
 s.speakerNotes.text=note;
 manuscript+=`## 第 ${String(i+1).padStart(2,'0')} 页：${d.title}\n\n建议时长：${d.time} 分钟。证据状态：${d.status}。\n\n**一句结论：${d.take}**\n\n### 四组关键解释\n\n${outline}\n\n### 详细讲解\n\n${d.notes.replaceAll('\n','\n\n')}\n\n### 源码与文档依据\n\n${refs.map(x=>'- '+x).join('\n')}\n\n`;
 mapping.push({slide:i+1,theme:d.title,oldSlides:d.old,explanationGroups:d.groups.length,minutes:d.time});
}
for(const d of pages){cv.font=`bold 28px "${FONT}"`;const width=cv.measureText(d.take).width;if(width>1460)checks.push({where:'结论',text:d.take,width});}
await fs.writeFile(path.join(B,'text-fit.json'),JSON.stringify(checks,null,2));
if(checks.length)console.log('需要核对文字宽度：'+JSON.stringify(checks));
await fs.writeFile(path.join(O,'IVACP项目介绍-10页版逐页讲解稿.md'),manuscript);
await fs.writeFile(path.join(B,'sources.json'),JSON.stringify(audit,null,2));await fs.writeFile(path.join(B,'mapping.json'),JSON.stringify(mapping,null,2));await fs.writeFile(path.join(B,'deck.json'),JSON.stringify(p.toProto()));
await (await PresentationFile.exportPptx(p)).save(path.join(B,'candidate.pptx'));
for(let i=0;i<p.slides.items.length;i++){const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(B,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));console.log('已渲染 '+(i+1)+'/10');}
console.log('10 页 / 40 组解释 / '+pages.reduce((n,d)=>n+d.time,0)+' 分钟，全部技术图为原生对象');
