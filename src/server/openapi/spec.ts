import { requiredRoleForPath, AUTH_SESSION_COOKIE } from "@/domain/auth/permissions";
import { ENTITY_TABLES } from "@/domain/entities";
import { annotationInputSchema, saveAnnotationSchema, ruleGroupTemplateSchema, meegleFilterRuleGroupSchema, meegleAutoAssignRuleGroupSchema } from "./contracts";
import { legacySpec } from "./legacy-spec";
import type { ApiObject, ApiOperation, OpenApiDocument } from "./types";

const text = { type: "string" };
const strings = { type: "array", items: text };
const object = (properties: ApiObject = {}, required: string[] = []): ApiObject => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: true });
const body = (schema: ApiObject) => ({ required: true, content: { "application/json": { schema } } });
const query = (name: string, required = false, schema: ApiObject = text): ApiObject => ({ name, in: "query", required, schema });
const responses = () => ({ "200": { description: "成功", content: { "application/json": { schema: object() } } }, "400": { $ref: "#/components/responses/Error" }, "500": { $ref: "#/components/responses/Error" } });
const operation = (summary: string, tag: string, schema?: ApiObject): ApiOperation => ({ summary, tags: [tag], responses: responses(), ...(schema ? { requestBody: body(schema) } : {}) });
const identity = { projectKey: text, workItemTypeKey: { type: "string", enum: ["issue"] }, workItemId: text };
const identityFields = ["projectKey", "workItemTypeKey", "workItemId"];
const runIdentity = { ...identity, issueKey: text, runId: text, ruleGroupName: text };
const receipt = { resultId: text, artifactRef: text, analysisReceipt: text, authorization: text };
const genericConfig = { prompts: object(), basePaths: object(), modelToFiles: object(), ruleGroupId: text, ruleGroupName: text };

export const openApiSpec: OpenApiDocument = {
  ...legacySpec,
  info: { title: "IVACP 车辆智能分析与协作 API", version: "1.0.0", description: "当前 Next.js 接口规格。业务接口使用本应用登录会话；Jira 凭据、Meegle CLI 登录和模型密钥由服务端管理，不通过文档传入。IndexedDB 为浏览器主存储，MySQL 提供账号镜像与协作。" },
  security: [{ SessionCookie: [] }],
};
const spec = openApiSpec;
spec.components.securitySchemes = { SessionCookie: { type: "apiKey", in: "cookie", name: AUTH_SESSION_COOKIE, description: "先通过 /api/auth/login 登录，浏览器同源请求自动携带会话 Cookie。" } };
spec.tags = [
  ...spec.tags.filter(tag => tag.name !== "Terminal"),
  { name: "Terminal", description: "远程终端元数据（管理员）" },
  { name: "Meegle", description: "飞书项目筛票、分析产物与授权写回" },
  { name: "Labeling", description: "当前账号独立数据标注" },
  { name: "Templates", description: "团队模板版本与应用" },
  { name: "Statistics", description: "团队镜像统计" },
  { name: "Migration", description: "旧数据库只读预检与管理员迁移" },
];

spec.components.schemas.IssueProcessRequest = object({
  issueKey: { type: "string", pattern: "^[A-Za-z0-9_-]+$", maxLength: 120 }, summary: text, rawData: object(), prompts: object(),
  basePaths: object({ json_dir: text, dbc_dir: text, proto_dir: text }, ["json_dir", "dbc_dir", "proto_dir"]),
  modelToFiles: { type: "object", additionalProperties: object({ aliases: { ...strings, description: "显式车型别名，完整匹配且区分大小写；缺省时不按车型键推断。跨车型重复别名将导致自动配置回退。" }, json: { oneOf: [text, strings] }, dbc: { oneOf: [text, strings] }, proto: text }, ["json", "dbc", "proto"]) },
  ruleGroupId: text, ruleGroupName: text, source: { type: "string", enum: ["jira", "meegle"] }, jiraProvider: { type: "string", enum: ["default", "bosch"] }, runId: text, expand: text,
  fewShotSamples: { type: "array", items: { $ref: "#/components/schemas/FewShotSample" } }, errorPatterns: { type: "array", items: object() },
}, ["issueKey", "summary", "rawData", "prompts", "ruleGroupId"]);
spec.components.schemas.IssueProcessResponse = object({
  configurationResolution: { ...object(), description: "本次基础配置审计：默认按日志和规则组完整别名选择分支当前配置；保存原始用户配置、全部候选、实际车型、文件内容摘要及运行快照路径。身份冲突、版本提取失败或文件不齐时整套回退；不混合来源，旧响应可缺省。" },
  analysisGroupName: { type: "string", description: "分析时的规则组目录名，复核不随规则组后续改名改变" },
  analysisRunId: { type: "string", description: "服务端确认的运行ID；新结果AI复核用作runId，旧响应可省略" },
  replyText: text, issueKey: text, model: text, mode: text, stages: { type: "object", additionalProperties: text },
  chartImage: text, signalSummary: text, traceData: object(), ticks: object(), reviewEvidence: object(),
  versionVhalCheck: { ...object(), description: "版本与 VHAL 配置检查审计：schemaVersion、socScc 配对结果、resolution 的 hash/来源提交/归档/Excel 候选，可选 vsAssociation 保存同项目同分支组 RTC 关联的 VS 候选、命中与未匹配 RTC、最终 VS commit 及原因（旧结果可缺省）、config 的逐信号/属性配置（Vehicle property ID、MCU UP、IVI DOWN 精确匹配及同行 Project）与大小写差异、warnings、stopReason 与 summary。未知/冲突不阻断；版本不一致或全部信号确认缺少且无大小写差异豁免时停止。" },
  elapsedMs: { type: "number" }, tokenUsage: { type: "integer" }, artifactRef: text, analysisReceipt: text, handoverAt: { type: "string", format: "date-time" },
}, ["replyText", "issueKey", "model"]);
const sample = spec.components.schemas.FewShotSample;
spec.components.schemas.ReviewRequest.properties = {
  ...(spec.components.schemas.ReviewRequest.properties as ApiObject),
  runId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,120}$", description: "Jira 当前分析运行；指定后仅复核该 run 产物，不回退票目录。旧结果可省略。" },
};
sample.required = ["issueKey", "issueSummary", "wrongConclusion", "correctConclusion", "errorReason"];
sample.properties = { ...(sample.properties as ApiObject), issueKey: text, ticketKey: text, issueSummary: text, relevanceScore: { type: "number" } };
spec.paths["/api/issues/process"].post.description = "浏览器提交统一快照和规则组配置，返回扁平 ProcessResponse。飞书 issueKey 为 meegle-<workItemId>，rawData 中 projectKey 与字符串 workItemId 必须一致；HTTP断开不停止飞书后台运行，显式停止使用 /api/meegle/cancel。";
spec.paths["/api/issues/process"].post.responses["409"] = { description: "不可变 runId 已被使用，或最终成功提交与停止冲突" };
spec.paths["/api/issues/process"].post.responses["499"] = { description: "Jira 分析已取消" };

const extra: OpenApiDocument["paths"] = {
  "/api/docs/assets/{file}": { get: { ...operation("读取本地 Swagger UI 静态资源", "Docs"), parameters: [{ name: "file", in: "path", required: true, schema: { type: "string", enum: ["swagger-ui.css", "swagger-ui-bundle.js"] } }], responses: { "200": { description: "CSS 或 JavaScript" }, "404": { description: "资源不存在" } } } },
  "/api/issues/save-screenshot": { post: operation("保存当前 CAN 图表视口截图", "Issues", object({ issueKey: text, chartImagePath: text, imageBase64: { type: "string", description: "PNG data URL，最长28MiB；目标必须为允许的log目录PNG" } }, ["issueKey", "chartImagePath", "imageBase64"])) },
  "/api/jira/handover": { post: operation("读取 Jira 接手时间", "Jira", object({ issueKey: text, jiraProvider: text }, ["issueKey"])) },
  "/api/chat": { post: { ...operation("知识上下文对话，可返回 NDJSON 增量流", "AI", object({ message: text, history: { type: "array", items: object({ role: { type: "string", enum: ["user", "assistant"] }, content: text }) }, stream: { type: "boolean" }, context: { type: "array", items: object({ docName: text, text }) }, memories: strings }, ["message"])), description: "stream=true 返回delta/done/error事件，默认返回 {reply}。" } },
  "/api/memory": { post: operation("抽取长期记忆或判定相邻记忆关系", "AI", { oneOf: [object({ action: { type: "string", enum: ["extract"] }, user: text, assistant: text }, ["action"]), object({ action: { type: "string", enum: ["decide"] }, candidate: text, neighbours: strings }, ["action"])] }) },
  "/api/meegle/auto-assign": { post: operation("从待办识别并自动分配规则组", "Meegle", object({ ruleGroups: { type: "array", items: object() }, filterRuleGroupId: text, manualAssignments: { type: "array", items: object() } }, ["ruleGroups"])) },
  "/api/meegle/filter": { post: { ...operation("按 MQL 筛票并返回归属和审计", "Meegle", object({ projectKey: text, ruleGroups: { type: "array", items: object() }, filterRuleGroupId: text, manualAssignments: { type: "array", items: object() } }, ["projectKey", "ruleGroups"])), description: "HTTP200不代表来源成功；须检查successfulRuleGroupIds、filterResults及audits。传入同项目优先级规则组，不能用失败空结果解除归属。" } },
  "/api/meegle/context": { post: operation("读取飞书工单分析前完整上下文", "Meegle", object(identity, identityFields)) },
  "/api/meegle/context-view": { get: {
    ...operation("读取飞书工单富文本与本地图片缓存", "Meegle"),
    description: "按完整工单身份缓存优先；refresh=1只读刷新原票并补齐图片。上游失败保留已有缓存，无缓存则返回detail:null/source:snapshot及warning。评论图片保存于jira-issues/meegle-context/<projectKey>/issue/meegle-<workItemId>/，不修改分析历史或经办人凭据。",
    parameters: [...identityFields.map(name => query(name, true, identity[name as keyof typeof identity])), query("refresh", false, { type: "string", enum: ["1"] })],
    responses: { ...responses(), "200": { description: "原票、缓存或快照降级状态", content: { "application/json": { schema: object({ detail: { ...object(), nullable: true }, images: { type: "object", additionalProperties: object({ id: text, name: text, status: { type: "string", enum: ["cached", "unavailable"] }, reason: text }, ["id", "name", "status"]) }, source: { type: "string", enum: ["cache", "remote", "snapshot"] }, cachedAt: text, warning: text, errors: object() }, ["detail", "images", "source"]) } } } },
  } },
  "/api/meegle/context-image": { get: {
    ...operation("读取指定飞书工单已缓存的图片", "Meegle"),
    description: "仅返回当前身份context.json中登记的图片，不接受远端URL或文件路径。PNG/JPEG/GIF/WebP，需登录，禁止公共缓存与内容嗅探。",
    parameters: [...identityFields.map(name => query(name, true, identity[name as keyof typeof identity])), query("imageId", true, { type: "string", pattern: "^[a-f0-9]{64}$" })],
    responses: { ...responses(), "200": { description: "本地图片字节", content: Object.fromEntries(["image/png", "image/jpeg", "image/gif", "image/webp"].map(mime => [mime, { schema: { type: "string", format: "binary" } }])) }, "404": { description: "图片未缓存或不可用" } },
  } },
  "/api/meegle/analyze": { post: { ...operation("兼容旧飞书分析调用", "Meegle", object({ ...identity, ...genericConfig, runId: text, workItemName: text, rawData: object(), description: text }, ["workItemId", "workItemName"])), description: "兼容入口；新持久化客户端应先获取context，再直接提交共享/issues/process，避免服务端HTTP回环。" } },
  "/api/meegle/cancel": { post: operation("显式停止原飞书运行", "Meegle", object(runIdentity, [...identityFields, "runId", "issueKey", "ruleGroupName"])) },
  "/api/meegle/recover": { post: { ...operation("恢复原运行的完整成功分析产物", "Meegle", object(runIdentity, [...identityFields, "runId", "issueKey", "ruleGroupName"])), description: "只检查不可变原run，未完成时200返回recoverable:false；完整成功才返回曲线、枚举及重新签名凭据。" } },
  "/api/meegle/artifacts": { get: { ...operation("列出或读取原运行白名单产物", "Meegle"), parameters: [query("artifactRef", true), query("file")] } },
  "/api/meegle/mywork": { get: { ...operation("读取飞书我的待办", "Meegle"), parameters: [query("action", false, { type: "string", enum: ["todo", "done", "overdue", "this_week"] }), query("pageNum")] } },
  "/api/meegle/views": { get: { ...operation("搜索飞书视图", "Meegle"), parameters: [query("keyword"), query("scope")] } },
  "/api/meegle/views/items": { get: { ...operation("读取飞书视图工作项", "Meegle"), parameters: [query("viewId", true), query("pageNum")] } },
  "/api/meegle/workitem": { get: { ...operation("读取飞书工单详情与经办人凭据", "Meegle"), parameters: identityFields.map(name => query(name, true, identity[name as keyof typeof identity])) } },
  "/api/meegle/users": { get: { ...operation("搜索飞书空间人员", "Meegle"), parameters: [query("projectKey", true), query("q")] } },
  "/api/meegle/authorize": { post: operation("签发目标绑定的短期写入授权", "Meegle", object({ ...identity, ...receipt, action: { type: "string", enum: ["comment", "transition", "assignee"] }, body: text, chartImagePath: text, transitionId: text, expectedCurrentUserKeys: strings, targetUserKey: text, detailReceipt: text, assigneeRoleKey: text, updatedAt: text })) },
  "/api/meegle/comment": { post: operation("回填已复核结论为飞书评论", "Meegle", object({ ...identity, ...receipt, body: text, chartImagePath: text }, [...identityFields, "resultId", "body", "analysisReceipt", "authorization"])) },
  "/api/meegle/assignee": { post: operation("依据详情凭据与目标授权修改经办人", "Meegle", object({ ...identity, expectedCurrentUserKeys: strings, targetUserKey: text, detailReceipt: text, authorization: text }, [...identityFields, "targetUserKey", "detailReceipt", "authorization"])) },
  "/api/meegle/workflow": {
    get: { ...operation("列出可用飞书状态流转", "Meegle"), parameters: identityFields.map(name => query(name, true, identity[name as keyof typeof identity])) },
    post: operation("使用授权执行飞书状态流转", "Meegle", object({ ...identity, ...receipt, transitionId: text }, [...identityFields, "resultId", "transitionId", "analysisReceipt", "authorization"])),
  },
  "/api/migration/legacy": {
    get: { ...operation("读取旧库迁移历史或仅SELECT预检", "Migration"), parameters: [query("preview", false, { type: "string", enum: ["1"], description: "1=只读预检；省略=迁移历史" })] },
    post: { ...operation("管理员执行旧MySQL批次迁移", "Migration", object({ owners: strings, overwrite: { type: "boolean", default: false } })), description: "保留旧库；默认补齐缺失ID。按批次提交，失败后可合并续迁，不保证整库事务原子性。" },
  },
};
Object.assign(spec.paths, extra);
spec.components.schemas.AnnotationInput = annotationInputSchema;
spec.components.schemas.SaveAnnotationRequest = saveAnnotationSchema;
spec.components.schemas.RuleGroupTemplate = ruleGroupTemplateSchema;
spec.components.schemas.MeegleFilterRuleGroup = meegleFilterRuleGroupSchema;
spec.components.schemas.MeegleAutoAssignRuleGroup = meegleAutoAssignRuleGroupSchema;
spec.paths["/api/labeling/annotations"].put.requestBody = body({ $ref: "#/components/schemas/SaveAnnotationRequest" });
spec.paths["/api/templates"].post.requestBody = body({ $ref: "#/components/schemas/RuleGroupTemplate" });
spec.paths["/api/templates"].post.responses["201"] = { description: "新模板版本已创建" };
spec.paths["/api/templates"].post.description = "同标识发布串行执行，未变化配置返回现有版本；版本由服务端递增，作者保持不变。锁等待超时返回503，可稍后重试。";
for (const operation of [spec.paths["/api/templates"].post, spec.paths["/api/templates/{key}"].delete]) {
  operation.responses["503"] = { description: "数据库不可用或模板正在更新，稍后重试", content: { "application/json": { schema: object({ error: text }, ["error"]) } } };
}
spec.paths["/api/meegle/auto-assign"].post.requestBody = body(object({ ruleGroups: { type: "array", items: { $ref: "#/components/schemas/MeegleAutoAssignRuleGroup" } }, filterRuleGroupId: text, manualAssignments: { type: "array", items: object({ ...identity, workItemId: { type: "number" } }, identityFields) } }, ["ruleGroups"]));
spec.paths["/api/meegle/filter"].post.requestBody = body(object({ projectKey: text, ruleGroups: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/MeegleFilterRuleGroup" } }, filterRuleGroupId: text, manualAssignments: { type: "array", items: { oneOf: [text, object({ ...identity, workItemId: { type: "number" } }, identityFields)] } } }, ["projectKey", "ruleGroups"]));

// 当前镜像表名由统一实体提供，避免旧表名进入新文档。
spec.paths["/api/backup/push"].post.requestBody = body(object({ clientId: text, backupRunId: text, records: { type: "array", items: object({ table: { type: "string", enum: [...ENTITY_TABLES] }, id: text, data: { type: "string", description: '序列化记录，Date为{"$date":ISO}；非删除记录必填' }, deleted: { type: "boolean" } }, ["table", "id"]) } }, ["records"]));
spec.paths["/api/backup/pull"].get.parameters = [query("table", true, { type: "string", enum: [...ENTITY_TABLES] }), query("after"), query("limit", false, { type: "integer", minimum: 1, maximum: 1000, default: 200 })];

for (const [url, methods] of Object.entries(spec.paths)) for (const [method, entry] of Object.entries(methods)) {
  entry.operationId = `${method}_${url.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
  const publicRoute = url.startsWith("/api/auth/") || url.startsWith("/api/docs") || url === "/api/openapi";
  entry.security = publicRoute ? [] : [{ SessionCookie: [] }];
  if (!publicRoute) {
    entry["x-required-role"] = url === "/api/labeling/annotations" && method !== "get" ? "reviewer" : requiredRoleForPath(url, method.toUpperCase());
    entry.responses["401"] = { description: "未登录或会话过期" };
    if (entry["x-required-role"] !== "analyst") entry.responses["403"] = { description: "当前角色权限不足" };
  }
}
