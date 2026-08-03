/**
 * Published props contract for the `Skeleton` loading placeholder exposed to
 * plugins on `context.ui.Skeleton`.
 *
 * Why this is declared here rather than beside the component: the shape is
 * part of the platform's public surface, and a hand-written second copy in
 * `IUIComponents` drifted from the implementation without the compiler
 * noticing. `width` and `height` were declared to plugins for long enough
 * that several coded against them, while the component accepted only raw
 * `HTMLAttributes` and silently dropped both — so those skeletons rendered
 * at the stylesheet's default size. Declaring the contract once, and having
 * the component import it, makes that class of divergence impossible.
 */
import type { CSSProperties } from 'react';

/**
 * The `Skeleton` surface published to plugins.
 *
 * Deliberately narrower than what the component accepts. The implementation
 * spreads `HTMLAttributes<HTMLDivElement>`, but plugins are offered only these
 * four props, matching the platform's standing policy of publishing a curated
 * subset so plugin code cannot couple to core's full internal surface — see
 * the narrowing notes in `frontendPluginContext.tsx`. The component's own
 * props extend this interface, so the published subset stays a genuine subset
 * instead of a hand-copied description that drifts.
 */
export interface ISkeletonProps {
    /**
     * Placeholder width. A number is treated as pixels, matching the CSS
     * shorthand callers expect. Supply this instead of a `style` object when
     * width is the only thing being set.
     */
    width?: string | number;

    /**
     * Placeholder height. A number is treated as pixels. Setting this matters
     * more often than width, because a skeleton with no height collapses and
     * defeats the purpose of reserving layout space.
     */
    height?: string | number;

    /** Additional class names, composed with the shimmer styling. */
    className?: string;

    /**
     * Inline styles. An entry here wins over the matching `width`/`height`
     * shortcut, so a caller setting both gets the more specific one.
     */
    style?: CSSProperties;
}
