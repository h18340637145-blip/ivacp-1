/** Jira 筛票接口（/api/jira/filter）返回给客户端的归一化工单结构，前后端共用 */

export interface JiraAttachment {
  id: string;
  filename: string;
  created: string;
  size: number;
  mimeType: string;
  contentUrl: string;
  authorName: string;
  /** 来源特定的下载协议（飞书评论附件），不改变 Jira 行为 */
  source?: "meegle-comment";
}

export interface JiraComment {
  author: string;
  body: string;
  created: string;
}

export interface JiraIssue {
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
  attachmentCount: number;
  attachments: JiraAttachment[];
  description: string;
  comments: JiraComment[];
}
