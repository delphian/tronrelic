'use client';

import Link from 'next/link';
import { Stack } from '../layout';
import { Card } from './Card';
import { Button } from './Button';

interface ErrorFallbackProps {
  error: Error;
  onRetry?: () => void;
  actionHref?: string;
  actionLabel?: string;
}

export function ErrorFallback({ error, onRetry, actionHref = '/', actionLabel = 'Return home' }: ErrorFallbackProps) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', padding: '2rem' }}>
      <Card padding="lg" tone="muted" style={{ maxWidth: '520px', width: '100%', textAlign: 'center' }}>
        <Stack gap="sm" style={{ alignItems: 'center' }}>
          <span className="badge badge--warning">Rendering error</span>
          <h2 style={{ marginBottom: '0.5rem', marginTop: '0.5rem' }}>We hit a snag</h2>
          <p className="text-subtle" style={{ margin: 0 }}>
            {error.message || 'An unexpected error occurred while rendering this section.'}
          </p>
          <Stack gap="sm" style={{ width: '100%' }}>
            {onRetry && (
              <Button onClick={onRetry} variant="primary">
                Try again
              </Button>
            )}
            <Link href={actionHref} style={{ width: '100%' }}>
              <Button variant="ghost" style={{ width: '100%' }}>
                {actionLabel}
              </Button>
            </Link>
          </Stack>
        </Stack>
      </Card>
    </div>
  );
}
