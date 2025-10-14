'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('Global error boundary captured', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="page">
          <Card elevated tone="accent" padding="lg" style={{ marginTop: '4rem' }}>
            <h1 style={{ marginTop: 0 }}>Something went wrong</h1>
            <p className="text-subtle">{error.message ?? 'An unexpected error occurred while rendering this page.'}</p>
            <div className="form-footer">
              <Button variant="ghost" onClick={() => reset()}>
                Try again
              </Button>
              <Link href="/">
                <Button variant="primary">Return home</Button>
              </Link>
            </div>
          </Card>
        </div>
      </body>
    </html>
  );
}
