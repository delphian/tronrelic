import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { getServerConfig, type RuntimeConfig } from '../lib/serverConfig';
import { buildMetadata, SITE_NAME } from '../lib/seo';
import './globals.css';
import { Providers } from './providers';
import { MainHeader } from '../components/layout/MainHeader';
import { BlockTicker } from '../components/layout/BlockTicker';

/**
 * Ordered theme for SSR injection.
 */
interface IOrderedTheme {
    id: string;
    name: string;
    icon: string;
    css: string;
}

/**
 * Fetch active themes from backend API for SSR injection.
 *
 * This runs on every page load to ensure themes are always fresh.
 * The backend caches active themes in Redis for 1 hour to minimize
 * database queries and dependency sorting overhead.
 *
 * @param apiUrl - Runtime API URL from server config
 * @returns Array of active themes in dependency order
 */
async function fetchActiveThemes(apiUrl: string): Promise<IOrderedTheme[]> {
    try {
        const response = await fetch(`${apiUrl}/system/themes/active`, {
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

/**
 * Generates dynamic metadata using runtime configuration.
 *
 * Why async function instead of export const:
 * Next.js allows metadata to be generated dynamically at request time using generateMetadata().
 * This enables us to use runtime configuration (fetched from backend) instead of build-time
 * environment variables. The siteUrl is fetched once at container startup and cached,
 * so this function has zero overhead after the first call.
 *
 * @returns Metadata object with runtime siteUrl for metadataBase
 */
export async function generateMetadata(): Promise<Metadata> {
  const { siteUrl } = await getServerConfig();

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

  return {
    ...rootMetadata,
    metadataBase: new URL(siteUrl), // Uses runtime config, not build-time
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
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Fetch runtime configuration from backend (cached after first call)
  const runtimeConfig = await getServerConfig();

  // Fetch active themes for SSR injection
  const activeThemes = await fetchActiveThemes(runtimeConfig.apiUrl);

  // Read theme preference from cookie for SSR (prevents flash)
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get('theme');
  const selectedThemeId = themeCookie?.value || null;

  // Validate that selected theme is actually active
  const isValidTheme = selectedThemeId && activeThemes.some(t => t.id === selectedThemeId);
  const dataThemeAttr = isValidTheme ? selectedThemeId : undefined;

  return (
    <html lang="en" data-theme={dataThemeAttr}>
      <head>
        {/* Inject runtime configuration before any client scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__RUNTIME_CONFIG__=${JSON.stringify(runtimeConfig)};`
          }}
        />
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
          <MainHeader />
          <BlockTicker />
          <main>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
