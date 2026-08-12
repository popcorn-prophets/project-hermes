'use client';

import { Incident, fetchAllIncidents } from '@/lib/supabase/reports';
import { useIncidentsRealtime } from '@/lib/supabase/use-incidents-realtime';
import * as React from 'react';
import { columns } from './report-columns';
import { ReportTable } from './report-table';

async function getData(): Promise<Incident[] | null> {
  const allIncidents = await fetchAllIncidents();
  return allIncidents ?? [];
}

export function ReportTableCard() {
  const [incidentData, setIncidentData] = React.useState<Incident[] | null>(
    null
  );

  const loadIncidents = React.useCallback(async () => {
    try {
      const data = await getData();
      setIncidentData(data);
    } catch (error) {
      console.error('Failed to load incidents:', error);
    }
  }, []);

  React.useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  useIncidentsRealtime(loadIncidents);

  return (
    <div className="py-10 w-full h-full">
      {incidentData ? (
        <ReportTable columns={columns} data={incidentData} />
      ) : (
        <div className="text-center text-gray-500">No data available</div>
      )}
    </div>
  );
}
