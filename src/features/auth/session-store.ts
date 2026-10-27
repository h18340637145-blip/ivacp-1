"use client";

import { create } from "zustand";
import { hasRole, type AuthRole, type AuthUser } from "@/domain/auth/permissions";
import { apiFetch } from "@/shared/lib/api";

interface SessionState {
  user: AuthUser | null;
  status: "idle" | "loading" | "ready";
  load: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
}

let inflight: Promise<AuthUser | null> | null = null;

export const useSessionStore = create<SessionState>((set, get) => ({
  user: null,
  status: "idle",
  load: () => {
    if (get().status === "ready") return Promise.resolve(get().user);
    if (inflight) return inflight;
    set({ status: "loading" });
    inflight = apiFetch<{ user?: AuthUser }>("/api/auth/session")
      .then((data) => data.user ?? null)
      .catch(() => null)
      .then((user) => {
        set({ user, status: "ready" });
        inflight = null;
        return user;
      });
    return inflight;
  },
  logout: async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    set({ user: null, status: "idle" });
    window.location.href = "/login";
  },
}));

/** 当前用户与权限判断 */
export function useSession() {
  const user = useSessionStore((state) => state.user);
  const status = useSessionStore((state) => state.status);
  return {
    user,
    ready: status === "ready",
    username: user?.username ?? "",
    can: (role: AuthRole) => hasRole(user, role),
  };
}
