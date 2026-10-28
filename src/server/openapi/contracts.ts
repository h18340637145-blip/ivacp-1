import { REJECT_REASON_CODES } from "@/domain/analysis/reject-reasons";
import { DIFFICULTIES, PURPOSES, VERDICTS } from "@/domain/labeling/schema";
import { TEMPLATE_KIND, TEMPLATE_SCHEMA_VERSION } from "@/domain/templates/rule-group-template";
import type { ApiObject } from "./types";
const text = { type: "string" };
const object = (properties: ApiObject, required: string[] = []): ApiObject => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const exampleAnnotation = { verdict: "wrong", errorCodes: ["timing_misjudged"], purposes: ["few_shot_negative", "eval_truth"], correctedConclusion: "【现象】示例信号变化。【证据】12:00:01 信号先变化。【结论】按时间戳重新核对上下游。", difficulty: "medium", note: "" };
export const annotationInputSchema: ApiObject = {
  ...object({
    verdict: { type: "string", enum: [...VERDICTS] }, errorCodes: { type: "array", uniqueItems: true, items: { type: "string", enum: [...REJECT_REASON_CODES] } },
    purposes: { type: "array", uniqueItems: true, items: { type: "string", enum: [...PURPOSES] } }, correctedConclusion: { type: "string", maxLength: 20000 },
    difficulty: { type: "string", enum: [...DIFFICULTIES], default: "medium" }, note: { type: "string", maxLength: 2000 },
  }, ["verdict"]),
  description: "部分正确/错误必选错误类型；正例只允许完全正确；负例或错误样本真值必须填正确结论；other类型必须写备注；exclude不能与其他用途同选。保存接口会再次校验全部组合。",
  oneOf: [
    { properties: { verdict: { enum: ["correct"] }, errorCodes: { maxItems: 0 }, purposes: { items: { enum: ["few_shot_positive", "eval_truth", "exclude"] } } } },
    { required: ["errorCodes"], properties: { verdict: { enum: ["partial", "wrong"] }, errorCodes: { minItems: 1 }, purposes: { items: { enum: ["few_shot_negative", "eval_truth", "exclude"] } } } },
    { properties: { verdict: { enum: ["unusable"] }, purposes: { items: { enum: ["exclude"] } } } },
  ],
  example: exampleAnnotation,
};
export const saveAnnotationSchema = object({ itemId: { type: "string", description: "来源:processResult.id，例如 jira:result-id" }, annotation: { $ref: "#/components/schemas/AnnotationInput" } }, ["itemId", "annotation"]);

const templateConfig = object({ jql: text, meegleMql: text, jiraProvider: { type: "string", enum: ["default", "bosch"] }, expand: text,
  base_paths: object({ json_dir: text, dbc_dir: text, proto_dir: text }), model_to_files: { type: "object", additionalProperties: object({ json: { oneOf: [text, { type: "array", items: text }] }, dbc: { oneOf: [text, { type: "array", items: text }] }, proto: text }) },
  prompts: object(Object.fromEntries(["REQUIREMENT_EXTRACT_SYSTEM", "EXTRACT_SIGNALS_SYSTEM", "LOG_SUMMARY_SYSTEM", "ANDROID_QNX_LOG_SUMMARY_SYSTEM", "CONSISTENCY_SYSTEM", "COMPARE_CANTRACE"].map(key => [key, text]))),
});
templateConfig.description = "至少配置一个非空JQL或meegleMql；本机文件路径和提示词会发布给团队，不包含票据和凭据。";
export const ruleGroupTemplateSchema: ApiObject = {
  ...object({ kind: { type: "string", enum: [TEMPLATE_KIND] }, schemaVersion: { type: "integer", minimum: 1, maximum: TEMPLATE_SCHEMA_VERSION }, templateKey: { type: "string", maxLength: 64 }, version: { type: "integer", minimum: 1 }, name: { type: "string", minLength: 1, maxLength: 80 }, description: text, tags: { type: "array", items: text }, author: text, createdAt: { type: "string", format: "date-time" }, config: templateConfig, checksum: text }, ["kind", "schemaVersion", "name", "config"]),
  example: { kind: TEMPLATE_KIND, schemaVersion: TEMPLATE_SCHEMA_VERSION, templateKey: "example-template", version: 1, name: "示例规则组", description: "", tags: [], config: { jql: "project = TEST", expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: {} } },
};
export const meegleFilterRuleGroupSchema = object({ id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, sortOrder: { type: "number" }, meegleMql: { type: "string", description: "需要筛选的目标组必须包含非空MQL" } }, ["id", "name", "sortOrder"]);
export const meegleAutoAssignRuleGroupSchema = object({ id: text, name: text, model_to_files: { type: "object", additionalProperties: true } }, ["id", "name"]);
