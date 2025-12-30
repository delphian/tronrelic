import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Grid.module.scss';

/**
 * Gap size options for Grid component.
 * Maps to semantic tokens: --grid-gap-sm, --grid-gap-md, --grid-gap-lg
 */
type GapSize = 'sm' | 'md' | 'lg';

/**
 * Column configuration options for Grid component.
 * - Number: Fixed column count (2 or 3)
 * - 'responsive': Auto-fit with minmax for responsive layouts
 */
type Columns = 2 | 3 | 'responsive';

/**
 * GridProps interface defines properties for the Grid layout component.
 *
 * Extends standard div attributes to support column configuration and gap sizing.
 * The Grid component provides consistent CSS Grid layout patterns.
 */
interface GridProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * Gap size between grid items
     * @default 'md'
     */
    gap?: GapSize;
    /**
     * Column configuration
     * @default 'responsive'
     */
    columns?: Columns;
    /**
     * Grid content
     */
    children: ReactNode;
}

/**
 * Maps gap prop values to their corresponding CSS Module class names.
 */
const gapClass: Record<GapSize, string> = {
    sm: styles.grid_gap_sm,
    md: styles.grid_gap_md,
    lg: styles.grid_gap_lg
};

/**
 * Maps columns prop values to their corresponding CSS Module class names.
 */
const columnsClass: Record<Columns, string> = {
    2: styles.grid_cols_2,
    3: styles.grid_cols_3,
    responsive: styles.grid_responsive
};

/**
 * Grid Component
 *
 * A layout component that arranges children in a CSS Grid with consistent
 * gap spacing. Supports fixed column counts (2 or 3) and responsive
 * auto-fit layouts.
 *
 * This component replaces the `.grid`, `.grid--cols-2`, `.grid--cols-3`,
 * and `.grid--responsive` CSS utility classes with a type-safe React component.
 *
 * @example
 * ```tsx
 * <Grid columns="responsive" gap="md">
 *   <Card>Item 1</Card>
 *   <Card>Item 2</Card>
 *   <Card>Item 3</Card>
 * </Grid>
 * ```
 *
 * @example
 * ```tsx
 * <Grid columns={2} gap="lg">
 *   <Card>Left</Card>
 *   <Card>Right</Card>
 * </Grid>
 * ```
 *
 * @param props - Grid component properties
 * @returns A styled div element with grid layout
 */
export function Grid({
    gap = 'md',
    columns = 'responsive',
    className,
    children,
    ...props
}: GridProps) {
    return (
        <div
            className={cn(
                styles.grid,
                gapClass[gap],
                columnsClass[columns],
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}
