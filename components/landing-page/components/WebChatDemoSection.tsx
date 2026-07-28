import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';

import { ChatChannelLinks } from '@/components/chat-channel-links';
import {
  type DestinationMarker,
  type IncidentMarker,
} from '@/components/control-center/map/interactive-map';
import { RealtimeIncidentMapDemo } from '@/components/landing-page/components/realtime-incident-map-demo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { WebChatInterface } from '@/components/web-chat-interface';
import { toCoordinates } from '@/lib/geo';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/supabase';

const demoDestination: DestinationMarker = {
  id: 'demo-command-center',
  longitude: 122.23505,
  latitude: 10.64078,
  label: 'HERMES Command Center',
};

type IncidentRow = Pick<
  Database['public']['Tables']['incidents']['Row'],
  | 'id'
  | 'description'
  | 'incident_time'
  | 'location'
  | 'location_description'
  | 'severity'
  | 'status'
>;

const OPEN_STATUSES = ['new', 'validated', 'in_progress'] as const;

async function loadLiveIncidentMarkers(): Promise<IncidentMarker[]> {
  noStore();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('incidents')
      .select(
        'id, description, incident_time, location, location_description, severity, status'
      )
      .in('status', OPEN_STATUSES);

    if (error) {
      throw error;
    }

    const incidents = (data ?? []) as IncidentRow[];

    return incidents.flatMap((incident) => {
      const { longitude, latitude } = toCoordinates(incident.location);

      if (longitude === null || latitude === null) {
        return [];
      }

      return [
        {
          id: incident.id,
          longitude,
          latitude,
          label:
            incident.location_description ??
            `${String(incident.severity ?? 'unknown').toUpperCase()} · ${String(incident.status ?? 'unknown').replace('_', ' ')}`,
          severity: incident.severity,
          status: incident.status,
          description: incident.description,
          incidentTime: incident.incident_time,
        },
      ];
    });
  } catch (error) {
    console.error('Failed to load landing page incident markers:', error);
    return [];
  }
}

export async function WebChatDemoSection() {
  const demoMarkers = await loadLiveIncidentMarkers();

  return (
    <section className="relative w-full px-4 py-8 sm:px-6 sm:py-12 mt-4 mb-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="grid gap-6 xl:grid-cols-2 items-center justify-center">
          <div className="space-y-3 justify-center">
            <div className="flex items-center justify-center gap-2">
              <Badge variant="secondary">Resident Chat</Badge>
            </div>

            <div className="mx-auto w-full max-w-105">
              <div className="mb-3 flex justify-center">
                <ChatChannelLinks />
              </div>
              <div className="relative rounded-[2.5rem] border border-foreground/15 bg-linear-to-b from-zinc-200 to-zinc-300 p-2 shadow-2xl dark:from-zinc-800 dark:to-zinc-900">
                <div className="absolute left-1/2 top-2 h-5 w-36 -translate-x-1/2 rounded-b-2xl bg-zinc-900/95" />

                <div className="overflow-hidden rounded-4xl border border-black/10 bg-background">
                  <div className="h-[min(72vh,740px)] min-h-140">
                    <WebChatInterface
                      title="Chat"
                      showChannelLinks={false}
                      className="h-full rounded-none border-0 shadow-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <Button asChild size="sm" className="min-w-40">
                <Link href="/chat">Open Web Chat</Link>
              </Button>
            </div>
          </div>

          <div className="space-y-3 justify-center">
            <div className="flex items-center justify-center gap-2">
              <Badge variant="secondary">Control Center</Badge>
            </div>

            <div className="rounded-4xl border bg-card p-3 shadow-lg sm:p-4">
              <div className="flex items-center justify-between gap-3 px-2 pb-3">
                <div>
                  <h3 className="text-sm font-semibold sm:text-base">
                    Live incident map
                  </h3>
                </div>
                <Badge variant="outline">Operations</Badge>
              </div>

              <Separator className="mb-3" />

              <div className="overflow-hidden rounded-3xl border bg-background">
                <div className="h-[min(72vh,740px)] min-h-140">
                  <RealtimeIncidentMapDemo
                    initialMarkers={demoMarkers}
                    destination={demoDestination}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <Button asChild size="sm" variant="outline" className="min-w-40">
                <Link href="/control-center">Open Control Center</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
