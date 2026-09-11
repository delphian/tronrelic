/**
 * IBrandingConfig
 *
 * The public slice of the system configuration that controls how the site looks
 * to visitors, as opposed to how it runs. The backend serves it unauthenticated
 * from `GET /api/config/branding`, and the site header reads it on every server
 * render.
 *
 * Why this is separate from the runtime config:
 * The frontend fetches the runtime config (`/api/config/public`) once and keeps
 * it for the life of the container, which suits URLs that change only on a
 * redeploy. Branding is edited by an administrator from `/system/system` and has
 * to show up on the next page load, so it travels on its own endpoint that is
 * read per request instead.
 */
export interface IBrandingConfig {
    /**
     * Image the header shows in place of its sign-in button, or null to keep the
     * default text button.
     *
     * The value is the opaque URL the files provider returned when an
     * administrator picked the image. It may be root-relative (`/uploads/...`)
     * or absolute, and consumers use it as an `<img src>` exactly as given.
     */
    authButtonImageUrl: string | null;
}
