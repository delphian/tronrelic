import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { getServerConfig, type RuntimeConfig } from '../../lib/serverConfig';
import { getServerSideApiUrl } from '../../lib/api-url';
import { buildMetadata, SITE_NAME } from '../../lib/seo';
import '../globals.scss';
import { Providers } from '../providers';
import { WidgetZone, fetchWidgetsForRoute } from '../../components/widgets';
import { fetchMenuNamespace } from '../../modules/menu/server';
import { getServerSession, type ISSRSession } from '../../modules/user/lib/session-server';
import { DEFAULT_LANGUAGE } from '@/types';
import { fetchLocalizationSeed, resolveMetadataLanguage } from '../../modules/localization/server';
// Imported from the files rather than the module barrel, which also exports
// components with stylesheets and would pull their CSS into the layout bundle.
import { buildLanguageAlternates } from '../../modules/localization/lib/buildLanguageAlternates';

/** Route params of the `[lang]` segment. */
interface ILanguageParams {
    /** Language the middleware routed the request to, e.g. `en` or `zh`. */
    lang: string;
}

/**
 * Turn a language code into the `og:locale` form, which uses an underscore.
 *
 * English keeps the `en_US` the site has always declared.
 *
 * @param language - BCP 47 code, e.g. `pt-BR`.
 * @returns The Open Graph locale, e.g. `pt_BR`.
 */
function toOpenGraphLocale(language: string): string {
  return language === DEFAULT_LANGUAGE ? 'en_US' : language.replace(/-/g, '_');
}

/**
 * Head fragment shape served by the backend `ssr.headFragments` hook.
 *
 * Mirrors `IHeadFragment` from `@/types` without importing the backend
 * types package directly — the frontend keeps this contract local so a
 * single PR can change either side and the type-check pinpoints the
 * mismatch. Keep this in lockstep with `packages/types/src/ssr/IHeadFragment.ts`.
 */
interface IHeadFragmentResponse {
    id: string;
    tag: 'style' | 'link' | 'meta' | 'script';
    attributes?: Record<string, string>;
    content?: string;
}

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
 * Generates dynamic metadata using runtime configuration.
 *
 * Why async function instead of export const:
 * Next.js allows metadata to be generated dynamically at request time using generateMetadata().
 * This enables us to use runtime configuration (fetched from backend) instead of build-time
 * environment variables. The siteUrl is fetched once at container startup and cached,
 * so this function has zero overhead after the first call.
 *
 * @param props - Route props; `params.lang` selects the language described.
 * @returns Metadata object with runtime siteUrl for metadataBase
 */
export async function generateMetadata({ params }: { params: Promise<ILanguageParams> }): Promise<Metadata> {
  const [{ siteUrl }, language] = await Promise.all([getServerConfig(), resolveMetadataLanguage(params)]);

  const rootMetadata = buildMetadata({
    siteUrl,
    language,
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
      locale: toOpenGraphLocale(language)
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
 * Fetch the aggregated `<head>` fragments contributed via the
 * `ssr.headFragments` hook.
 *
 * The endpoint invokes a waterfall over every plugin/module-registered
 * handler with the request path and parsed cookies, so theme styles,
 * structured-data scripts, and any future analytics beacons all flow
 * through one entry point. Returning an empty list on failure keeps
 * page render robust — the seam is additive, not load-bearing for
 * navigation.
 *
 * IMPORTANT: Uses the internal Docker URL (SITE_BACKEND) for
 * container-to-container SSR traffic.
 *
 * @param path - Current request path.
 * @param cookieMap - Parsed cookie map handed to handlers.
 * @returns Ordered list of head fragments, or empty on failure.
 */
async function fetchHeadFragments(
    path: string,
    cookieMap: Record<string, string>
): Promise<IHeadFragmentResponse[]> {
    try {
        const backendUrl = getServerSideApiUrl();
        const response = await fetch(`${backendUrl}/api/ssr/head-fragments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, cookies: cookieMap }),
            cache: 'no-store',
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            console.error('Failed to fetch head fragments:', response.status);
            return [];
        }

        const data = await response.json() as { fragments?: IHeadFragmentResponse[] };
        return data.fragments ?? [];
    } catch (error) {
        console.error('Error fetching head fragments:', error);
        return [];
    }
}

/**
 * Fetch the aggregated root-`<html>` attribute map contributed via the
 * `ssr.htmlAttributes` hook.
 *
 * The endpoint seeds the waterfall with `{ lang: 'en' }` and threads it
 * through every registered handler. Returning the seed on failure keeps
 * page render robust — `lang="en"` is always rendered even if the hook
 * pipeline misbehaves.
 *
 * IMPORTANT: Uses the internal Docker URL (SITE_BACKEND) for
 * container-to-container SSR traffic.
 *
 * @param path - Current request path.
 * @param cookieMap - Parsed cookie map handed to handlers.
 * @returns Attribute map for `<html>`, or `{ lang: 'en' }` on failure.
 */
async function fetchHtmlAttributes(
    path: string,
    cookieMap: Record<string, string>
): Promise<Record<string, string>> {
    const fallback: Record<string, string> = { lang: 'en' };
    try {
        const backendUrl = getServerSideApiUrl();
        const response = await fetch(`${backendUrl}/api/ssr/html-attributes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, cookies: cookieMap }),
            cache: 'no-store',
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            console.error('Failed to fetch html attributes:', response.status);
            return fallback;
        }

        const data = await response.json() as { attributes?: Record<string, string> };
        return data.attributes ?? fallback;
    } catch (error) {
        console.error('Error fetching html attributes:', error);
        return fallback;
    }
}

/**
 * Render a head fragment as the appropriate React element.
 *
 * Theme styles get inlined as `<style>` with the same `data-theme-*`
 * attributes the legacy injector used. Scripts and meta/link tags are
 * rendered structurally — attributes spread, inner content set via
 * `dangerouslySetInnerHTML` for elements that have one.
 *
 * @param fragment - Head fragment from the backend.
 * @returns React element for this fragment.
 */
function renderHeadFragment(fragment: IHeadFragmentResponse): ReactElement {
    const attrs = fragment.attributes ?? {};
    if (fragment.tag === 'style') {
        return (
            <style
                key={fragment.id}
                {...attrs}
                dangerouslySetInnerHTML={{ __html: fragment.content ?? '' }}
            />
        );
    }
    if (fragment.tag === 'script') {
        return (
            <script
                key={fragment.id}
                {...attrs}
                dangerouslySetInnerHTML={{ __html: fragment.content ?? '' }}
            />
        );
    }
    if (fragment.tag === 'link') {
        return <link key={fragment.id} {...attrs} />;
    }

    return <meta key={fragment.id} {...attrs} />;
}

/**
 * Fetch the Better Auth session for SSR.
 *
 * Resolves the session by forwarding the inbound cookies to BA's
 * `/api/auth/get-session` endpoint so logged-in visitors see the
 * logged-in header pill on first paint instead of flashing "Sign in"
 * while the client-side BA hook fetches.
 *
 * @returns Resolved BA session, or null when no session is active.
 */
async function fetchSSRSession(): Promise<ISSRSession | null> {
  try {
    return await getServerSession();
  } catch {
    return null;
  }
}

/**
 * Valid interface density steps, mirroring the `[data-density="…"]` rules
 * in semantic-tokens.scss.
 *
 * TypeScript cannot read the stylesheet and JSX does not type-check
 * hyphenated attributes, so without this union a typo'd step would still
 * match the bare `[data-density]` selector, silently render at density 1,
 * and report nothing. Keep in lockstep with the DENSITY STEPS block in
 * semantic-tokens.scss.
 */
type DensityStep = 'compact' | 'cozy' | 'default' | 'roomy';

/**
 * Site-wide interface density, stamped onto <html> during SSR.
 *
 * Density scales layout spacing (gaps, generic and card padding, page gap)
 * through the --density multiplier in semantic-tokens.scss. It is set here
 * rather than in a client effect so the value is present in the server-rendered
 * HTML — stamping it after hydration would repaint every gap on the page and
 * produce a visible density snap on first load, the same reason data-theme is
 * resolved during SSR.
 *
 * Valid steps: 'compact' (0.75), 'cozy' (0.875), 'default' (1), 'roomy' (1.125).
 */
const SITE_DENSITY: DensityStep = 'default';

/**
 * Root layout for every page, rendered inside the `[lang]` segment so a change
 * of language re-renders it, including the `<html lang>` attribute.
 *
 * @param props - The page subtree and the `[lang]` route params.
 * @returns The document shell.
 */
export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<ILanguageParams> }) {
  // Extract pathname from middleware-set header for the site-host widget zones.
  // For a translated page the middleware sets it to the path without the
  // language prefix, so widgets placed on /markets also appear on /zh/markets.
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '/';

  const { lang } = await params;

  // Cookie map handed to the head-fragments hook so cookie-aware
  // contributors (e.g. locale switchers, A/B markers) can branch on the
  // active session state.
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(
    cookieStore.getAll().map(c => [c.name, c.value])
  );

  // Parallelize SSR fetches to reduce TTFB. Themes flow through the hook
  // pipeline only — the trp-themes plugin contributes <style> fragments
  // via ssr.headFragments and stamps data-theme="active" via
  // ssr.htmlAttributes, so no separate fetchActiveThemes call or cookie
  // branch is needed in this layout.
  //
  // The main menu is fetched here, per visitor, rather than by its widget:
  // the `core:main-menu` widget's data is cached per route and shared by
  // every visitor, while the menu tree is filtered per visitor (admins see
  // the System container). The tree reaches the widget through
  // MenuSeedProvider.
  //
  // The localization seed carries the language the middleware routed this
  // request to. A request it left alone (a missing file under /images/)
  // renders as English here and is turned into a 404 by the (site) layout.
  // The snapshot and catalog inside it come from the Next.js fetch cache, so
  // they cost a backend call about once a minute rather than per request, and
  // the catalog is skipped entirely for English.
  const [runtimeConfig, headFragments, htmlAttributes, ssrSession, widgetBundle, mainMenu, localizationSeed] = await Promise.all([
    getServerConfig(),
    fetchHeadFragments(pathname, cookieMap),
    fetchHtmlAttributes(pathname, cookieMap),
    fetchSSRSession(),
    fetchWidgetsForRoute(pathname, {}),
    fetchMenuNamespace('main', cookieStore.toString()),
    fetchLocalizationSeed(lang)
  ]);

  const { language, direction, config: localizationConfig } = localizationSeed;

  // hreflang links naming every language version of this page. Empty for a
  // page that exists only in English, so those pages render the same head as
  // before localization existed.
  const languageAlternates = buildLanguageAlternates(localizationConfig, pathname, runtimeConfig.siteUrl);

  // A translated page states its own language and direction. English keeps
  // whatever the ssr.htmlAttributes hook produced, which seeds lang="en".
  const languageAttributes: Record<string, string> = language === DEFAULT_LANGUAGE
    ? {}
    : { lang: language, dir: direction };

  return (
    /* data-density is spread first so an ssr.htmlAttributes hook contributor
       can override the site default without this layout knowing about it.
       The language attributes go last: the route decides the language. */
    <html data-density={SITE_DENSITY} {...htmlAttributes} {...languageAttributes}>
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
        {/* Inject every hook-driven head fragment unfiltered — the
            backend hook handlers already scope their contributions
            (theme handler emits only active themes, etc.). */}
        {headFragments.map(renderHeadFragment)}
        {languageAlternates.map(alternate => (
          <link key={alternate.hrefLang} rel="alternate" hrefLang={alternate.hrefLang} href={alternate.href} />
        ))}
      </head>
      <body>
        <Providers ssrSession={ssrSession} ssrMenus={{ main: mainMenu }} ssrLocalization={localizationSeed}>
          {/* The site header is built entirely from widgets an operator places
              in site-top: the Site logo, Main menu, and Sign-in button. The
              zone sits inside <header> so the page keeps its header landmark
              for assistive technology. */}
          <header>
            <WidgetZone name="site-top" widgets={widgetBundle.widgets} layout={widgetBundle.zones['site-top']} route={pathname} params={{}} />
          </header>
          <WidgetZone name="ticker-after" widgets={widgetBundle.widgets} layout={widgetBundle.zones['ticker-after']} route={pathname} params={{}} />
          <main>
            {children}
          </main>
          <footer>
            <WidgetZone name="footer" widgets={widgetBundle.widgets} layout={widgetBundle.zones['footer']} route={pathname} params={{}} />
          </footer>
        </Providers>
      </body>
    </html>
  );
}
