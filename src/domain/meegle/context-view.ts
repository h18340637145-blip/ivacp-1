import type { MeegleWorkItemDetail, MeegleWorkItemDetailErrors, MeegleWorkItemIdentity } from "./work-item-detail";

export interface MeegleContextImage {
  id: string;
  name: string;
  status: "cached" | "unavailable";
  reason?: string;
}

export interface MeegleContextView {
  detail: MeegleWorkItemDetail | null;
  images: Record<string, MeegleContextImage>;
  source: "cache" | "remote" | "snapshot";
  cachedAt?: string;
  warning?: string;
  errors?: MeegleWorkItemDetailErrors;
}

export function meegleContextImageUrl(identity: MeegleWorkItemIdentity, imageId: string): string {
  const query = new URLSearchParams({ ...identity, imageId });
  return `/api/meegle/context-image?${query}`;
}
