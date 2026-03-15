import { useEffect, useState } from "react";
import { getOnlineUsers, type OnlineUser } from "@/lib/api/http";

/**
 * Polls GET /users/online every 15 seconds while enabled.
 * Returns the latest list of online users.
 */
export function useOnlineUsers(enabled: boolean): OnlineUser[] {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const poll = () => {
      getOnlineUsers()
        .then((users) => setOnlineUsers(users))
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 15_000);
    return () => window.clearInterval(id);
  }, [enabled]);

  return onlineUsers;
}
