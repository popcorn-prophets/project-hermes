'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function OfflineActions() {
  const router = useRouter();

  return (
    <div className="mt-2 flex gap-2">
      <Button variant="outline" onClick={() => router.back()}>
        Go back
      </Button>
      <Button onClick={() => router.push('/')}>Return home</Button>
    </div>
  );
}
