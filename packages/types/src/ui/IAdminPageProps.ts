/**
 * Published props contract for the `AdminPage` shell exposed to plugins on
 * `context.layout.AdminPage`.
 *
 * Declared here rather than beside the component so core and plugins share one
 * copy of the shape, and the component imports it instead of restating it.
 * See `ISkeletonProps` for why a second hand-written copy is avoided.
 */
import type { ReactNode } from 'react';

/**
 * The `AdminPage` surface published to plugins.
 *
 * An admin page is a header, usually a tab row, and the active panel. The
 * shell renders the header and then the children one stack gap apart, so
 * every admin page joins its header to its own tabs the same way. Pages that
 * placed these parts directly in `Page` were spaced by the page gap instead,
 * which is meant for separating page sections, so some admin pages left 36px
 * between the header, the tab row, and the panel while others left 12px.
 */
export interface IAdminPageProps {
    /** Page title, rendered as the page's `h1` when it is a string. */
    title: ReactNode;

    /**
     * One line saying what the page is for. Shown under the title in
     * secondary text on an admin page.
     */
    subtitle?: ReactNode;

    /**
     * Small controls or status placed beside the title, such as a badge
     * counting what the page manages. Put anything larger in the children.
     */
    actions?: ReactNode;

    /**
     * Everything under the header, in order: usually the tab row and the
     * active panel, with any summary the page shows above its tabs. Each
     * child is one stack gap from the next, so wrap a group of panels that
     * should sit closer or further apart in a `Stack` of its own.
     */
    children: ReactNode;
}
