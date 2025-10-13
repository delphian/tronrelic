'use client';

import { useEffect } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('Dashboard route error', error);
  }, [error]);

  return (
    <Card tone="accent" elevated padding="lg" style={{ marginTop: '3rem' }}>
      <h1 style={{ marginTop: 0 }}>Unable to load dashboard</h1>
      <p className="text-subtle">{error.message ?? 'An unexpected error occurred while loading this dashboard.'}</p>
      <div className="form-footer">
        <Button variant="ghost" onClick={() => reset()}>
          Retry
        </Button>
      </div>
    </Card>
  );
}
