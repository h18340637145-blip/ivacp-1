import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { openApiSpec } from "@/server/openapi/spec";
import type { ApiObject } from "@/server/openapi/types";

it("车型文件请求和模板规格公开可选的精确车型别名", () => {
  for (const [schemaName, field] of [["IssueProcessRequest", "modelToFiles"], ["RuleGroupTemplate", "model_to_files"]] as const) {
    const schema = openApiSpec.components.schemas[schemaName];
    const owner = schemaName === "RuleGroupTemplate" ? (schema.properties as ApiObject).config as ApiObject : schema;
    const mapping = (owner.properties as Record<string, ApiObject>)[field];
    const modelFile = mapping.additionalProperties as ApiObject;
    expect((modelFile.properties as ApiObject).aliases).toMatchObject({ type: "array", items: { type: "string" } });
    expect(modelFile.required ?? []).not.toContain("aliases");
  }
});
function implementedRoutes(directory: string, prefix = "/api"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return implementedRoutes(file, `${prefix}/${entry.name.replace(/^\[(?:\.\.\.)?(.+)\]$/, "{$1}")}`);
    if (entry.name !== "route.ts") return [];
    return [...readFileSync(file, "utf8").matchAll(/export\s+(?:const|(?:async\s+)?function)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g)].map(match => `${match[1].toLowerCase()} ${prefix}`);
  });
}
it("规格精确覆盖当前路由和方法，且所有引用、路径参数和operationId有效", () => {
  const documented = Object.entries(openApiSpec.paths).flatMap(([url, methods]) => Object.keys(methods).map(method => `${method} ${url}`));
  expect(documented.sort()).toEqual(implementedRoutes("src/app/api").sort());
  expect(documented.length).toBeGreaterThan(50);
  const operationIds: string[] = [];
  for (const [url, methods] of Object.entries(openApiSpec.paths)) for (const operation of Object.values(methods)) {
    expect(operation.summary).toBeTruthy();
    expect(Object.keys(operation.responses).some(code => /^2\d\d$/.test(code))).toBe(true);
    operationIds.push(operation.operationId!);
    for (const match of url.matchAll(/\{([^}]+)\}/g)) {
      const params = (operation.parameters ?? []).map(param => param.$ref ? (openApiSpec.components.parameters[param.$ref.toString().split("/").at(-1)!]) : param);
      expect(params.some(param => param.name === match[1] && param.in === "path" && param.required === true)).toBe(true);
    }
  }
  expect(operationIds.every(Boolean)).toBe(true);
  expect(new Set(operationIds).size).toBe(operationIds.length);
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if ("$ref" in value && typeof value.$ref === "string") {
      let target: unknown = openApiSpec;
      for (const part of value.$ref.replace(/^#\//, "").split("/")) target = target && (target as Record<string, unknown>)[part];
      expect(target, value.$ref).toBeTruthy();
    }
    Object.values(value).forEach(visit);
  }
  visit(openApiSpec);
});
it("应用使用会话Cookie鉴权，公开文档不误导用户提交Jira Basic凭据", () => {
  expect(openApiSpec.components.securitySchemes.SessionCookie).toMatchObject({ type: "apiKey", in: "cookie", name: "ivacp_session" });
  expect(JSON.stringify(openApiSpec)).not.toContain("JiraBasicAuth");
  expect(openApiSpec.paths["/api/openapi"].get.security).toEqual([]);
  expect(openApiSpec.paths["/api/terminal/targets"].get["x-required-role"]).toBe("admin");
  expect(openApiSpec.paths["/api/labeling/annotations"].put["x-required-role"]).toBe("reviewer");
});
it("共享分析、统一镜像、旧库预检使用当前请求字段", () => {
  const process = openApiSpec.components.schemas.IssueProcessRequest;
  expect(process.required).toEqual(expect.arrayContaining(["issueKey", "summary", "rawData", "prompts", "ruleGroupId"]));
  expect(process.required).not.toContain("issue");
  const response = openApiSpec.components.schemas.IssueProcessResponse;
  expect(response.properties).toHaveProperty("replyText");
  expect(response.properties).toHaveProperty("analysisRunId");
  expect(response.properties).not.toHaveProperty("result");
  expect(JSON.stringify(openApiSpec.paths["/api/migration/legacy"].get)).toContain("preview");
  expect(JSON.stringify(openApiSpec.paths["/api/backup/push"].post)).toContain("processResults");
});

it("文档与静态资源本地可用，不访问CDN或业务系统，非法资源名被拒绝", async () => {
  const { GET: docs } = await import("@/app/api/docs/route");
  const { GET: spec } = await import("@/app/api/openapi/route");
  const { readSwaggerAsset } = await import("@/server/openapi/assets");
  const html = await docs().text();
  expect(html).toContain('/api/docs/assets/swagger-ui-bundle.js');
  expect(html).not.toMatch(/https?:\/\//);
  expect((await spec().json()).info.title).toContain("IVACP");
  expect(await readSwaggerAsset("../package.json")).toBeUndefined();
  expect(await readSwaggerAsset("__proto__")).toBeUndefined();
  expect(await readSwaggerAsset("%2e%2e%2f.env")).toBeUndefined();
  const js = await readSwaggerAsset("swagger-ui-bundle.js");
  expect(js?.type).toContain("javascript");
  expect(js?.bytes.length).toBeGreaterThan(100_000);
  expect((await readSwaggerAsset("swagger-ui.css"))?.type).toContain("text/css");
});

it("标注和模板请求示例可被实际领域规则接受，飞书规则组包含必填身份与排序", async () => {
  const { validateAnnotation } = await import("@/domain/labeling/schema");
  const { parseTemplate } = await import("@/domain/templates/rule-group-template");
  const schemas = openApiSpec.components.schemas;
  expect(() => validateAnnotation(schemas.AnnotationInput?.example)).not.toThrow();
  expect(() => parseTemplate(schemas.RuleGroupTemplate?.example)).not.toThrow();
  expect(schemas.MeegleFilterRuleGroup?.required).toEqual(expect.arrayContaining(["id", "name", "sortOrder"]));
  expect(JSON.stringify(openApiSpec.paths["/api/labeling/annotations"].put.requestBody)).toContain("SaveAnnotationRequest");
  expect(JSON.stringify(openApiSpec.paths["/api/templates"].post.requestBody)).toContain("RuleGroupTemplate");
  expect(openApiSpec.paths["/api/templates"].post.responses).toHaveProperty("503");
  expect(openApiSpec.paths["/api/templates/{key}"].delete.responses).toHaveProperty("503");
});
