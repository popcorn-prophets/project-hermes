'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

export function ConnectivityStatus() {
  const wasOffline = useRef(false);

  useEffect(() => {
    function handleOffline() {
      wasOffline.current = true;
      toast.warning("You're offline", {
        description: 'Showing last synced data. Some pages may be unavailable.',
        duration: Infinity,
        id: 'connectivity-status',
      });
    }

    function handleOnline() {
      if (wasOffline.current) {
        toast.success('Back online', {
          description: 'Syncing latest data…',
          id: 'connectivity-status',
        });
        wasOffline.current = false;
      }
    }

    if (!navigator.onLine) handleOffline();

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return null;
}
