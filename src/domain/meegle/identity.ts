export interface MeegleIdentity {
  projectKey: string;
  workItemTypeKey: string;
  workItemId: string | number;
}

export function meegleIdentityKey(identity: MeegleIdentity): string {
  return `${identity.projectKey}:${identity.workItemTypeKey}:${identity.workItemId}`;
}

export function meegleIssueKey(identity: MeegleIdentity): string {
  return `meegle-${identity.projectKey}-${identity.workItemTypeKey}-${identity.workItemId}`;
}