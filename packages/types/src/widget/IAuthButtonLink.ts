/**
 * @fileoverview One operator-configured link in the sign-in button's
 * slide-out tray.
 *
 * The backend `core:auth-button` data fetcher emits these in its SSR payload,
 * and the frontend tray renders them. They are declared here so the two sides
 * share one shape instead of each keeping a copy that can drift.
 */

/**
 * A link shown in the tray that slides out of the sign-in / profile button.
 *
 * The tray payload is the same for every visitor, because widget data is
 * cached per route with nothing about the visitor in the key. `audience` is
 * therefore applied in the browser against the visitor's own session, which
 * the root layout already resolved during server rendering.
 */
export interface IAuthButtonLink {
    /** lucide-react icon name drawn beside the label, such as `Wallet`. */
    icon: string;
    /** Visible text of the link. */
    label: string;
    /** Destination: a root-relative path such as `/profile`, or an absolute http(s) URL. */
    url: string;
    /** Which visitors see the link: everyone, only signed-in visitors, or only signed-out visitors. */
    audience: 'everyone' | 'signed-in' | 'signed-out';
}
