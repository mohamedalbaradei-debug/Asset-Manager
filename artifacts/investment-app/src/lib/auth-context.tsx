import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthMe,
  loginAuth,
  registerAuth,
  logoutAuth,
  getGetAuthMeQueryKey,
  getGetWatchlistQueryKey,
  getGetWatchlistSummaryQueryKey,
  getGetCalendarQueryKey,
  getGetPriceAlertsQueryKey,
} from "@workspace/api-client-react";

export type SessionUser = { id: string; email: string };

type AuthCtx = {
  user: SessionUser | null;
  ready: boolean;
  refresh: () => void;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
};

const Ctx = React.createContext<AuthCtx>(null as unknown as AuthCtx);

function errText(err: unknown): string | undefined {
  const anyErr = err as { response?: { status?: number }; message?: string };
  if (anyErr?.response?.status === 401) return "Invalid email or password.";
  if (anyErr?.response?.status === 409) return "That email is already registered.";
  if (anyErr?.response?.status === 400) return "Check your email and password (min 8 characters).";
  return anyErr?.message ?? "Something went wrong.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useGetAuthMe({
    query: { queryKey: getGetAuthMeQueryKey(), retry: false },
  });

  const user = data?.user ?? null;

  const refresh = React.useCallback(() => {
    for (const queryKey of [
      getGetAuthMeQueryKey(),
      getGetWatchlistQueryKey(),
      getGetWatchlistSummaryQueryKey(),
      getGetCalendarQueryKey(),
      getGetPriceAlertsQueryKey(),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      try {
        await loginAuth({ email, password });
        refresh();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    },
    [refresh],
  );

  const register = React.useCallback(
    async (email: string, password: string) => {
      try {
        await registerAuth({ email, password });
        refresh();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    },
    [refresh],
  );

  const logout = React.useCallback(async () => {
    try {
      await logoutAuth();
    } finally {
      refresh();
    }
  }, [refresh]);

  const value = React.useMemo<AuthCtx>(
    () => ({ user, ready: !isPending, refresh, login, register, logout }),
    [user, isPending, refresh, login, register, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  return React.useContext(Ctx);
}
