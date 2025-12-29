/**
 * Custom 404 Not Found Page
 *
 * Why custom 404:
 * - Branded experience keeps users engaged instead of bouncing
 * - Internal links help users find relevant content (SEO benefit)
 * - Clear navigation paths reduce frustration
 * - Proper HTTP 404 status is automatically set by Next.js
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { Page } from '../components/layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export const metadata: Metadata = {
  title: 'Page Not Found | TronRelic',
  description: 'The page you are looking for could not be found.',
  robots: {
    index: false,
    follow: true
  }
};

export default function NotFound() {
  return (
    <Page>
      <Card elevated padding="lg" style={{ maxWidth: '600px', margin: '4rem auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: '4rem', margin: '0 0 1rem', opacity: 0.3 }}>404</h1>
        <h2 style={{ margin: '0 0 1rem' }}>Page Not Found</h2>
        <p className="text-subtle" style={{ marginBottom: '2rem' }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
          <Link href="/">
            <Button variant="primary" size="lg">
              Go to Homepage
            </Button>
          </Link>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1rem' }}>
            <Link href="/resource-markets" className="link">
              Energy Markets
            </Link>
            <Link href="/about" className="link">
              About
            </Link>
          </div>
        </nav>
      </Card>
    </Page>
  );
}
