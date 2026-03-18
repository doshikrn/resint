import { useEffect, useState } from "react";
import { getOnlineUsers, type OnlineUser } from "@/lib/api/http";

/**
 * Polls GET /users/online every 15 seconds while enabled.
 * Clears the list immediately when disabled (logout / 401).
 */
export function useOnlineUsers(enabled: boolean): OnlineUser[] {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

  useEffect(() => {
    if (!enabled) {
      setOnlineUsers([]);
      return;
    }

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
