import { PluginPageWithZones } from '../../../../../components/PluginPageWithZones';
import { runPluginServerDataFetcher } from '../../../../../lib/runPluginServerDataFetcher';
import { getEnabledPluginPageConfig } from '../../../../../lib/serverPluginRegistry';

/**
 * Dynamic route params for plugin admin pages.
 */
interface IPageParams {
    slug: string[];
}

/**
 * Catch-all route for plugin admin pages under /system/plugins/.
 *
 * This route handles plugin admin pages like:
 * - /system/plugins/telegram-bot/settings
 * - /system/plugins/whale-alerts/config
 *
 * Why this exists:
 * Plugin admin pages need to be rendered within the system layout to inherit
 * the SystemNavSSR component (system navigation menu). Without this catch-all
 * route, plugin admin pages would be handled by the root catch-all route at
 * `[...slug]/page.tsx`, which doesn't include the system layout.
 *
 * This route inherits the system layout from `app/(core)/system/layout.tsx`,
 * which provides:
 * - SystemAuthProvider - Authentication state management
 * - SystemAuthGate - Login form and access control
 * - SystemNavSSR - Server-side rendered navigation menu
 *
 * Architecture:
 * 1. User navigates to /system/plugins/telegram-bot/settings
 * 2. Next.js matches this catch-all route (within system layout)
 * 3. The page's serverDataFetcher, if it declares one, runs here so the
 *    component receives `initialData`, exactly as a public plugin page does
 * 4. PluginPageWithZones fetches widgets and wraps with widget zones
 * 5. PluginPageHandler checks plugin registry for matching page
 * 6. Plugin component renders with system navigation and widget zones visible
 *
 * Without step 3 an admin page that relies on server-fetched data, such as
 * the whale-alerts settings form, would always start empty.
 *
 * @param params - Next.js route params containing slug array
 * @returns Plugin page component wrapped in system layout
 */
export default async function PluginAdminPage({ params }: { params: Promise<IPageParams> }) {
    // Reconstruct full path including /system/plugins prefix
    const { slug } = await params;
    const fullSlug = '/system/plugins/' + slug.join('/');

    const pageConfig = await getEnabledPluginPageConfig(fullSlug);
    const initialData = pageConfig ? await runPluginServerDataFetcher(pageConfig, fullSlug) : undefined;

    return <PluginPageWithZones slug={fullSlug} initialData={initialData} />;
}
