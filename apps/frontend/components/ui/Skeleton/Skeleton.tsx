import type { HTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Skeleton.module.css';

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
 * @example
 * ```tsx
 * <Skeleton style={{ width: '200px', height: '24px' }} />
 * ```
 *
 * @example
 * ```tsx
 * <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
 *   <Skeleton style={{ width: '60%' }} />
 *   <Skeleton style={{ width: '80%' }} />
 *   <Skeleton style={{ width: '40%' }} />
 * </div>
 * ```
 *
 * @param props - Standard HTML div attributes including className and style
 * @returns A div element with animated shimmer loading effect
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn(styles.skeleton, className)} {...props} />;
}
