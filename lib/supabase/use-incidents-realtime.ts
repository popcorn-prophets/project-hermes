import * as React from 'react';

import { createClient } from '@/lib/supabase/client';

export function useIncidentsRealtime(onChange: () => void) {
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('incidents-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents' },
        () => onChange()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onChange]);
}
