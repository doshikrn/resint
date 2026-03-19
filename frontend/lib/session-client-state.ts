import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { CURRENT_USER_QUERY_KEY } from "@/lib/hooks/use-current-user";

const PROTECTED_QUERY_PREFIXES = new Set([
  "active-session",
  "inventory-sessions-history",
  "recent-entries",
  "recent-events",
  "session-entries",
  "session-audit",
  "session-audit-log",
  "session-progress",
  "items-frequent",
  "items-recent",
  "warehouses-manager-fallback",
]);

function isProtectedQueryKey(queryKey: QueryKey): boolean {
  const head = queryKey[0];
  return typeof head === "string" && PROTECTED_QUERY_PREFIXES.has(head);
}

export async function resetProtectedClientState(queryClient: QueryClient) {
  await queryClient.cancelQueries({ predicate: (query) => isProtectedQueryKey(query.queryKey) });
  queryClient.removeQueries({ predicate: (query) => isProtectedQueryKey(query.queryKey) });
}

export async function resetAuthBootstrapState(queryClient: QueryClient) {
  await queryClient.cancelQueries({ queryKey: CURRENT_USER_QUERY_KEY });
  queryClient.removeQueries({ queryKey: CURRENT_USER_QUERY_KEY });
}