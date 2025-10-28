import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { config } from '../lib/config';
import { buildMetadata, SITE_NAME } from '../lib/seo';
import './globals.css';
import { Providers } from './providers';
import { NavBar } from '../components/layout/NavBar';
import { BlockTicker } from '../components/layout/BlockTicker';

/**
 * Ordered theme for SSR injection.
 */
interface IOrderedTheme {
    id: string;
    name: string;
    css: string;
}

/**
 * Fetch active themes from backend API for SSR injection.
 *
 * This runs on every page load to ensure themes are always fresh.
 * The backend caches active themes in Redis for 1 hour to minimize
 * database queries and dependency sorting overhead.
 *
 * @returns Array of active themes in dependency order
 */
async function fetchActiveThemes(): Promise<IOrderedTheme[]> {
    try {
        const response = await fetch(`${config.apiBaseUrl}/system/themes/active`, {
            // Disable Next.js caching - rely on backend Redis cache instead
            cache: 'no-store'
        });

        if (!response.ok) {
            console.error('Failed to fetch active themes:', response.status);
            return [];
        }

        const data = await response.json();
        return data.themes || [];
    } catch (error) {
        console.error('Error fetching active themes:', error);
        return [];
    }
}

const rootMetadata = buildMetadata({
  title: 'Live TRON Blockchain Stats – Track Activity & Rent Energy | TronRelic',
  description: 'Explore live TRON blockchain metrics on TronRelic, including recent large stakes, energy delegations, and new token creations. Compare real-time TRON energy rental rates to optimize your transactions.',
  path: '/',
  keywords: [
    'TRON energy',
    'TRX staking',
    'TRON delegation',
    'TRON resource market',
    'TRON blockchain analytics'
  ]
});

export const metadata: Metadata = {
  ...rootMetadata,
  metadataBase: new URL(config.siteUrl),
  applicationName: SITE_NAME,
  category: 'Technology',
  openGraph: {
    ...rootMetadata.openGraph,
    locale: 'en_US'
  },
  twitter: {
    ...rootMetadata.twitter,
    creator: '@TronRelic'
  },
  robots: {
    index: true,
    follow: true
  }
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Fetch active themes for SSR injection
  const activeThemes = await fetchActiveThemes();

  return (
    <html lang="en">
      <head>
        {/* Inject active themes in dependency order */}
        {activeThemes.map((theme) => (
          <style
            key={theme.id}
            data-theme-id={theme.id}
            data-theme-name={theme.name}
            dangerouslySetInnerHTML={{ __html: theme.css }}
          />
        ))}
      </head>
      <body>
        <Providers>
          <NavBar />
          <BlockTicker />
          <main>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
