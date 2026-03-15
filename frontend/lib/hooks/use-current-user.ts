import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getCurrentUser, type CurrentUserProfile } from "@/lib/api/http";

export const CURRENT_USER_CACHE_KEY = "rr_current_user";

export const CURRENT_USER_QUERY_KEY = ["current-user"] as const;

export function useCurrentUser() {
  const [cachedUser, setCachedUser] = useState<CurrentUserProfile | null>(null);

  const query = useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: () => getCurrentUser(3500),
    retry: 1,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
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

  // Clear stale cached user when the auth query fails (401, timeout, network error).
  // Without this, cookies can be cleared while cachedUser state stays non-null,
  // leaving the app in a broken "authenticated" state with all API calls failing.
  useEffect(() => {
    if (!query.isError) return;
    setCachedUser(null);
    const status =
      query.error && "status" in query.error
        ? (query.error as { status: number }).status
        : 0;
    if (status === 401 && typeof window !== "undefined") {
      window.localStorage.removeItem(CURRENT_USER_CACHE_KEY);
    }
  }, [query.isError, query.error]);

  const user = query.data ?? cachedUser;
  const is401 = query.error && "status" in query.error && (query.error as { status: number }).status === 401;

  return { user, isLoading: query.isLoading && !cachedUser, is401: Boolean(is401) };
}
