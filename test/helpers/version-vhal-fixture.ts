import type { VersionVhalCheck } from "@/domain/analysis/version-vhal";
export function versionVhalFixture():VersionVhalCheck {
 return {schemaVersion:1,issueKey:"TEST-1",source:"jira",recordedAt:"2026-10-30T00:00:00Z",socScc:{result:"unknown",pairs:[]},resolution:{status:"ambiguous",reason:"提交冲突",hashes:[],candidates:[],archives:[]},config:{status:"unknown",dbcs:[],signals:[],stop:false},warnings:["hash冲突，继续分析"],summary:"版本检查：unknown；hash冲突，继续分析"};
}

export function versionVhalVsFixture(): VersionVhalCheck {
 const check = versionVhalFixture();
 const source = {projectName:"chery-8255",branchGroupName:"t1x-sop",repoName:"automotive-custom",repoPath:"android/vehicle",gitBranchName:"android-release",commitid:"82c3bd19de7003f4f2de20cbf6a9a8be6ccf7de1",rtcids:["RTC1-3103705"]};
 const vs = {...source,repoName:"vs",repoPath:"qnx/vs",gitBranchName:"qnx-release",commitid:"a0ffcea6b5db76730bde833e742ba01192befa6a",matchedRtcids:["RTC1-3103705"]};
 check.resolution = {status:"ok",reason:"已通过 RTC 关联 VS 提交定位",hashes:[],candidates:[source],archives:[{file:`configuration/chery-8255/t1x-sop/bak/${vs.commitid}_RTC1-3103705_82552236`,code:"82552236"}],version:"2.2.36",vsAssociation:{status:"ok",reason:"唯一 VS 提交",candidates:[vs],selected:vs,unmatchedRtcids:[]}};
 check.config = {status:"ok",model:"D01",dbcs:["car_D01.dbc"],stop:false,signals:[{signal:"Test_PROP",status:"configured",caseMismatch:false,hits:[{sheet:"business",row:7,column:"Vehicle property ID",value:"Test_PROP",project:"D01"}],caseCandidates:[]}]};
 check.warnings = [];
 check.summary = `来源 commit：${source.commitid}\nRTC：RTC1-3103705\n用于定位归档的 VS commit：${vs.commitid}\nVHAL 版本：2.2.36\nTest_PROP：configured；business:7 Vehicle property ID=Test_PROP Project=D01`;
 return check;
}
