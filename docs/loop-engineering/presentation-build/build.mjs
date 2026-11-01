import fs from 'node:fs/promises';
import path from 'node:path';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
import {GlobalFonts} from '@napi-rs/canvas';
const ROOT='/Users/huo2wx/coding/nextjs/ivacp/ivacp-vs';
const BUILD=path.join(ROOT,'docs/loop-engineering/presentation-build');
const OUT=path.join(ROOT,'output/harness-loop');
const families=GlobalFonts.families.map(x=>x.family);
const FONT=['Microsoft YaHei','PingFang SC','Heiti SC','Arial Unicode MS'].find(x=>families.includes(x));
if(!FONT)throw Error('未发现可用中文字体：'+families.join(','));
console.log('中文字体：'+FONT);
const p=Presentation.create({slideSize:{width:1280,height:720}});p.theme.defaultFont=FONT;
const C={bg:'#F6F3EE',ink:'#242622',muted:'#62655F',red:'#AE3B28',green:'#356050',line:'#D5D1C9',white:'#FFFFFF'};
function tx(s,text,x,y,w,h,size=25,color=C.ink,bold=false){const a=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});a.text=text;a.text.style={fontSize:size,typeface:FONT,color,bold};return a;}
function slide(title,sub,n){const s=p.slides.add();s.background.fill=C.bg;tx(s,title,60,42,1160,66,46,C.ink,true);tx(s,sub,62,118,1150,45,25,C.muted);tx(s,String(n).padStart(2,'0'),1170,666,60,28,18,C.muted);return s;}
function tbl(s,values,x,y,w,h,widths,header=true,size=24){const t=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width:w,height:h,columnWidths:widths,values});t.borders.assign({fill:C.line,width:1,style:'solid'});for(let r=0;r<values.length;r++){for(let c=0;c<values[r].length;c++){const cell=t.getCell(r,c);cell.fill=header&&r===0?C.ink:(r%2===0?'#ECE8E0':C.bg);cell.text.style={typeface:FONT,fontSize:size,color:header&&r===0?C.white:C.ink,bold:header&&r===0};} }return t;}
const s1=slide('Harness Engineering：建立可靠的开发基础','工程逻辑：把需求、边界、架构和验收放进可复用的工作环境',1);
// 用原生表格呈现工程逻辑，文字和顺序均可编辑。
tbl(s1,[['需求与边界','结构与上下文','工具与验收'],['产品说明、权限约束','分层架构、流程、交接','测试、类型检查、构建']],60,193,1160,126,[360,390,410],true,24);
tx(s1,'优势',60,362,490,40,30,C.green,true);
tx(s1,'约束统一，降低跨模块改动偏差\n过程可追溯，方便多人和跨会话协作',60,416,550,110,26);
tx(s1,'代价与局限',670,362,530,40,30,C.red,true);
tx(s1,'规则与文档需要持续维护\n文档过期会误导，仍需安排执行与反馈',670,416,550,110,26);
tx(s1,'更适合：存量系统重构、跨模块协作、权限与数据边界复杂的需求',60,574,1150,63,26,C.ink,true);
s1.speakerNotes.text='讲解：本稿采用 IVACP 项目语境中的 Harness Engineering，指规则、上下文、工具、验证和交接组成的开发基础。Harness 也能包含反馈机制，本页突出其约束与可复用环境的作用，不将其简化为“只写文档”。优势是减少身份、数据和接口约定不一致；局限是文件存在不等于正确执行，文档也可能过期。\n项目依据：AGENTS.md 的必读文件和项目边界；docs/PRODUCT.md；docs/ARCHITECTURE.md；docs/WORKFLOW.md；docs/SEQUENCE_DIAGRAMS.md；README.md。项目相对路径基于 IVACP 仓库，核对日期 2026-11-01。';
const s2=slide('Loop Engineering：用验证反馈推动交付','工程逻辑：围绕一个目标连续推进，验收结果决定修复、交付或交接',2);
tbl(s2,[['01 确定目标','02 最小执行','03 验证结果','04 决定下一步'],['范围与验收','调查、修改','检查与证据','修复 / 交付 / 交接']],60,193,1160,126,[290,290,290,290],true,24);
tx(s2,'优势',60,362,490,40,30,C.green,true);
tx(s2,'减少人工逐轮接力\n失败证据直接指导下一次修复',60,416,550,110,26);
tx(s2,'代价与局限',670,362,530,40,30,C.red,true);
tx(s2,'验收不充分时，可能反复修错方向\n重复尝试消耗时间，需要预算与停止条件',670,416,550,110,26);
tx(s2,'更适合：可复现缺陷、范围清楚的小功能、已有测试的回归修复',60,574,1150,63,26,C.ink,true);
s2.speakerNotes.text='讲解：在同一授权目标内，Agent 根据证据连续执行，不需要用户在每一步输入“继续”。失败带回新的假设，达标交付，歧义或资源不足则交接。外部记忆使用 session-handoff.md。IVACP 已确认默认最多 2 个修复轮次，同一失败连续 2 次且没有新证据则停止盲目重试。规则不会定时唤醒或保证必然收敛。\n来源：docs/loop-engineering/loop.md 的 Discovery/Plan/Execute/Verify 与外部 Memory 思想；AGENTS.md 的最小开发循环、验证与完成、停止与交接；docs/loop-engineering/minimal-loop-agents-review.md v1.0。';
const s3=slide('场景选择与工程方式对比','Harness 提供约束基础，Loop 决定如何利用反馈继续推进',3);
tbl(s3,[['比较维度','Harness 更突出的作用','Loop 更突出的作用'],['核心关注','上下文、边界和协作一致性','目标、反馈和下一步决策'],['典型优势','规则可复用，跨模块更稳妥','短周期迭代，减少人工接力'],['主要成本','维护规则、文档和验证设施','多轮尝试与验证的执行成本'],['优先使用场景','重构、迁移、权限与接口变更','可复现缺陷、测试驱动的小改动'],['需要人做决定','需求边界、架构取舍和权限','验收歧义、反复失败和范围扩大']],60,188,1160,405,[225,468,467],true,23);
tx(s3,'需求仍模糊或涉及真实外部写入时，先澄清边界，再进入有界开发循环',60,621,1125,40,24,C.red,true);
s3.speakerNotes.text='讲解：表格强调两者的主要作用，不能理解为排他性分类。复杂项目需要 Harness，也可以在约束内逐个目标使用 Loop。小缺陷修复也依赖基本的项目规则。需求模糊先进行有界调查和澄清；权限变更、真实工单回填或迁移操作遵循现有确认门禁。没有实测数据，本页不声称提效百分比或保证成本下降。\n来源：本项目 AGENTS.md；docs/ARCHITECTURE.md 当前分层与持久化边界；docs/loop-engineering/project-adoption-review.md 关于已有能力、验收证据和候选方案的分析。该对比属于基于项目的工程判断，不是统一行业分类标准。';
const s4=slide('IVACP 的组合方式','现有 Harness 保留，最简 Loop 在同一目标内运行',4);
tx(s4,'Harness 提供依据',60,199,575,44,31,C.green,true);
tx(s4,'产品、架构、流程、时序与权限边界\n为当前目标提供上下文和验收基础',60,253,575,100,25);
tx(s4,'Loop 组织推进',60,370,575,44,31,C.red,true);
tx(s4,'AGENTS.md 约定执行与反馈\nsession-handoff.md 保存证据和下一步',60,424,580,100,25);
s4.images.add({blob:new Uint8Array(await fs.readFile(path.join(OUT,'assets/harness-loop-concept.png'))),contentType:'image/png',alt:'AI 概念插图：结构框架支撑循环轨道，表达 Harness 与 Loop 的协作',fit:'cover',position:{left:665,top:190,width:555,height:370}});
tx(s4,'项目规则：单 Agent、单目标、最多 2 轮修复，重复失败且无新证据则交接',60,587,1160,46,25,C.ink,true);
tx(s4,'测试全绿仅证明已执行检查通过，真实业务和实车结论需要对应证据',60,641,1100,35,22,C.muted);
s4.speakerNotes.text='讲解：本项目保留原 Harness，替换的是开发 Agent 的规则。单一目标开工后连续执行、验证和记录，默认最多 2 个修复轮次。session-handoff.md 是外部状态记录，恢复前核对当前源码和产物。无需新建 .loop、后台调度器或云记忆。此规则已写入仓库，但实际项目提效尚未测量。\n来源：AGENTS.md 当前文本；docs/loop-engineering/minimal-loop-agents-review.md v1.0 第 4、5、9 节；session-handoff.md 对规则实施的记录。\n图片披露：右侧为 OpenAI 内置 image_gen 生成的概念隐喻插图，非真实系统或测量图。提示词和资产保存在 output/harness-loop/assets/。';
await fs.mkdir(BUILD,{recursive:true});
await fs.writeFile(path.join(BUILD,'deck.json'),JSON.stringify(p.toProto()));
await (await PresentationFile.exportPptx(p)).save(path.join(BUILD,'candidate.pptx'));
for(let i=0;i<p.slides.items.length;i++){const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(BUILD,`slide-${i+1}.png`),new Uint8Array(await blob.arrayBuffer()));}
await fs.writeFile(path.join(BUILD,'font.json'),JSON.stringify({family:FONT}));
console.log('已导出 4 页及逐页预览');
