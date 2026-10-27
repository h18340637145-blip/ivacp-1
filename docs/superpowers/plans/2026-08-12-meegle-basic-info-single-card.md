# 飞书工单基本信息单卡片布局实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将飞书工单详情页的基本信息从逐字段小卡片改为单个外层卡片内的单列键值列表。

**架构：** 保留 `MeegleWorkItemDetail` 的数据加载、字段顺序和 `Section` 外层容器，只调整 `MeegleBasicInfo` 的标记与专用样式。属性和经办人合并为同一行数据源，使用语义化 `dl`、`dt`、`dd` 呈现；其他详情区块继续使用现有网格和字段卡片样式。

**技术栈：** Next.js 16、React 19、TypeScript、内联 `React.CSSProperties`、Node.js 静态回归脚本。

---

## 文件结构

- 修改：`scripts/check-meegle-parity-ui.mjs`——增加基本信息单卡片结构的静态回归守卫。
- 修改：`components/meegle/MeegleWorkItemDetail.tsx`——将 `MeegleBasicInfo` 改为单列键值列表，并添加专用样式。
- 修改：`docs/PRODUCT.md`——记录飞书工单基本信息的单卡片展示规则。
- 修改：`session-handoff.md`——记录实现范围、验证结果和遗留边界。

### 任务 1：建立基本信息布局回归守卫

**文件：**
- 修改：`scripts/check-meegle-parity-ui.mjs:49-66`
- 测试：`scripts/check-meegle-parity-ui.mjs`

- [x] **步骤 1：编写失败的静态结构测试**

在现有 `MeegleBasicInfo` 断言后添加组件范围提取和结构约束：

```js
const basicInfo = detail.slice(
  detail.indexOf("function MeegleBasicInfo"),
  detail.indexOf("function MeegleAllFields"),
);
assert.match(basicInfo, /<dl style=\{basicInfoListStyle\}>/);
assert.match(basicInfo, /<dt style=\{basicInfoLabelStyle\}>/);
assert.match(basicInfo, /<dd style=\{basicInfoValueStyle\}>/);
assert.match(basicInfo, /basicInfoRowStyle/);
assert.match(basicInfo, /"经办人"/);
assert.doesNotMatch(basicInfo, /fieldStyle/, "基本信息字段不能继续使用独立卡片样式");
assert.doesNotMatch(basicInfo, /gridStyle/, "基本信息不能继续使用逐字段卡片网格");
```

- [x] **步骤 2：运行测试并确认红灯**

运行：

```bash
source ~/.bashrc
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
```

预期：FAIL，提示 `MeegleBasicInfo` 缺少 `basicInfoListStyle` 或 `dl` 结构。

### 任务 2：实现单列键值列表

**文件：**
- 修改：`components/meegle/MeegleWorkItemDetail.tsx:115-138`
- 测试：`scripts/check-meegle-parity-ui.mjs`

- [x] **步骤 1：合并属性和经办人数据源**

将 `MeegleBasicInfo` 改为先构造完整的键值行：

```tsx
function MeegleBasicInfo({ attributes, assigneeRole }: { attributes: Record<string, unknown>; assigneeRole: MeegleAssigneeRole | null }) {
  const rows: Array<[string, unknown]> = [
    ...Object.entries(attributes),
    ["经办人", assigneeRole?.members.map((member) => member.name).join("、") || "未指定"],
  ];

  return (
    <Section title="基本信息">
      <dl style={basicInfoListStyle}>
        {rows.map(([key, value], index) => (
          <div
            key={key}
            style={{
              ...basicInfoRowStyle,
              borderBottom: index === rows.length - 1 ? "none" : basicInfoRowStyle.borderBottom,
            }}
          >
            <dt style={basicInfoLabelStyle}>{key}</dt>
            <dd style={basicInfoValueStyle}>{displayValue(value)}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
```

- [x] **步骤 2：添加基本信息专用样式**

在现有样式常量旁添加：

```tsx
const basicInfoListStyle: React.CSSProperties = { margin: 0 };
const basicInfoRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(72px, 112px) minmax(0, 1fr)",
  gap: 16,
  padding: "10px 0",
  borderBottom: "1px solid var(--c-border-2)",
};
const basicInfoLabelStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--c-text-3)",
  fontWeight: 600,
};
const basicInfoValueStyle: React.CSSProperties = {
  ...preWrap,
  margin: 0,
  minWidth: 0,
};
```

该网格在窄屏自动把字段名列收缩到 `72px`，值列使用 `minmax(0, 1fr)` 避免长内容造成水平溢出。

- [x] **步骤 3：运行定向测试并确认绿灯**

运行：

```bash
source ~/.bashrc
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-workitem-detail
```

预期：两个命令均退出 0，分别输出 `Meegle parity UI checks: PASS` 和 `Meegle work item detail tests passed.`。

- [x] **步骤 4：提交组件实现**

```bash
git add -- scripts/check-meegle-parity-ui.mjs components/meegle/MeegleWorkItemDetail.tsx
git commit -m "style(飞书详情): 合并基本信息字段卡片"
```

### 任务 3：同步产品文档并完成验证

**文件：**
- 修改：`docs/PRODUCT.md:50-60`
- 修改：`session-handoff.md:1`

- [x] **步骤 1：同步产品展示规则**

在 `docs/PRODUCT.md` 的 UI 设计原则中增加：

```markdown
- 飞书工单详情的「基本信息」使用单个外层卡片，属性和经办人在卡片内按单列键值列表展示，不为每个字段重复绘制卡片。
```

- [x] **步骤 2：运行完整静态验证**

```bash
source ~/.bashrc
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-workitem-detail
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run build
git diff --check
```

预期：测试、类型检查和构建退出 0；ESLint 为 0 error，允许报告仓库已有 warning；`git diff --check` 无输出。

- [x] **步骤 3：执行浏览器布局验收**

复用已登录的本地开发页面，打开：

```text
/meegle/issues/7072316735?projectKey=6a3124c5681f717f59901004&workItemTypeKey=issue&ruleGroupId=3UciZIsXWv8kE5Uh3_ULr7
```

真实详情布局验收在当前 HEAD 临时叠加 `lib/server/meegle-cli.ts` 的已知分页修复后完成：将 `--auto-paginate` 替换为 `--params`、`JSON.stringify({ page_size: 200 })`，验证后已反向恢复且未提交。分别在桌面 `1440 px` 和 `390 px` 窄屏宽度确认：

- 「基本信息」只有一个外层边框。
- 字段逐行排列，字段名左对齐、字段值右侧换行。
- 经办人是最后一行。
- 基本信息区没有水平溢出；`390 px` 整页仍有其他详情区块长链接导致的既有水平溢出，本轮不处理。
- 「全部字段」「描述」「评论 / 备注」的外观未改变。

- [x] **步骤 4：更新交接记录**

在 `session-handoff.md` 顶部增加：

```markdown
### 2026-08-12 — 飞书工单基本信息单卡片布局（本轮）

- [x] **布局收口**：基本信息改为单个 Section 内的单列键值列表，属性与经办人统一呈现，不再绘制逐字段小卡片。
- [x] **响应式边界**：字段名列可收缩，字段值允许任意位置换行；其他详情区块保持不变。
- [x] **验证状态**：记录定向测试、TypeScript、ESLint、生产构建和浏览器宽窄屏验收结果。
```

- [x] **步骤 5：提交文档和交接记录**

```bash
git add -- docs/PRODUCT.md session-handoff.md
git commit -m "docs(飞书详情): 记录基本信息单卡片布局"
```

## 完成标准

- `MeegleBasicInfo` 只渲染一个外层 `Section`，内部为语义化单列键值列表。
- 基本信息组件范围内不再引用 `fieldStyle` 或 `gridStyle`。
- 属性和经办人完整显示，空值语义保持不变。
- 其他详情区块没有结构或行为变化。
- 相关测试、类型检查、Lint、生产构建和浏览器宽窄屏验收均完成。
- `docs/PRODUCT.md` 与 `session-handoff.md` 已同步更新。
