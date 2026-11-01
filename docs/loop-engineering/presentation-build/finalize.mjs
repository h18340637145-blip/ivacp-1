import fs from 'node:fs/promises';
import {finalizePresentation} from '/Users/huo2wx/.codex/plugins/cache/openai-primary-runtime/presentations/26.1026.10807/skills/presentations/container_tools/artifact_tool_utils.mjs';
const root='/Users/huo2wx/coding/nextjs/ivacp/ivacp-vs';
const skill='/Users/huo2wx/.codex/plugins/cache/openai-primary-runtime/presentations/26.1026.10807/skills/presentations';
const build=root+'/docs/loop-engineering/presentation-build';
const font=JSON.parse(await fs.readFile(build+'/font.json','utf8')).family;
const result=await finalizePresentation({workspaceDir:root,candidatePath:build+'/candidate.pptx',finalPath:root+'/output/harness-loop/Harness与Loop工程方式对比.pptx',pythonExecutable:'/Users/huo2wx/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','1','--require-native-table-slide','2','--require-native-table-slide','3'],explicitTotalSlideCount:4,requiredNativeTableOwnerSlides:[1,2,3],fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,receiptPath:build+'/validation.json'});
console.log(JSON.stringify(result));
