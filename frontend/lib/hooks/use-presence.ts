import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getOnlineUsers, sendHeartbeat, type OnlineUser } from "@/lib/api/http";

export const ONLINE_USERS_QUERY_KEY = ["online-users"] as const;

const HEARTBEAT_INTERVAL_MS = 25_000;
const ONLINE_USERS_REFETCH_INTERVAL_MS = 15_000;

function normalizeOnlineUsers(users: OnlineUser[]): OnlineUser[] {
  const deduped = new Map<number, OnlineUser>();
  for (const user of users) {
    if (!user || deduped.has(user.id)) {
      continue;
    }
    deduped.set(user.id, user);
  }

  return Array.from(deduped.values()).sort((left, right) => {
    const leftName = (left.full_name ?? left.username).toLocaleLowerCase();
    const rightName = (right.full_name ?? right.username).toLocaleLowerCase();
    if (leftName === rightName) {
      return left.id - right.id;
    }
    return leftName.localeCompare(rightName);
  });
}

export function usePresence(enabled: boolean) {
  const queryClient = useQueryClient();
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [isBrowserOnline, setIsBrowserOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const presenceEnabled = enabled && isBrowserOnline;
  const queryFn = useCallback(async () => normalizeOnlineUsers(await getOnlineUsers()), []);

  const onlineUsersQuery = useQuery({
    queryKey: ONLINE_USERS_QUERY_KEY,
    queryFn,
    enabled: presenceEnabled && isDocumentVisible,
    staleTime: 10_000,
    refetchInterval: presenceEnabled && isDocumentVisible ? ONLINE_USERS_REFETCH_INTERVAL_MS : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
    retry: 1,
  });

  const heartbeatInFlightRef = useRef<Promise<void> | null>(null);

  const refreshOnlineUsers = useCallback(async () => {
    if (!presenceEnabled || !isDocumentVisible) {
      return normalizeOnlineUsers(onlineUsersQuery.data ?? []);
    }

    return queryClient.fetchQuery({
      queryKey: ONLINE_USERS_QUERY_KEY,
      queryFn,
      staleTime: 0,
    });
  }, [isDocumentVisible, onlineUsersQuery.data, presenceEnabled, queryClient, queryFn]);

  const heartbeat = useCallback(
    async (reason: "interval" | "focus" | "visible" | "online" | "initial") => {
      if (!presenceEnabled || !isDocumentVisible) {
        return;
      }
      if (heartbeatInFlightRef.current) {
        return heartbeatInFlightRef.current;
      }

      const promise = sendHeartbeat()
        .then(async () => {
          await refreshOnlineUsers();
          if (process.env.NODE_ENV !== "production") {
            console.info("[presence] heartbeat ok", { reason });
          }
        })
        .catch((error) => {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[presence] heartbeat failed", { reason, error: String(error) });
          }
        })
        .finally(() => {
          heartbeatInFlightRef.current = null;
        });

      heartbeatInFlightRef.current = promise;
      return promise;
    },
    [isDocumentVisible, presenceEnabled, refreshOnlineUsers],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      setIsDocumentVisible(visible);
      if (visible) {
        void heartbeat("visible");
      }
    };

    const handleFocus = () => {
      void heartbeat("focus");
    };

    const handleOnline = () => {
      setIsBrowserOnline(true);
      void heartbeat("online");
    };

    const handleOffline = () => {
      setIsBrowserOnline(false);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [heartbeat]);

  useEffect(() => {
    if (!presenceEnabled || !isDocumentVisible) {
      return;
    }

    void heartbeat("initial");
    const intervalId = window.setInterval(() => {
      void heartbeat("interval");
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [heartbeat, isDocumentVisible, presenceEnabled]);

  useEffect(() => {
    if (presenceEnabled) {
      return;
    }

    void queryClient.cancelQueries({ queryKey: ONLINE_USERS_QUERY_KEY });
    queryClient.setQueryData(ONLINE_USERS_QUERY_KEY, []);
  }, [presenceEnabled, queryClient]);

  const onlineUsers = useMemo(
    () => normalizeOnlineUsers(onlineUsersQuery.data ?? []),
    [onlineUsersQuery.data],
  );

  return {
    onlineUsers,
    onlineUsersCount: onlineUsers.length,
    isDocumentVisible,
    isBrowserOnline,
    isRefreshing: onlineUsersQuery.isFetching,
    refreshPresence: refreshOnlineUsers,
  };
}