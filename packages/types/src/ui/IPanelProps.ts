/**
 * Published props contract for the `Panel` section card exposed to plugins on
 * `context.ui.Panel`.
 *
 * Declared here rather than beside the component so core and plugins share one
 * copy of the shape, and the component imports it instead of restating it.
 * See `ISkeletonProps` for why a second hand-written copy is avoided.
 */
import type { ReactNode } from 'react';

/**
 * The `Panel` surface published to plugins.
 *
 * A panel is one titled section drawn as one card: a single header row holding
 * the title, a short line of shared context, and any controls, then the
 * content with no second framed box inside it. It exists because data pages
 * kept wrapping each section in a card and then boxing every figure inside
 * that card again, so the page read as boxes inside boxes and spent most of
 * its area on borders and padding.
 */
export interface IPanelProps {
    /** Section heading, shown at the start of the header row. */
    title: ReactNode;

    /**
     * Heading element used for the title. Defaults to `h2` because a panel
     * usually sits directly under the page's `h1`. Pick a lower level when the
     * panel is nested under another heading, such as inside a slideout or a
     * section that already has its own `h2`, so the document outline stays in
     * order for screen reader users.
     */
    titleAs?: 'h2' | 'h3' | 'h4';

    /**
     * Short context shared by everything in the panel, such as the period
     * covered or the sample size. Shown muted beside the title so it does not
     * have to be repeated in each row.
     */
    meta?: ReactNode;

    /**
     * Controls that act on the panel's content, such as a pager or a measure
     * toggle. Placed at the end of the header row so they do not add a toolbar
     * row above the content.
     */
    actions?: ReactNode;

    /**
     * `muted` for panels that explain rather than report, such as methodology
     * notes at the foot of a page.
     */
    tone?: 'default' | 'muted';

    /**
     * Anchor id, so a link elsewhere on the page (a numbered note marker, for
     * example) can jump to this panel.
     */
    id?: string;

    /** Extra class for layout the caller owns, such as keeping the panel whole inside a multi-column flow. */
    className?: string;

    /** The panel's content. */
    children?: ReactNode;
}
