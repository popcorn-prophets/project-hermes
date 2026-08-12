import Logo from '@/components/brand/logo';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Offline — Project HERMES',
  description: 'No connection available.',
};

/**
 * Static fallback served by the service worker when a navigation fails
 * offline and the requested page isn't already cached.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-5 text-center">
      <Logo size={48} className="text-muted-foreground" />
      <h1 className="text-2xl font-bold tracking-tight">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">
        This page hasn&apos;t been saved for offline use. Pages you&apos;ve
        already visited will still work, and any previously loaded incident,
        resident, and advisory data will show as last synced.
      </p>
    </main>
  );
}
