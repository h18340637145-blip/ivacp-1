import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
import {createCanvas} from '@napi-rs/canvas';
import {pages,commandAppendix} from './content.mjs';

const ROOT='/Users/huo2wx/coding/nextjs/ivacp/ivacp';
const B=path.join(ROOT,'docs/loop-engineering/progress-sharing-12-build');
const O=path.join(ROOT,'output/ivacp-progress-sharing-20261102');
const FONT='Microsoft YaHei';
const C={bg:'#F7F9FB',ink:'#142B42',muted:'#566B7C',blue:'#126A88',cyan:'#CDEDF5',light:'#EAF3F7',line:'#A5BCC9',navy:'#081B35',white:'#FFFFFF',amber:'#96601D',amberLight:'#FFF0D6',red:'#A43E3B',redLight:'#FBE9E7',green:'#23715B',greenLight:'#E4F3EC'};
const p=Presentation.create({slideSize:{width:1600,height:900}});p.theme.defaultFont=FONT;
const cv=createCanvas(20,20).getContext('2d');
const textChecks=[],sourceAudit={},coverage=[];

function wrap(text,width,size,bold=false){
  cv.font=`${bold?'bold ':''}${size}px "${FONT}"`;
  return text.split('\n').flatMap(line=>{
    if(!line)return [''];
    let lines=[],current='';
    for(const c of line){if(current&&cv.measureText(current+c).width>width){lines.push(current);current=c;}else current+=c;}
    lines.push(current);return lines;
  }).join('\n');
}
function tx(s,text,x,y,w,h,size=28,color=C.ink,bold=false,name='正文'){
  const fitted=wrap(text,w,size,bold);const lineCount=fitted.split('\n').length;
  if(lineCount*size*1.25>h+2)textChecks.push({slide:s.id,name,text,lineCount,size,h,estimatedHeight:lineCount*size*1.25});
  const t=s.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  t.text=fitted;t.text.style={typeface:FONT,fontSize:size,color,bold};t.text.insets=0;return t;
}
function rect(s,x,y,w,h,fill,line='none'){return s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:line,width:line==='none'?0:1.5}});}
function node(s,text,x,y,w=330,h=108,tone='blue',size=28){
  const palette=tone==='red'?[C.redLight,C.red]:tone==='amber'?[C.amberLight,C.amber]:tone==='green'?[C.greenLight,C.green]:[C.light,C.blue];
  const n=rect(s,x,y,w,h,palette[0],palette[1]);n.name='可编辑流程节点';
  n.text=wrap(text,w-30,size);n.text.style={typeface:FONT,fontSize:size,color:palette[1],bold:true,alignment:'center',verticalAlignment:'middle'};n.text.insets={left:15,right:15,top:12,bottom:12};
  const nlines=String(n.text).split('\n').length;
  if(nlines*size*1.25>h-20)textChecks.push({name:'节点',text,size,h,nlines});
  return n;
}
function conn(s,a,b,from='right',to='left',color=C.blue){
  return s.shapes.connect(a,b,{kind:from==='right'&&to==='left'&&Math.abs(a.position.top+a.position.height/2-b.position.top-b.position.height/2)<2?'straight':'elbow',fromSide:from,toSide:to,line:{fill:color,width:2.6},tail:{type:'triangle',width:'med',length:'med'}});
}
function rule(s,x,y,w,color=C.line){rect(s,x,y,w,2,color);}
function item(s,head,body,x,y,w=650){tx(s,head,x,y,w,44,30,C.blue,true);tx(s,body,x,y+52,w,100,27);}
function code(s,text,x,y,w,h,size=25){rect(s,x-12,y-9,w+24,h+18,C.navy);return tx(s,text,x,y,w,h,size,'#D8F1F7',false,'实际命令或接口');}
function bottom(s,text,color=C.blue){tx(s,text,65,765,1470,69,27,color,true,'本页结论');}
function footer(s,i,status){tx(s,status,65,850,1380,28,19,C.muted);tx(s,String(i+1).padStart(2,'0')+' / 12',1445,848,100,32,20,C.muted);}
function header(s,d){s.background.fill=C.bg;rect(s,65,50,7,53,C.blue);tx(s,d.title,95,42,1440,72,43,C.ink,true,'页面标题');tx(s,d.sub,67,135,1460,53,27,C.muted);}

let manuscript='# IVACP 近期进展与 Loop 实战：逐页讲稿\n\n适用：同组技术分享。12 页，建议讲解约 30 分钟，口播正文约 8,400 字；可按讨论节奏增减示例。每页详细讲稿同步嵌入 PPT 备注。素材核对日期：2026-11-02。\n\n## 分享安排\n\n| 页码 | 主题 | 建议时长 | 累计 |\n|---|---|---:|---:|\n';
let elapsed=0;
pages.forEach((d,i)=>{elapsed+=d.minutes;manuscript+=`| ${i+1} | ${d.title} | ${d.minutes} 分钟 | ${elapsed} 分钟 |\n`;});
manuscript+='\n说明：代码能力依据当前源码静态核对；历史测试数字来自 session-handoff，不是本轮重跑。外部案例为用户观察，未亲测；Loopy 能力于本轮查阅官方仓库。第 12 页可用最后半分钟收集后续讨论问题。\n\n';

for(let i=0;i<pages.length;i++){
 const d=pages[i],s=p.slides.add();
 if(d.kind==='cover'){
   s.background.fill=C.navy;
   s.images.add({blob:new Uint8Array(await fs.readFile(path.join(O,'assets/ivacp-progress-cover.png'))),contentType:'image/png',fit:'contain',position:{left:710,top:195,width:850,height:565},alt:'概念插图：车辆、分析证据与有界反馈循环'});
   tx(s,'IVACP',65,85,800,90,64,'#9BD9EB',true);
   tx(s,'近期进展\n与 Loop 实战',65,230,735,205,66,C.white,true);
   tx(s,'业务接入 · 团队知识 · 证据与版本\n有边界、可检查的 AI 开发',70,490,690,115,31,'#D1E4EF');
   tx(s,d.sub,70,704,1300,52,27,'#B7CEDD');
   tx(s,'已实现 / 待验证 / 后续建议 / 外部观察，逐页说明',70,810,1370,40,23,'#9BB3C6');
 }else{
  header(s,d);
  switch(d.kind){
   case 'auth':{
     const a=node(s,'① 同环境 OAuth 登录',65,220,440),b=node(s,'② 验证空间访问',580,220,440),c=node(s,'③ 读取待办做连通验证',1095,220,440);conn(s,a,b);conn(s,b,c);
     tx(s,'登录与重新授权',65,385,460,45,30,C.blue,true);
     code(s,'meegle auth status --format json\nmeegle auth login\n  --host project.feishu.cn',80,454,680,120,25);
     tx(s,'服务端失效提示使用 --device-code',65,620,700,40,26,C.muted);
     tx(s,'空间与待办查询',845,385,650,45,30,C.blue,true);
     code(s,'meegle project search --project-key <Key>\nmeegle mywork todo --action todo\n  --page-num 1 --format json',860,454,650,120,25);
     tx(s,'全部读取统一使用 --format json',845,620,650,40,26,C.muted);
     break;
   }
   case 'feishu':{
     const labels=['MQL 筛票\n唯一规则组归属','补齐详情 / 评论 / 附件\n固定完整工单身份','创建 task / runId\nPOST /api/issues/process','回填评论 / 状态\n分别授权与记账','人工复核\n通过或正确结论','保存结果与证据\n原 run 完整产物恢复'];
     const coords=[[65,215],[580,215],[1095,215],[65,460],[580,460],[1095,460]];
     const ns=labels.map((l,k)=>node(s,l,...coords[k],440,115,k===4?'green':'blue'));
     conn(s,ns[0],ns[1]);conn(s,ns[1],ns[2]);conn(s,ns[2],ns[5],'bottom','top');conn(s,ns[5],ns[4],'left','right');conn(s,ns[4],ns[3],'left','right');
     tx(s,'workitem query --mql …',75,351,440,42,25,C.muted);tx(s,'workitem get / comment list',590,351,450,42,25,C.muted);
     tx(s,'comment add / transition-state',75,600,455,42,24,C.muted);tx(s,'AI 建议不能代替人工门禁',590,600,440,42,25,C.muted);tx(s,'快照 + 结果 + 运行证据',1105,600,430,42,25,C.muted);
     tx(s,'失败 ≠ 空结果：认证 / MQL 失败保留审计；成功空结果才解除未命中归属',65,690,1460,45,28,C.red,true);break;
   }
   case 'bosch':{
     const a=node(s,'默认 Jira\n默认地址与凭据',65,235,320,105),b=node(s,'Bosch Jira\njiraProvider: bosch',65,415,320,105),c=node(s,'飞书项目\nCLI 与 MQL',65,595,320,105);
     const adapt=node(s,'来源适配层\n身份 / 字段 / 附件',515,415,340,105),core=node(s,'共享分析内核\nCAN · 日志 · 版本 · 结论',1000,415,530,105,'green');
     conn(s,a,adapt,'right','top');conn(s,b,adapt);conn(s,c,adapt,'right','bottom');conn(s,adapt,core);
     code(s,'POST /rest/api/2/search/jql\nJQL + nextPageToken（最多 20 × 100）',1000,230,520,102,25);
     tx(s,'连接：BOSCH_JIRA_URL · BOSCH_JIRA_USERNAME · API Token',465,590,1070,43,28,C.blue,true);
     tx(s,'回写：comment / attachments / transitions / assignee\n快照保留原 Jira 站点，防止跨站误写',465,650,1070,88,27);break;
   }
   case 'knowledge':{
     const rows=[['知识库与笔记','文本资料 / 已处理票','切段 + 向量或关键词','最多 4 段 → 回答与引用'],['个人长期记忆','事实 / 偏好 / 重要事件','新增 / 更新 / 忽略','最多 5 条 → 对话上下文'],['分析纠错样本','错误结论 + 人工正确结论','标识符 / 词法 / 向量','证据后二次召回 → 分析']];
     rows.forEach((r,k)=>{const y=220+k*158;tx(s,r[0],65,y+20,255,80,30,C.blue,true);const a=node(s,r[1],345,y,350,100),b=node(s,r[2],765,y,350,100),c=node(s,r[3],1185,y,350,100,'green',26);conn(s,a,b);conn(s,b,c);});
     tx(s,'下一步：来源与版本 · 记忆确认和失效 · 冲突处理 · 冻结真值集评测',65,710,1470,44,28,C.amber,true);break;
   }
   case 'team':{
     tx(s,'统计：观察工作与质量口径',65,215,700,48,33,C.blue,true);tx(s,'模板：复用经过整理的配置',850,215,685,48,33,C.blue,true);
     rule(s,65,280,680);rule(s,850,280,685);
     item(s,'本地 / 团队 · 年份与月份','票数、分析次数、复核、流转时间、Token\n团队只包含已备份镜像的数据',65,315,700);
     item(s,'分母与重复计数要说明','重跑不增加同一人的票数；团队按成员相加\nJira 与飞书的复核比率口径不同',65,505,700);
     const a=node(s,'发布\n规则组配置',850,325,190,108),b=node(s,'版本\n元数据',1090,325,190,108),c=node(s,'应用\n新规则组',1330,325,205,108,'green');conn(s,a,b);conn(s,b,c);
     tx(s,'共享查询、车型映射、路径和提示词\n不含凭据与票据；含本机路径需核对',850,485,685,94,29);
     tx(s,'后续建议：指定模板 / 知识 / 接收范围\n发布预览、撤回与访问审计',850,640,685,87,28,C.amber);break;
   }
   case 'labeling':{
     const texts=['镜像分析结果\n保留原始 AI 输出','人工重新标注\n建议预填，人工确认','独立版本化保存\n标注人与用途','JSONL 导出\n正例 / 负例 / 真值'];const ns=texts.map((v,k)=>node(s,v,65+k*380,235,330,115,k===3?'green':'blue'));for(let k=0;k<3;k++)conn(s,ns[k],ns[k+1]);
     item(s,'① 结论与错误类型','完全正确 / 部分正确 / 错误\n无法标注；六类错误可多选',65,425,450);
     item(s,'② 用途与正确结论','正例要求完全正确\n负例必须保留人工正确答案',580,425,440);
     item(s,'③ 质量与权限','难度、备注、标注人和版本\n保存 / 撤销需复核员及以上',1095,425,440);
     rect(s,65,660,1470,76,C.amberLight);tx(s,'回灌尚未自动化：先区分检索样本与独立评测集，再比较真实效果',85,678,1420,47,28,C.amber,true);break;
   }
   case 'vhal':{
     tx(s,'配套链',65,215,150,40,29,C.blue,true);
     const a=node(s,'Buildinfo：SOC\n同目录 DLT：SCC',225,207,350,110),b=node(s,'AI 比较有效版本号\n结构校验结果',650,207,350,110),c=node(s,'matched / unknown：继续\nmismatched：保存并停止',1075,207,460,110,'amber',27);conn(s,a,b);conn(s,b,c);
     tx(s,'历史链',65,420,150,40,29,C.blue,true);
     const hs=['最新编译日期\nBosch hash','来源 commit\n同项目 / 分支组','RTC → VS commit\n根目录 / bak 归档','VHAL Excel\n信号 + 完整车型'];const ns=hs.map((v,k)=>node(s,v,225+k*335,410,k===3?305:265,115,'blue',26));for(let k=0;k<3;k++)conn(s,ns[k],ns[k+1]);
     tx(s,'例：82552235 → V2.2.35；查 Vehicle property ID / MCU UP / IVI DOWN',225,555,1300,50,27,C.muted);
     item(s,'停止条件要严格','版本明确不一致，或非空待查信号全部确认缺配置且无豁免',65,635,1470);break;
   }
   case 'terminal':{
     const a=node(s,'浏览器工作台',65,215,440,90),b=node(s,'独立终端网关',580,215,440,90),c=node(s,'允许的 SSH 目标',1095,215,440,90);conn(s,a,b);conn(s,b,c);
     tx(s,'同步已提交配置',65,355,690,45,32,C.blue,true);
     tx(s,'rev-parse → log → ls-tree → cat-file\n校验 blob → 暂存发布 → 清单 / 备份',65,421,705,103,28);
     tx(s,'JSON / DBC / Proto / type.h / Excel\n写入 configuration 并维护 commit / RTC',65,568,705,103,28,C.muted);
     tx(s,'每目标配置的生效规则',850,355,685,45,32,C.blue,true);
     tx(s,'读取：project_<目标名>.json 优先\n缺失回退 docs/project.json',850,421,685,102,29);
     tx(s,'管理员导入 → 默认文件\n其他登录用户 → 目标专属文件\n覆盖前备份；导出当前生效文件',850,563,685,137,28);
     break;
   }
   case 'loop':{
     const a=node(s,'目标 / 范围 / 验收',65,235,320,100),b=node(s,'调查与最小改动',495,235,320,100),c=node(s,'固定检查与证据',925,235,320,100,'green');conn(s,a,b);conn(s,b,c);
     const fix=node(s,'未达标 + 有新假设\n修复并复跑',495,465,320,112,'amber'),done=node(s,'全部必需验收满足\n文档与交接后交付',925,465,320,112,'green'),stop=node(s,'阻塞 / 上限 / 无进展\n记录并交接',65,465,320,112,'red');
     conn(s,c,done,'bottom','top');conn(s,c,fix,'bottom','right',C.amber);conn(s,fix,b,'top','bottom',C.amber);conn(s,fix,stop,'left','right',C.red);
     tx(s,'通过',1110,380,130,42,26,C.green,true);tx(s,'检查分层',1300,235,235,45,29,C.blue,true);tx(s,'逻辑与类型\nlint 与架构\n浏览器与持久化\n真实环境验收',1300,310,235,180,26,C.muted);tx(s,'未通过',840,411,150,40,25,C.amber,true);
     tx(s,'Harness：产品、架构、工具、测试、权限',65,640,1470,44,30,C.blue,true);
     tx(s,'最多 2 轮修复；同一失败连续 2 次且无新证据即停；不能删除测试或放宽标准',65,703,1470,44,27,C.muted);break;
   }
   case 'case':{
     const a=node(s,'首次 ESLint 检查失败\nReact Hooks 规则',65,235,440,122,'red'),b=node(s,'AI 修正状态声明顺序\n与 effect 内同步 setState',580,235,440,122,'amber'),c=node(s,'复跑 ESLint 通过\n修复轮次 1/2',1095,235,440,122,'green');conn(s,a,b,'right','left',C.amber);conn(s,b,c,'right','left',C.green);
     const metrics=[['539','Vitest 用例通过'],['41','用例跳过'],['0','typecheck 错误']];metrics.forEach(([n,label],k)=>{const x=85+k*500;tx(s,n,x,420,430,95,72,k===1?C.amber:C.green,true);tx(s,label,x,530,430,50,29);});
     rect(s,65,642,1470,97,C.amberLight);tx(s,'未验证：构建 · 浏览器导入导出与 analyst 交互 · 真实 Gateway / SSH\n历史交接结果，非本轮重跑；跳过不等于通过',85,657,1430,81,27,C.amber);break;
   }
   case 'external':{
     const texts=['定时触发\n读取留言板','只读筛选\n去重 / 范围 / 清晰度','形成任务合同\n授权 / 验收 / 预算','开发 Loop\n修改 → 验证 → 修复'];const ns=texts.map((v,k)=>node(s,v,65+k*380,220,330,110,'blue',27));for(let k=0;k<3;k++)conn(s,ns[k],ns[k+1]);
     const r=node(s,'受控部署 → 健康检查 → 失败回退 / 暂停',825,435,710,95,'amber');conn(s,ns[3],r,'bottom','top',C.amber);
     item(s,'Loopy 的作用','整理、审查、改写和运行有界循环提示词\n不自动创建定时器或授予发布权限',65,420,690);
     tx(s,'借鉴顺序：只读筛选 → 小范围开发试点 → 评估受控发布',65,642,1470,48,31,C.blue,true);
     tx(s,'来源：Forward-Future/loopy 官方仓库；留言板案例仅为用户观察，未亲测',65,705,1470,42,25,C.muted);break;
   }
  }
  bottom(s,d.take,d.kind==='case'||d.kind==='external'?C.amber:C.blue);
  footer(s,i,d.kind==='case'?'证据：2026-11-02 交接记录；自动检查与真实业务验收分开':d.kind==='external'?'外部观察与后续借鉴；非 IVACP 已实现能力':'依据：当前源码与项目文档静态核对；本轮未重跑真实业务');
 }
 const refs=[];
 for(const [rel,term] of d.refs){const content=await fs.readFile(path.join(ROOT,rel),'utf8');const ln=content.split('\n').findIndex(l=>l.includes(term));if(term&&ln<0)throw new Error(`来源锚点未命中：${rel}：${term}`);refs.push(`${rel}:${ln+1}${term?'；定位：'+term:''}`);sourceAudit[rel]={sha256:createHash('sha256').update(content).digest('hex')};}
 if(d.web)refs.push(d.web+'（2026-11-02 查阅；支持 Loopy 能力，不证明外部案例实际运行）');
 const note=`第 ${i+1} 页：${d.title}\n建议时长：${d.minutes} 分钟\n\n本页结论：${d.take}\n\n逐页讲稿：\n${d.notes}\n\n依据与证据边界：\n${refs.map(x=>'- '+x).join('\n')}\n本轮为文档制作，未运行真实工单、模型、同步、发布或业务验收。`;
 s.speakerNotes.text=note;
 manuscript+=`## 第 ${String(i+1).padStart(2,'0')} 页：${d.title}\n\n建议时长：${d.minutes} 分钟。\n\n**本页结论：${d.take}**\n\n${d.notes.split('\n').join('\n\n')}\n\n**源码与资料依据**\n\n${refs.map(x=>'- '+(x.startsWith('http')?`[Loopy 官方仓库](${d.web})（查阅于 2026-11-02）`:x)).join('\n')}\n\n`;
 coverage.push({page:i+1,title:d.title,minutes:d.minutes,refs,notesLength:d.notes.length});
}
manuscript+=commandAppendix+'\n';
await fs.writeFile(path.join(O,'IVACP近期进展-逐页讲稿与命令附录.md'),manuscript);
await fs.writeFile(path.join(B,'coverage.json'),JSON.stringify(coverage,null,2));
await fs.writeFile(path.join(B,'sources.json'),JSON.stringify(sourceAudit,null,2));
await fs.writeFile(path.join(B,'text-fit.json'),JSON.stringify(textChecks,null,2));
if(textChecks.length)console.log('文字空间预检：'+JSON.stringify(textChecks));
await fs.writeFile(path.join(B,'deck.json'),JSON.stringify(p.toProto()));
await (await PresentationFile.exportPptx(p)).save(path.join(B,'candidate.pptx'));
for(let i=0;i<p.slides.items.length;i++){const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(B,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));console.log(`已渲染 ${i+1}/12`);}
console.log(JSON.stringify({pages:pages.length,minutes:elapsed,notesChars:pages.reduce((n,d)=>n+d.notes.length,0),sourceFiles:Object.keys(sourceAudit).length,textIssues:textChecks.length}));
