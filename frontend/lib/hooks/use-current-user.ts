import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getCurrentUser, type CurrentUserProfile } from "@/lib/api/http";

export const CURRENT_USER_CACHE_KEY = "rr_current_user";

export const CURRENT_USER_QUERY_KEY = ["current-user"] as const;

function getErrorStatus(error: unknown): number {
  return error && typeof error === "object" && "status" in error
    ? ((error as { status: number }).status ?? 0)
    : 0;
}

export function useCurrentUser() {
  const [cachedUser, setCachedUser] = useState<CurrentUserProfile | null>(null);

  const query = useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: () => getCurrentUser(3500),
    retry: (failureCount, error) => getErrorStatus(error) !== 401 && failureCount < 2,
    retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 5_000),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Seed from localStorage on mount (instant placeholder)
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(CURRENT_USER_CACHE_KEY);
    if (!raw) {
      setCachedUser(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as CurrentUserProfile;
      if (!parsed || typeof parsed !== "object") {
        setCachedUser(null);
        return;
      }
      setCachedUser(parsed);
    } catch {
      setCachedUser(null);
    }
  }, []);

  // Persist fresh query data to localStorage so app-shell and other consumers stay in sync
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (query.data) {
      window.localStorage.setItem(CURRENT_USER_CACHE_KEY, JSON.stringify(query.data));
    }
  }, [query.data]);

  // Only clear the cached user when the backend confirms the session is invalid.
  // Transient network / timeout errors should not force a logout while refresh or
  // a later retry can still recover the session.
  useEffect(() => {
    if (!query.isError) return;
    const status = getErrorStatus(query.error);
    if (status !== 401) {
      return;
    }

    setCachedUser(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CURRENT_USER_CACHE_KEY);
    }
  }, [query.isError, query.error]);

  const user = query.data ?? cachedUser;
  const errorStatus = getErrorStatus(query.error);
  const is401 = errorStatus === 401;
  const isRecoverableError = query.isError && errorStatus !== 401;

  return {
    user,
    isLoading: query.isLoading && !cachedUser,
    is401: Boolean(is401),
    isRecoverableError,
    errorStatus,
    retryAuthCheck: () => query.refetch(),
  };
}
