import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { getServerConfig, type RuntimeConfig } from '../lib/serverConfig';
import { getServerSideApiUrl } from '../lib/api-url';
import { buildMetadata, SITE_NAME } from '../lib/seo';
import './globals.scss';
import { Providers, type SSRUserData } from './providers';
import { MainHeader } from '../components/layout/MainHeader';
import { BlockTicker } from '../components/layout/BlockTicker';
import { getServerUserId, getServerUser } from '../modules/user/lib/server';
import type { BlockSummary } from '../features/blockchain/slice';

/**
 * Builds site-wide structured data for SEO.
 *
 * Why structured data:
 * - Organization schema establishes brand identity in Google's Knowledge Graph
 * - WebSite schema enables sitelinks searchbox in search results
 * - Both help Google understand the site structure and ownership
 *
 * @param siteUrl - Public site URL from runtime config
 * @returns JSON-LD structured data object
 */
function buildSiteStructuredData(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        'name': 'TronRelic',
        'url': siteUrl,
        'logo': {
          '@type': 'ImageObject',
          'url': `${siteUrl}/images/favicon/ms-icon-310x310.png`
        },
        'sameAs': [
          'https://twitter.com/TronRelic'
        ]
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        'name': 'TronRelic',
        'url': siteUrl,
        'description': 'Live TRON blockchain analytics and energy rental marketplace',
        'publisher': {
          '@id': `${siteUrl}/#organization`
        }
      }
    ]
  };
}

/**
 * SVG element definition matching lucide package format.
 * Each tuple contains [elementType, attributes].
 */
type IconElement = [string, Record<string, string>];

/**
 * Array of SVG elements that compose an icon.
 */
type IconNode = IconElement[];

/**
 * Ordered theme for SSR injection.
 * Includes pre-resolved SVG data to avoid bundling all Lucide icons.
 */
export interface IOrderedTheme {
    id: string;
    name: string;
    icon: string;
    /** Pre-resolved SVG path data from backend */
    iconSvg: IconNode | null;
    css: string;
}

/**
 * Fetch active themes from backend API for SSR injection.
 *
 * This runs on every page load to ensure themes are always fresh.
 * The backend caches active themes in Redis for 1 hour to minimize
 * database queries and dependency sorting overhead.
 *
 * IMPORTANT: Uses internal Docker URL (SITE_BACKEND) for container-to-container
 * communication during SSR. The external apiUrl doesn't resolve from inside containers.
 *
 * @returns Array of active themes in dependency order
 */
async function fetchActiveThemes(): Promise<IOrderedTheme[]> {
    try {
        const backendUrl = getServerSideApiUrl();
        const response = await fetch(`${backendUrl}/api/system/themes/active`, {
            // Disable Next.js caching - rely on backend Redis cache instead
            cache: 'no-store',
            signal: AbortSignal.timeout(5000) // 5 second timeout
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
    siteUrl,
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
    manifest: '/images/favicon/manifest.json',
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

/**
 * Fetch latest block for SSR to enable immediate ticker rendering.
 *
 * Fetches the most recent indexed block from the backend API. This data
 * is passed to BlockTicker to render immediately during SSR instead of
 * waiting for WebSocket connection after hydration.
 *
 * IMPORTANT: Uses internal Docker URL (SITE_BACKEND) for container-to-container
 * communication during SSR.
 *
 * @returns Block summary data or null if fetch fails
 */
async function fetchInitialBlock(): Promise<BlockSummary | null> {
    try {
        const backendUrl = getServerSideApiUrl();
        const response = await fetch(`${backendUrl}/api/blockchain/latest`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(3000) // 3 second timeout
        });

        if (!response.ok) {
            console.error('Failed to fetch initial block:', response.status);
            return null;
        }

        const data = await response.json();
        return (data.block as BlockSummary) || null;
    } catch (error) {
        console.error('Error fetching initial block:', error);
        return null;
    }
}

/**
 * Fetch user data during SSR to prevent wallet button flash.
 *
 * If user has identity cookie, fetches their data including linked wallets.
 * This allows the wallet button to render correctly on first paint.
 *
 * @returns SSR user data or null if no identity
 */
async function fetchSSRUserData(): Promise<SSRUserData | null> {
  try {
    const userId = await getServerUserId();
    if (!userId) {
      return null;
    }

    const userData = await getServerUser(userId);
    if (!userData) {
      return { userId, wallets: [], isLoggedIn: false };
    }

    return {
      userId,
      wallets: userData.wallets || [],
      isLoggedIn: userData.isLoggedIn ?? false
    };
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Parallelize SSR fetches to reduce TTFB - these are independent operations
  const [runtimeConfig, activeThemes, ssrUserData, initialBlock] = await Promise.all([
    getServerConfig(),
    fetchActiveThemes(),
    fetchSSRUserData(),
    fetchInitialBlock()
  ]);

  // Read theme preference from cookie for SSR (prevents flash)
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get('theme');
  const selectedThemeId = themeCookie?.value || null;

  // Validate that selected theme is actually active
  const isValidTheme =
    typeof selectedThemeId === 'string' &&
    selectedThemeId.trim() !== '' &&
    activeThemes.some(t => t.id === selectedThemeId);
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
        {/* Site-wide structured data for SEO (Organization + WebSite schemas) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(buildSiteStructuredData(runtimeConfig.siteUrl))
          }}
        />
        {/* Inject only the selected theme's CSS for faster first paint.
            Other themes are lazy-loaded by ThemeToggle when user interacts. */}
        {activeThemes
          .filter(theme => theme.id === selectedThemeId)
          .map((theme) => (
            <style
              key={theme.id}
              data-theme-id={theme.id}
              data-theme-name={theme.name}
              dangerouslySetInnerHTML={{ __html: theme.css }}
            />
          ))}
      </head>
      <body>
        <Providers ssrUserData={ssrUserData}>
          <MainHeader initialThemes={activeThemes} initialThemeId={selectedThemeId} />
          <BlockTicker initialBlock={initialBlock} />
          <main>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
