import type { HTMLAttributes } from 'react';
import type { ISkeletonProps } from '@/types';
import { cn } from '../../../lib/cn';
import styles from './Skeleton.module.css';

/**
 * Everything the component accepts: the four props published to plugins, plus
 * the full set of div attributes that core call sites rely on.
 *
 * Splitting it this way keeps the published contract narrow — plugins get the
 * curated surface, not core's whole internal API — while guaranteeing that the
 * published subset really is a subset. Restating the shared props here instead
 * of extending {@link ISkeletonProps} is what let `width` and `height` be
 * advertised to plugins and silently ignored at runtime.
 */
interface SkeletonProps extends HTMLAttributes<HTMLDivElement>, ISkeletonProps {}

/**
 * Skeleton Component
 *
 * A loading placeholder component that displays an animated shimmer effect while
 * content is being fetched or processed. Used to improve perceived performance by
 * showing users that content is loading rather than displaying blank space.
 *
 * The skeleton automatically adapts to its container width and can be customized
 * with standard HTML div attributes including custom classNames for height, width,
 * and border-radius overrides.
 *
 * Dimensions can be given either as the `width`/`height` shortcuts or through
 * `style`. Both exist because the shortcuts read better for the common
 * single-bar case, while `style` remains available for callers setting several
 * properties at once. An explicit `style` entry wins over the matching
 * shortcut, so a caller passing both gets the more specific one.
 *
 * The props plugins may use come from the published {@link ISkeletonProps},
 * which this component's own props extend. The `width`/`height` shortcuts were
 * previously advertised to plugins while the component accepted only raw
 * `HTMLAttributes`, so plugin callers typechecked green and had both props
 * silently dropped — their skeletons collapsed to the stylesheet default.
 *
 * @example
 * ```tsx
 * <Skeleton height="1.6em" />
 * <Skeleton style={{ width: '60%', height: '24px' }} />
 * ```
 *
 * @param props - Standard HTML div attributes plus the width/height shortcuts
 * @returns A div element with animated shimmer loading effect
 */
export function Skeleton({ className, width, height, style, ...props }: SkeletonProps) {
    const dimensions = {
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...style
    };

    return <div className={cn(styles.skeleton, className)} style={dimensions} {...props} />;
}
