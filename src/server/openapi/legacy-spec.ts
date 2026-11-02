// 迁移自参考系统的基础接口描述；新契约统一由 spec.ts 修订。
export const legacySpec = {
  openapi: "3.0.3",
  info: {
    title: "Jira 智能票据分析系统 API",
    version: "3.13.0",
    description:
      "Next.js API Routes for Jira filtering, issue processing, AI review, validation support, terminal metadata, charts, embeddings, and notifications.",
  },
  servers: [
    {
      url: "/",
      description: "当前 Next.js 服务",
    },
  ],
  tags: [
    { name: "Docs", description: "API 文档入口" },
    { name: "Jira", description: "Jira 查询、评论和状态流转" },
    { name: "Issues", description: "工单 AI 分析与复核" },
    { name: "Terminal", description: "远程终端公开元数据" },
    { name: "Assets", description: "分析产物访问" },
    { name: "AI", description: "Embedding 与通知集成" },
    { name: "Backup", description: "IndexedDB 数据服务器镜像（MySQL）" },
  ],
  paths: {
    "/api/openapi": {
      get: {
        tags: ["Docs"],
        summary: "获取 OpenAPI JSON 规格",
        responses: {
          "200": {
            description: "OpenAPI 3.0 JSON",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
    "/api/docs": {
      get: {
        tags: ["Docs"],
        summary: "查看 Swagger UI 文档页",
        responses: {
          "200": {
            description: "Swagger UI HTML",
            content: {
              "text/html": {
                schema: { type: "string" },
              },
            },
          },
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Docs"],
        summary: "基于 docs/login.json 的用户名密码登录",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "登录成功并写入 Session Cookie",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Docs"],
        summary: "退出登录并清除 Session Cookie",
        responses: {
          "200": {
            description: "退出成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/api/auth/session": {
      get: {
        tags: ["Docs"],
        summary: "读取当前登录会话",
        responses: {
          "200": {
            description: "当前用户与角色",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSessionResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rule-groups": {
      get: {
        tags: ["Jira"],
        summary: "读取服务端规则组列表",
        responses: {
          "200": {
            description: "规则组列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RuleGroupListResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        tags: ["Jira"],
        summary: "创建服务端规则组（管理员）",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RuleGroupInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "已创建规则组",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RuleGroupResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rule-groups/{id}": {
      get: {
        tags: ["Jira"],
        summary: "读取单个服务端规则组",
        parameters: [{ $ref: "#/components/parameters/RuleGroupId" }],
        responses: {
          "200": {
            description: "规则组详情",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RuleGroupResponse" },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
      put: {
        tags: ["Jira"],
        summary: "更新服务端规则组（管理员）",
        parameters: [{ $ref: "#/components/parameters/RuleGroupId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RuleGroupInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "已更新规则组",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RuleGroupResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
      delete: {
        tags: ["Jira"],
        summary: "删除服务端规则组（管理员）",
        parameters: [{ $ref: "#/components/parameters/RuleGroupId" }],
        responses: {
          "200": {
            description: "已删除规则组",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessResponse" },
              },
            },
          },
          "403": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rule-groups/reorder": {
      put: {
        tags: ["Jira"],
        summary: "更新服务端规则组排序（管理员）",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RuleGroupReorderRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "已更新排序",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RuleGroupListResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/jira/filter": {
      post: {
        tags: ["Jira"],
        summary: "按 JQL 查询 Jira 工单",
        security: [{ JiraBasicAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/JiraFilterRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Jira 工单列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JiraFilterResponse" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/issues/process": {
      post: {
        tags: ["Issues"],
        summary: "执行单票 AI 分析流水线",
        description:
          "下载附件、解包、解析 CAN 信号、调用 Qwen 分析并返回处理结果。长耗时任务由前端 store 管理运行状态。",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/IssueProcessRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "单票处理结果",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/IssueProcessResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/issues/review": {
      post: {
        tags: ["Issues"],
        summary: "调用验证模型复核 AI 分析结论",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReviewRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "AI 复核判定",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReviewResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/jira/comment": {
      post: {
        tags: ["Jira"],
        summary: "向 Jira 工单回填评论，可附带 CAN 信号图",
        security: [{ JiraBasicAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/JiraCommentRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "评论回填结果",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JiraCommentResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rule-groups/{id}/processed-issues/{issueKey}/transition": {
      get: {
        tags: ["Jira"],
        summary: "读取 Jira 工单可用状态流转与人员候选",
        security: [{ JiraBasicAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/RuleGroupId" },
          { $ref: "#/components/parameters/IssueKey" },
        ],
        responses: {
          "200": {
            description: "可用流转和候选人员",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TransitionResponse" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        tags: ["Jira"],
        summary: "执行 Jira 状态流转，可选同步指派经办人",
        security: [{ JiraBasicAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/RuleGroupId" },
          { $ref: "#/components/parameters/IssueKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TransitionRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "状态流转结果",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TransitionResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/embeddings": {
      post: {
        tags: ["AI"],
        summary: "调用 Embedding 服务生成向量",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EmbeddingRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Embedding 向量",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EmbeddingResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/terminal/projects/import": {
      post: {
        tags: ["Terminal"],
        summary: "导入远程终端项目配置到服务端",
        description: "管理员覆盖 docs/project.json，其它登录用户写入目标专属文件 docs/project_<目标名>.json；覆盖前自动备份到 docs/bak/。",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  targetId: { type: "string", description: "终端目标 id；非管理员必填" },
                  projects: { type: "array", items: { type: "object" }, description: "project.json 的项目数组" },
                },
                required: ["projects"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "写入结果",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string" },
                    backup: { type: "string", nullable: true },
                    scope: { type: "string", enum: ["canonical", "named"] },
                    projectCount: { type: "number" },
                  },
                  required: ["file", "backup", "scope", "projectCount"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/terminal/projects/export": {
      get: {
        tags: ["Terminal"],
        summary: "导出当前生效的远程终端项目配置",
        parameters: [
          {
            name: "target",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "终端目标 id，用于按 named_first 解析专属配置文件",
          },
        ],
        responses: {
          "200": {
            description: "project.json 原始内容（附下载头）",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/terminal/projects": {
      get: {
        tags: ["Terminal"],
        summary: "读取远程终端项目配置",
        parameters: [
          {
            name: "target",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "终端目标 id，用于按 named_first 解析专属配置文件",
          },
        ],
        responses: {
          "200": {
            description: "项目、分支和仓库配置，附配置缺失与可写位置信息",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TerminalProjectsResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/terminal/targets": {
      get: {
        tags: ["Terminal"],
        summary: "读取脱敏后的远程终端目标列表",
        responses: {
          "200": {
            description: "公开目标元数据",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TerminalTargetsResponse" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/charts/{path}": {
      get: {
        tags: ["Assets"],
        summary: "读取分析日志目录下的 PNG 图表",
        parameters: [
          {
            name: "path",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "log/ 开头的 PNG 相对路径",
          },
        ],
        responses: {
          "200": {
            description: "PNG 图片",
            content: {
              "image/png": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "403": { description: "非法路径" },
          "404": { description: "文件不存在" },
        },
      },
    },
    "/api/feishu/process-result": {
      post: {
        tags: ["AI"],
        summary: "发送单票处理结果飞书通知",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FeishuProcessResultRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "通知发送结果",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessResponse" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/backup/status": {
      get: {
        tags: ["Backup"],
        summary: "读取当前账号的服务器镜像状态",
        description: "未配置 MYSQL_URL 时返回 configured=false；返回各表记录数、浏览器客户端与团队成员汇总。",
        responses: {
          "200": { description: "镜像状态", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "401": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/labeling/items": {
      get: {
        tags: ["Labeling"],
        summary: "列出可标注的 AI 结论（Jira + 飞书）",
        parameters: [
          { name: "source", in: "query", schema: { type: "string", enum: ["jira", "meegle"] } },
          { name: "status", in: "query", schema: { type: "string", enum: ["all", "todo", "done"] } },
          { name: "reviewStatus", in: "query", schema: { type: "string", enum: ["all", "approved", "rejected", "pending"] } },
          { name: "scene", in: "query", description: "问题场景：bench=台架，vehicle=实车，none=标题无台架/实车标志", schema: { type: "string", enum: ["all", "bench", "vehicle", "none"] } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
    },
    "/api/labeling/items/detail": {
      get: {
        tags: ["Labeling"],
        summary: "读取单条标注条目（含预填建议与核对提示）",
        parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { $ref: "#/components/responses/Error" }, "404": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
    },
    "/api/labeling/annotations": {
      put: {
        tags: ["Labeling"],
        summary: "保存标注（复核员及以上）",
        description: "写入 MySQL labeling_annotations，不修改原始分析数据；不合规的判定/错误类型/用途组合返回 400。",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
      delete: {
        tags: ["Labeling"],
        summary: "撤销标注（复核员及以上）",
        parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
    },
    "/api/labeling/export": {
      get: {
        tags: ["Labeling"],
        summary: "导出已标注数据（JSONL，不含“排除/无法标注”）",
        responses: { "200": { description: "成功", content: { "application/x-ndjson": { schema: { type: "string" } } } }, "401": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
    },
    "/api/templates": {
      get: {
        tags: ["Backup"],
        summary: "列出团队模板库（每个模板的最新版本）",
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
      post: {
        tags: ["Backup"],
        summary: "发布规则组模板",
        description: "版本号由服务端递增；配置与最新版相同则不生成新版本（返回 200）；模板标识被他人占用时返回 400。",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "201": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
    },
    "/api/templates/{key}": {
      get: {
        tags: ["Backup"],
        summary: "读取模板完整内容（默认最新版，可用 version 指定）",
        parameters: [
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          { name: "version", in: "query", schema: { type: "integer", minimum: 1 } },
        ],
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "404": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
      delete: {
        tags: ["Backup"],
        summary: "删除模板（全部版本，仅作者或管理员）",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" }, "404": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
    },
    "/api/templates/{key}/applied": {
      post: {
        tags: ["Backup"],
        summary: "记录模板被应用一次",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { version: { type: "integer", minimum: 1 } }, required: ["version"] } } } },
        responses: { "200": { description: "成功", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "404": { $ref: "#/components/responses/Error" }, "503": { $ref: "#/components/responses/Error" } },
      },
    },
    "/api/statistics/team": {
      get: {
        tags: ["Backup"],
        summary: "读取团队统计（汇总服务器镜像中所有成员的备份记录）",
        description: "按年份与月份范围统计，返回合计与各成员明细；只返回聚合数字。需要登录并配置 MYSQL_URL。",
        parameters: [
          { name: "year", in: "query", schema: { type: "integer", default: 2026 }, description: "年份，默认当年" },
          { name: "startMonth", in: "query", schema: { type: "integer", minimum: 1, maximum: 12, default: 1 } },
          { name: "endMonth", in: "query", schema: { type: "integer", minimum: 1, maximum: 12, default: 12 } },
        ],
        responses: {
          "200": { description: "团队统计", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/backup/push": {
      post: {
        tags: ["Backup"],
        summary: "上传或删除 IndexedDB 记录（按登录账号隔离）",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: {
                  clientId: { type: "string" },
                  backupRunId: { type: "string" },
                  records: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["table", "id"],
                      properties: {
                        table: { type: "string" },
                        id: { type: "string" },
                        data: { type: "string", description: "序列化记录（Date 以 {\"$date\": ISO} 表示）" },
                        deleted: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "写入计数", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/backup/finalize": {
      post: {
        tags: ["Backup"],
        summary: "完成完整备份：标记本浏览器此前上传但本次未上传的记录为已删除",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["clientId", "backupRunId", "startedAt", "tables"],
                properties: {
                  clientId: { type: "string" },
                  backupRunId: { type: "string" },
                  startedAt: { type: "string", format: "date-time" },
                  tables: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "标记删除计数", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/backup/pull": {
      get: {
        tags: ["Backup"],
        summary: "分页读取当前账号在服务器上的记录（用于恢复）",
        parameters: [
          { name: "table", in: "query", required: true, schema: { type: "string" } },
          { name: "after", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000, default: 200 } },
        ],
        responses: {
          "200": { description: "记录与下一页游标", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      JiraBasicAuth: {
        type: "http",
        scheme: "basic",
        description:
          "由服务端环境变量 JIRA_USERNAME / JIRA_PASSWORD 注入，浏览器请求不直接传 Jira 凭据。",
      },
    },
    parameters: {
      RuleGroupId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      IssueKey: {
        name: "issueKey",
        in: "path",
        required: true,
        schema: { type: "string", example: "CHER-156932" },
      },
    },
    responses: {
      Error: {
        description: "错误响应",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
          success: { type: "boolean" },
        },
      },
      SuccessResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string" },
          password: { type: "string" },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          user: { $ref: "#/components/schemas/AuthUser" },
        },
      },
      AuthSessionResponse: {
        type: "object",
        properties: {
          authenticated: { type: "boolean" },
          user: { $ref: "#/components/schemas/AuthUser" },
        },
      },
      AuthUser: {
        type: "object",
        properties: {
          username: { type: "string" },
          displayName: { type: "string" },
          role: { type: "string", enum: ["analyst", "reviewer", "admin"] },
        },
      },
      RuleGroupInput: {
        type: "object",
        required: ["name", "jql"],
        properties: {
          name: { type: "string" },
          jql: { type: "string" },
          expand: { type: "string" },
          base_paths: { type: "object" },
          model_to_files: { type: "object" },
          prompts: { type: "object" },
        },
      },
      RuleGroup: {
        allOf: [
          { $ref: "#/components/schemas/RuleGroupInput" },
          {
            type: "object",
            properties: {
              id: { type: "string" },
              sortOrder: { type: "number" },
              createdAt: { type: "string" },
              updatedAt: { type: "string" },
            },
          },
        ],
      },
      RuleGroupResponse: {
        type: "object",
        properties: {
          ruleGroup: { $ref: "#/components/schemas/RuleGroup" },
        },
      },
      RuleGroupListResponse: {
        type: "object",
        properties: {
          ruleGroups: {
            type: "array",
            items: { $ref: "#/components/schemas/RuleGroup" },
          },
        },
      },
      RuleGroupReorderRequest: {
        type: "object",
        required: ["ids"],
        properties: {
          ids: { type: "array", items: { type: "string" } },
        },
      },
      JiraFilterRequest: {
        type: "object",
        required: ["jql"],
        properties: {
          jql: { type: "string", example: "project = CHER ORDER BY updated DESC" },
        },
      },
      JiraFilterResponse: {
        type: "object",
        required: ["issues", "total"],
        properties: {
          total: { type: "number" },
          issues: {
            type: "array",
            items: { $ref: "#/components/schemas/JiraIssue" },
          },
        },
      },
      JiraIssue: {
        type: "object",
        properties: {
          key: { type: "string" },
          summary: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          assignee: { type: "string" },
          reporter: { type: "string" },
          created: { type: "string" },
          updated: { type: "string" },
          issueType: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          attachmentCount: { type: "number" },
          attachments: {
            type: "array",
            items: { $ref: "#/components/schemas/JiraAttachment" },
          },
          description: { type: "string" },
          comments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                author: { type: "string" },
                body: { type: "string" },
                created: { type: "string" },
              },
            },
          },
        },
      },
      JiraAttachment: {
        type: "object",
        properties: {
          id: { type: "string" },
          filename: { type: "string" },
          created: { type: "string" },
          size: { type: "number" },
          mimeType: { type: "string" },
          contentUrl: { type: "string" },
          authorName: { type: "string" },
        },
      },
      IssueProcessRequest: {
        // 本对象完全被 spec.ts 的 spec.components.schemas.IssueProcessRequest 赋值覆盖（旧 issue/ruleGroup 形状，
        // 对应现已不存在的接口版本），不出现在最终文档中；新增的 fewShotPool / fewShotPoolMeta 只需补在 spec.ts。
        type: "object",
        required: ["issue", "ruleGroup"],
        properties: {
          issue: { $ref: "#/components/schemas/JiraIssue" },
          ruleGroup: { type: "object", description: "前端 IndexedDB 中的 RuleGroup 配置" },
          fewShotSamples: {
            type: "array",
            items: { $ref: "#/components/schemas/FewShotSample" },
          },
          errorPatterns: {
            type: "array",
            description: "该规则组/车型历史上最常见的人工驳回类型（仅作提示词自查提醒）",
            items: {
              type: "object",
              properties: {
                code: { type: "string", enum: ["signal_missed", "timing_misjudged", "conclusion_overreach", "log_missing", "module_misrouted"] },
                count: { type: "integer" },
                share: { type: "number" },
                scope: { type: "string", enum: ["car_model", "rule_group"] },
              },
            },
          },
        },
      },
      IssueProcessResponse: {
        // 同样被 spec.ts 完全覆盖；fewShotRetrievalAudit 已在 spec.ts 的 IssueProcessResponse 中补充。
        type: "object",
        properties: {
          result: { type: "object" },
          reviewEvidence: {
            type: "object",
            properties: {
              carModel: { type: "string" },
              props: { type: "array", items: { type: "string" } },
              signalTokens: { type: "array", items: { type: "string" } },
              propertyIds: { type: "array", items: { type: "string" } },
            },
          },
          tokenUsage: { type: "integer", description: "本次分析与 AI 交互累计使用的 token 数（服务端未返回 usage 时为字符估算）" },
          error: { type: "string" },
        },
      },
      FewShotSample: {
        type: "object",
        properties: {
          sampleKind: { type: "string", enum: ["correction", "approved"] },
          approvedConclusion: { type: "string" },
          wrongConclusion: { type: "string" },
          correctConclusion: { type: "string" },
          errorReason: { type: "string" },
          errorCategory: { type: "string", enum: ["signal_missed", "timing_misjudged", "conclusion_overreach", "log_missing", "module_misrouted", "other"], description: "驳回原因类型" },
          carModel: { type: "string" },
          props: { type: "array", items: { type: "string" } },
          signalTokens: { type: "array", items: { type: "string" } },
          propertyIds: { type: "array", items: { type: "string" } },
          sampleId: { type: "string", description: "客户端样本 id；证据后再次召回用于快照去重" },
        },
      },
      ReviewRequest: {
        type: "object",
        required: ["conclusion", "issueSummary", "issueKey"],
        properties: {
          conclusion: { type: "string" },
          issueSummary: { type: "string" },
          issueKey: { type: "string" },
          ruleGroupId: { type: "string" },
          ruleGroupName: { type: "string" },
          analysisContext: { type: "object" },
          samples: {
            type: "array",
            items: { $ref: "#/components/schemas/FewShotSample" },
          },
        },
      },
      ReviewResponse: {
        type: "object",
        required: ["verdict", "reason"],
        properties: {
          verdict: { type: "string", enum: ["PASS", "FAIL"] },
          reason: { type: "string" },
        },
      },
      JiraCommentRequest: {
        type: "object",
        required: ["issueKey", "body"],
        properties: {
          issueKey: { type: "string" },
          body: { type: "string" },
          chartImagePath: { type: "string" },
        },
      },
      JiraCommentResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          commentId: { type: "string" },
          error: { type: "string" },
        },
      },
      TransitionRequest: {
        type: "object",
        required: ["transitionId"],
        properties: {
          transitionId: { type: "string" },
          targetUser: { type: "string" },
        },
      },
      TransitionResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          transitions: {
            type: "array",
            items: { $ref: "#/components/schemas/TransitionOption" },
          },
          assigneeCandidates: {
            type: "array",
            items: { $ref: "#/components/schemas/JiraAssigneeCandidate" },
          },
          transitionId: { type: "string" },
          transitionName: { type: "string" },
          targetStatus: { type: "string" },
          assignedTo: { type: "string" },
          error: { type: "string" },
        },
      },
      TransitionOption: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          targetStatus: { type: "string" },
        },
      },
      JiraAssigneeCandidate: {
        type: "object",
        properties: {
          name: { type: "string" },
          displayName: { type: "string" },
          emailAddress: { type: "string" },
          sourceLabels: { type: "array", items: { type: "string" } },
          active: { type: "boolean" },
        },
      },
      EmbeddingRequest: {
        type: "object",
        required: ["input"],
        properties: {
          input: {
            type: "array",
            maxItems: 64,
            items: { type: "string" },
          },
        },
      },
      EmbeddingResponse: {
        type: "object",
        properties: {
          model: { type: "string" },
          embeddings: {
            type: "array",
            items: {
              type: "array",
              items: { type: "number" },
            },
          },
        },
      },
      TerminalProjectsResponse: {
        type: "object",
        properties: {
          projects: {
            type: "array",
            items: { type: "object" },
          },
          configMissing: { type: "boolean", description: "服务端是否缺少当前目标的 project.json" },
          canImportCanonical: { type: "boolean", description: "当前用户导入是否写入规范文件 docs/project.json" },
        },
      },
      TerminalTargetsResponse: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      FeishuProcessResultRequest: {
        type: "object",
        required: ["ruleGroupName", "issueKey", "issueSummary", "status"],
        properties: {
          ruleGroupName: { type: "string" },
          issueKey: { type: "string" },
          issueUrl: { type: "string", description: "原票链接（http/https），作为卡片最后一行展示；飞书项目票会自动附带" },
          issueSummary: { type: "string" },
          issueDescription: { type: "string" },
          status: { type: "string", enum: ["success", "failed"] },
          replyText: { type: "string" },
          failureReason: { type: "string" },
          chartImagePath: { type: "string" },
          origin: { type: "string" },
          processedAt: { type: "string" },
        },
      },
    },
  },
};
