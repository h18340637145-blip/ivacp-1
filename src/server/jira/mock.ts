/** Mock Jira JQL filter — simulates a real Jira REST API response */

export interface MockIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string;
  reporter: string;
  created: string;
  updated: string;
  issueType: string;
  labels: string[];
}

const SUMMARIES = [
  "车速信号异常：CAN 报文 ID 0x1A2 丢帧率超过 5%",
  "仪表盘转速显示抖动，频率约 2Hz，重现条件：怠速+空调开启",
  "VehicleHal VHAL 服务崩溃：handleGetValues 抛出 IllegalStateException",
  "CAN 总线报文丢失：ECU 离线超时导致 HAL 层 DEAD_OBJECT 错误",
  "车辆状态机切换异常：Driving→Parking 状态未触发 PARK_BRAKE 信号",
  "Proto 解析失败：VehicleAreaConfig 字段类型不匹配（期望 int32，实际 float）",
  "安卓日志显示 WatchDog 触发 timeout：VehicleService ANR 10000ms",
  "QNX BSP 层 CAN 驱动报错：can_write buffer overflow at 120km/h",
  "外部 CAN 信号解码偏差：转向角实际值与 DBC 定义 offset 不符",
  "车窗控制 VehicleArea.WINDOW 区域映射错误，左右窗控指令互换",
  "ACC 自适应巡航 CAN 信号 ID 0x3E8 在特定车速下报文丢失",
  "车载以太网 DoIP 通信超时：诊断请求 0x7DF 响应延迟 >500ms",
  "电池管理系统 BMS SOC 信号精度不足：CAN 分辨率 1% 与需求 0.1% 不符",
  "HVAC 温度传感器 CAN 报文校验和错误，CRC 计算方式与规范不一致",
  "车道偏离预警 LDWS 信号在高速公路弯道场景下误触发",
];

const PRIORITIES = ["Highest", "High", "Medium", "Low"];
const ASSIGNEES = ["zhang.wei", "li.fang", "wang.jing", "chen.ming", "auto-unassigned"];
const REPORTERS = ["oem-chery-qa", "oem-geely-qa", "bosch-integration-team"];
const ISSUE_TYPES = ["Bug", "故障", "Task", "Improvement"];
const LABEL_POOL = [
  "CAN", "VehicleHal", "QNX", "Android", "Proto",
  "CANtrace", "ECU", "HAL", "BMS", "HVAC", "ACC",
];

/** Extract project key from JQL, e.g. "project = VH AND ..." → "VH" */
function extractProjectKey(jql: string): string {
  const m = jql.match(/project\s*[=IN]+\s*["']?([A-Z][A-Z0-9_\-]{1,8})["']?/i);
  return m ? m[1].toUpperCase() : "VH";
}

export async function mockJiraFilter(jql: string): Promise<MockIssue[]> {
  // simulate 1–2 s network latency
  const delay = 1200 + Math.random() * 1000;
  await new Promise<void>((r) => setTimeout(r, delay));

  const projectKey = extractProjectKey(jql);
  const count = 3 + Math.floor(Math.random() * 8); // 3–10 tickets
  const now = Date.now();
  const issues: MockIssue[] = [];

  for (let i = 0; i < count; i++) {
    const num = 10000 + Math.floor(Math.random() * 90000);
    const daysAgo = Math.floor(Math.random() * 30);
    const createdMs = now - daysAgo * 86_400_000;

    // pick 1-3 random labels
    const labelCount = 1 + Math.floor(Math.random() * 3);
    const labels: string[] = [];
    for (let l = 0; l < labelCount; l++) {
      const pick = LABEL_POOL[Math.floor(Math.random() * LABEL_POOL.length)];
      if (!labels.includes(pick)) labels.push(pick);
    }

    issues.push({
      key: `${projectKey}-${num}`,
      summary: SUMMARIES[i % SUMMARIES.length],
      status: "Open",
      priority: PRIORITIES[Math.floor(Math.random() * PRIORITIES.length)],
      assignee: ASSIGNEES[Math.floor(Math.random() * ASSIGNEES.length)],
      reporter: REPORTERS[Math.floor(Math.random() * REPORTERS.length)],
      created: new Date(createdMs).toISOString(),
      updated: new Date(createdMs + Math.random() * 86_400_000 * 3).toISOString(),
      issueType: ISSUE_TYPES[Math.floor(Math.random() * ISSUE_TYPES.length)],
      labels,
    });
  }

  return issues;
}
