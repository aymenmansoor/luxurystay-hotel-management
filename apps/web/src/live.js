import { useEffect } from 'react';
import { io } from 'socket.io-client';

export function useLive(user, refresh) {
  useEffect(() => {
    if (!user) return;
    const socket = io({ transports: ['websocket'] });
    socket.on('connect', refresh);
    socket.on('hotel:update', refresh);
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = setInterval(refreshVisible, 60_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      socket.disconnect();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [user, refresh]);
}
