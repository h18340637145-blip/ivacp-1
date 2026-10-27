# 飞书项目空间访问与待办查询

本文说明如何通过 `meegle` CLI 访问飞书项目空间，并读取当前登录用户的待办工作项。

## 前置条件

安装 `meegle` CLI 并完成飞书项目登录：

```bash
meegle auth status --format json
```

已登录时，输出包含：

```json
{
  "authenticated": true,
  "host": "project.feishu.cn"
}
```

未登录时，执行：

```bash
meegle auth login --host project.feishu.cn
```

该命令会打开浏览器，完成 OAuth 授权。

## 空间配置

在 `.env` 中配置空间标识：

```dotenv
PROJECT_KEY='6a3124c5681f717f59901004'
```

`PROJECT_KEY` 是飞书项目空间的唯一标识。当前配置对应的空间为：

| 名称 | project_key | simple_name |
| --- | --- | --- |
| 捷途 | `6a3124c5681f717f59901004` | `pojw7j` |

## 验证空间访问权限

使用空间 key 查询空间信息：

```bash
meegle project search \
  --project-key '6a3124c5681f717f59901004' \
  --format json
```

命令返回对应的空间记录时，表示当前登录用户拥有该空间的访问权限。

## 查询当前用户待办

查询当前登录用户的待办：

```bash
meegle mywork todo \
  --action todo \
  --page-num 1 \
  --format json
```

常用 `action`：

| 值 | 含义 |
| --- | --- |
| `todo` | 待办 |
| `done` | 已办 |
| `overdue` | 逾期事项 |
| `this_week` | 本周待办 |

响应中的关键字段如下：

```json
{
  "project_key": "6a3124c5681f717f59901004",
  "project_name": "捷途",
  "state_info": {
    "start_state_key_name": "处理中"
  },
  "work_item_info": {
    "work_item_id": 7051652136,
    "work_item_name": "工作项标题",
    "work_item_type_key": "issue"
  }
}
```

当前查询结果显示：待办均属于“捷途”空间，共 24 条。

## Open API 补充

若不使用已登录的 CLI，而是从程序直接调用飞书项目 Open API，需要在飞书项目开放平台创建、安装并授权插件。

空间列表接口：

```http
POST https://project.feishu.cn/open_api/projects
Content-Type: application/json
X-PLUGIN-TOKEN: <插件 Token>
X-USER-KEY: <用户 user_key>
```

请求体：

```json
{
  "user_key": "你的 USER_KEY",
  "order": ["-last_visited"]
}
```

若返回 `10021 Token Not Exist`，说明请求缺少插件 Token。插件级 Token 请求还必须传递 `X-USER-KEY`。