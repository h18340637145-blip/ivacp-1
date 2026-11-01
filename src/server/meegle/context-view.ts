import path from "node:path";
import { createMeegleContextCache } from "./context-cache";
import { loadMeegleWorkItem } from "./work-item";
import { runMeegle } from "./cli";

export const meegleContextCache = createMeegleContextCache({
  root: path.join(process.cwd(), "jira-issues", "meegle-context"),
  loadDetail: async identity => {
    const result = await loadMeegleWorkItem(identity.projectKey, identity.workItemId);
    return { detail: result.body.detail, errors: result.body.errors, status: result.status as 200 | 502 };
  },
  download: (identity, url, destination, timeout) => runMeegle([
    "attachment", "+download", url, "--project-key", identity.projectKey,
    "--work-item-id", identity.workItemId, "--output", destination, "--overwrite",
  ], timeout),
});
