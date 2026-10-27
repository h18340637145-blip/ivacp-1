import { nanoid } from "nanoid";
import type { FilterAudit } from "@/domain/entities";
import { chat } from "@/server/ai/qwen";
import { badRequest } from "@/server/http/route";
import { getMeegleWorkItem, runMeegleJson } from "@/server/meegle/cli";
import {
  decideMeegleAssignment,
  type MeegleClassification,
  type MeegleRuleGroupMatchTarget,
} from "@/server/meegle/filtering";

interface MyWorkItem {
  project_key: string;
  project_name: string;
  work_item_info: { work_item_id: number; work_item_name: string; work_item_type_key: string };
  state_info: { start_state_key_name: string };
}

interface MyWorkListResponse { list?: MyWorkItem[]; page_size?: number; }

interface ManualAssignmentIdentity {
  projectKey: string;
  workItemTypeKey: string;
  workItemId: number;
}

export interface MeegleAutoAssignRequest {
  ruleGroups: MeegleRuleGroupMatchTarget[];
  filterRuleGroupId?: string;
  manualAssignments?: ManualAssignmentIdentity[];
}

/** 自动分配审计（响应体中 createdAt 为 ISO 字符串，客户端写入 filterAudits 时补 source/ticketKey） */
export type MeegleAutoAssignAudit = Omit<FilterAudit, "source" | "ticketKey" | "createdAt" | "projectName" | "stateName"> & {
  projectName: string;
  stateName: string;
  createdAt: string;
};

const MODEL = "Qwen3-32B-FP16";
const BATCH_SIZE = 30;
const CLASSIFY_SYSTEM_PROMPT = `你是汽车软件缺陷工单分类专家。分析项目问题的 summary，从中提取项目的车型、平台和项目。

提取规则：
- 车型(carModel)：如 D01、T1J_FL3、T1J-FL3、T1JFL3、T1L_FL1 等，通常是字母+数字的编号
- 项目(project)：如 chery（奇瑞）、geely（吉利）、jitu（捷途）
- 平台(platform)：如 8255、8155、8295，通常是4位数字

重要：标题中车型和平台经常合并在一起，用下划线或连字符连接，如：
- "T1L_FL1_8255" → carModel:"T1L_FL1", platform:"8255"（最后的数字部分是平台）
- "D01-8255" → carModel:"D01", platform:"8255"
- "T1J_FL3-8255" → carModel:"T1J_FL3", platform:"8255"
- 常见格式为【车型_平台】，如【T1L_FL1_8255】

示例：
- "【T1L_FL1_8255】【台架】【中控】混合动力CLTC纯电续航里程" → carModel:"T1L_FL1", project:"chery", platform:"8255"
- "【T1L_FL1_8155】【台架】【中控】混合动力CLTC纯电续航里程" → carModel:"T1L_FL1", project:"chery", platform:"8155"
- "【T1J_FL2_8155】【台架】【中控】混合动力CLTC纯电续航里程" → carModel:"T1J_FL2", project:"chery", platform:"8155"
- "【T1P】【台架】【中控】混合动力CLTC纯电续航里程" → carModel:"T1P", project:"chery", platform:"8155"
- "【T1PJ】【台架】【中控】混合动力CLTC纯电续航里程" → carModel:"T1PJ", project:"chery", platform:"8155"
- "【T1K】【台架】【中控】混合动力CLTC纯电续航里程" → carModel:"T1K", project:"chery", platform:"8155"
- "【T1N】【台架】【中控】混合动力CLTC纯电续航里程" → carModel:"T1N", project:"chery", platform:"8155"
- "【D01_8255】chery 导航问题" → carModel:"D01", project:"chery", platform:"8255"
- "【D01hw】chery 导航问题" → carModel:"D01", project:"chery", platform:"8255"
- "【D01fl1】chery 导航问题" → carModel:"D01", project:"chery", platform:"8255"
- "【D01fl1 hw】chery 导航问题" → carModel:"D01", project:"chery", platform:"8255"
- "【D01p】chery 导航问题" → carModel:"D01", project:"chery", platform:"8255"
- "【D01 apa】chery 导航问题" → carModel:"D01", project:"chery", platform:"8255"
- "T1J_FL3 8255 奇瑞系统异常" → carModel:"T1J_FL3", project:"chery", platform:"8255"
- "捷途车机蓝牙问题" → carModel:"", project:"chery", platform:""

这些提取结果将用于匹配规则组名称（如 "chery D01-8255"、"chery T1J_FL3-8255"、"捷途"、"T1L_FL1_8255"），请尽量准确提取以便匹配。

无法确定时返回空字符串。只返回 JSON 数组，每项格式为 {"work_item_id": number, "carModel": string, "project": string, "platform": string}，不要输出其他文字。`;

function identityKey(value: ManualAssignmentIdentity): string {
  return `${value.projectKey}:${value.workItemTypeKey}:${value.workItemId}`;
}

function descriptionFromWorkItem(value: Record<string, unknown>): string {
  const fields = Array.isArray(value.workitem_fields) ? value.workitem_fields : [];
  const description = fields.find((field) => typeof field === "object" && field && (field as { field_key?: string }).field_key === "description") as { value?: unknown } | undefined;
  if (typeof description?.value === "string") return description.value;
  return typeof value.description === "string" ? value.description : "";
}

function parseClassifications(response: string, ids: number[]): Map<number, MeegleClassification> {
  const match = response.match(/\[[\s\S]*\]/);
  if (!match) return new Map();
  try {
    const parsed = JSON.parse(match[0]) as Array<{ work_item_id?: number } & MeegleClassification>;
    return new Map(parsed.filter((item) => ids.includes(Number(item.work_item_id))).map((item) => [Number(item.work_item_id), {
      carModel: item.carModel ?? "", project: item.project ?? "", platform: item.platform ?? "",
    }]));
  } catch {
    return new Map();
  }
}

export interface MeegleAutoAssignResult {
  runId: string;
  total: number;
  classified: number;
  assignments: MeegleAutoAssignAudit[];
  audits: MeegleAutoAssignAudit[];
}

/** 读取“我的待办”，用模型识别车型/项目/平台后按规则组名称或车型配置自动归属 */
export async function autoAssignMeegleWorkItems({
  ruleGroups,
  filterRuleGroupId,
  manualAssignments = [],
}: MeegleAutoAssignRequest): Promise<MeegleAutoAssignResult> {
  if (!Array.isArray(ruleGroups) || ruleGroups.length === 0) throw badRequest("ruleGroups 必须是非空数组");
  if (filterRuleGroupId && !ruleGroups.some((group) => group.id === filterRuleGroupId)) {
    throw badRequest("filterRuleGroupId 不存在于 ruleGroups 中");
  }

  const allItems: MyWorkItem[] = [];
  for (let pageNum = 1; ; pageNum += 1) {
    const page = await runMeegleJson<MyWorkListResponse>(["mywork", "todo", "--action", "todo", "--page-num", String(pageNum)]);
    const list = page.list ?? [];
    allItems.push(...list);
    if (list.length === 0 || list.length < (page.page_size ?? 50)) break;
  }

  const runId = nanoid();
  const createdAt = new Date().toISOString();
  const trigger: "all" | "rule_group" = filterRuleGroupId ? "rule_group" : "all";
  const manualKeys = new Set(manualAssignments.map(identityKey));
  const audits: MeegleAutoAssignAudit[] = [];
  const candidates: Array<{ item: MyWorkItem; description: string }> = [];
  const auditBase = (item: MyWorkItem) => ({
    id: nanoid(), runId, trigger, targetRuleGroupId: filterRuleGroupId,
    projectKey: item.project_key, projectName: item.project_name,
    workItemTypeKey: item.work_item_info.work_item_type_key, workItemId: item.work_item_info.work_item_id,
    workItemName: item.work_item_info.work_item_name, stateName: item.state_info.start_state_key_name,
    model: MODEL, carModel: "", project: "", platform: "", createdAt,
  });

  for (const item of allItems) {
    const identity = { projectKey: item.project_key, workItemTypeKey: item.work_item_info.work_item_type_key, workItemId: item.work_item_info.work_item_id };
    if (manualKeys.has(identityKey(identity))) {
      audits.push({ ...auditBase(item), decision: "skipped_manual_assignment", reason: "保留人工分配" });
      continue;
    }
    try {
      const detail = await getMeegleWorkItem(item.project_key, String(item.work_item_info.work_item_id));
      candidates.push({ item, description: descriptionFromWorkItem(detail) });
    } catch (error) {
      audits.push({ ...auditBase(item), decision: "failed", reason: `读取缺陷描述失败: ${error instanceof Error ? error.message : "unknown"}` });
    }
  }

  for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
    const batch = candidates.slice(index, index + BATCH_SIZE);
    let classifications = new Map<number, MeegleClassification>();
    try {
      const response = await chat(CLASSIFY_SYSTEM_PROMPT, batch.map(({ item, description }) =>
        `ID:${item.work_item_info.work_item_id} | 标题:${item.work_item_info.work_item_name} | 类型:${item.work_item_info.work_item_type_key} | 缺陷描述:${description.slice(0, 2000)}`,
      ).join("\n"), { model: MODEL, temperature: 0.1 });
      classifications = parseClassifications(response, batch.map(({ item }) => item.work_item_info.work_item_id));
    } catch (error) {
      for (const { item } of batch) {
        audits.push({ ...auditBase(item), decision: "failed", reason: `模型分类失败: ${error instanceof Error ? error.message : "unknown"}` });
      }
      continue;
    }
    for (const { item } of batch) {
      const classification = classifications.get(item.work_item_info.work_item_id) ?? { carModel: "", project: "", platform: "" };
      const result = decideMeegleAssignment(classification, ruleGroups);
      const outsideTarget = Boolean(filterRuleGroupId) && result.ruleGroupId !== filterRuleGroupId;
      audits.push({
        ...auditBase(item),
        ...classification,
        decision: result.decision === "assigned" && !outsideTarget ? "assigned" : "unassigned",
        matchedRuleGroupId: outsideTarget ? undefined : result.ruleGroupId,
        matchedRuleGroupName: outsideTarget ? undefined : result.ruleGroupName,
        score: result.score,
        reason: outsideTarget ? "不属于当前规则组" : result.reason,
      });
    }
  }

  const assignments = audits.filter((audit) => audit.decision === "assigned");
  return { runId, total: allItems.length, classified: candidates.length, assignments, audits };
}
