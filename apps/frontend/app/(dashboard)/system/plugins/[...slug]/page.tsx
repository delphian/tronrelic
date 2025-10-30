import { PluginPageHandler } from '../../../../../components/PluginPageHandler';

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
 * This route inherits the system layout from `app/(dashboard)/system/layout.tsx`,
 * which provides:
 * - SystemAuthProvider - Authentication state management
 * - SystemAuthGate - Login form and access control
 * - SystemNavSSR - Server-side rendered navigation menu
 *
 * Architecture:
 * 1. User navigates to /system/plugins/telegram-bot/settings
 * 2. Next.js matches this catch-all route (within system layout)
 * 3. PluginPageHandler checks plugin registry for matching page
 * 4. Plugin component renders with system navigation visible
 *
 * @param params - Next.js route params containing slug array
 * @returns Plugin page component wrapped in system layout
 */
export default function PluginAdminPage({ params }: { params: IPageParams }) {
    // Reconstruct full path including /system/plugins prefix
    const slug = '/system/plugins/' + params.slug.join('/');

    return <PluginPageHandler slug={slug} />;
}
