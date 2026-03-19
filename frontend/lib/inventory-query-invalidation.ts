import type { QueryClient } from "@tanstack/react-query";

const INVENTORY_GLOBAL_QUERY_KEYS = [["items-frequent"], ["items-recent"]] as const;

export async function invalidateInventorySessionQueries(params: {
  queryClient: QueryClient;
  sessionId: number | null | undefined;
  activeSessionQueryKey?: readonly unknown[];
}) {
  const { queryClient, sessionId, activeSessionQueryKey } = params;

  const tasks: Promise<unknown>[] = [];

  if (sessionId) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ["recent-entries", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["recent-events", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["session-entries", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["session-audit", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["session-audit-log", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["session-progress", sessionId] }),
    );
  }

  for (const queryKey of INVENTORY_GLOBAL_QUERY_KEYS) {
    tasks.push(queryClient.invalidateQueries({ queryKey }));
  }

  if (activeSessionQueryKey) {
    tasks.push(queryClient.invalidateQueries({ queryKey: activeSessionQueryKey }));
  }

  await Promise.all(tasks);
}

export async function cancelInventoryRecentQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ["recent-entries"] }),
    queryClient.cancelQueries({ queryKey: ["recent-events"] }),
  ]);
}