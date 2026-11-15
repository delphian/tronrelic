import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Stack.module.scss';

/**
 * Gap size options for Stack component.
 * Maps to semantic tokens: --stack-gap-sm, --stack-gap-md, --stack-gap-lg
 */
type GapSize = 'sm' | 'md' | 'lg';

/**
 * Direction options for Stack component.
 * Controls whether children are stacked vertically or horizontally.
 */
type Direction = 'vertical' | 'horizontal';

/**
 * StackProps interface defines properties for the Stack layout component.
 *
 * Extends standard div attributes to support gap sizing and direction control.
 * The Stack component provides consistent flex-based spacing between children.
 */
interface StackProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * Gap size between children
     * @default 'md'
     */
    gap?: GapSize;
    /**
     * Stack direction
     * @default 'vertical'
     */
    direction?: Direction;
    /**
     * Let a horizontal stack wrap its children onto further lines when they do
     * not fit, instead of running past its container. Set it on a row of
     * buttons or controls that has to work on a phone. Off by default so a row
     * that relies on staying on one line, such as an icon beside its label,
     * does not change.
     * @default false
     */
    wrap?: boolean;
    /**
     * Stack content
     */
    children: ReactNode;
    /**
     * Disables the background image watermark for this stack.
     */
    noBackgroundImage?: boolean;
}

/**
 * Maps gap prop values to their corresponding CSS Module class names.
 * Ensures type-safe selection of gap variants.
 */
const gapClass: Record<GapSize, string> = {
    sm: styles.stack_gap_sm,
    md: styles.stack_gap_md,
    lg: styles.stack_gap_lg
};

/**
 * Maps direction prop values to their corresponding CSS Module class names.
 */
const directionClass: Record<Direction, string> = {
    vertical: styles.stack_vertical,
    horizontal: styles.stack_horizontal
};

/**
 * Stack Component
 *
 * A layout component that arranges children in a flex container with
 * consistent gap spacing. Supports vertical (column) and horizontal (row)
 * directions with three gap size variants.
 *
 * This component replaces the `.stack` CSS utility class with a type-safe
 * React component following the component-first layout architecture.
 *
 * @example
 * ```tsx
 * <Stack gap="md">
 *   <Card>Item 1</Card>
 *   <Card>Item 2</Card>
 * </Stack>
 * ```
 *
 * @example
 * ```tsx
 * <Stack direction="horizontal" gap="sm">
 *   <Button>Cancel</Button>
 *   <Button variant="primary">Save</Button>
 * </Stack>
 * ```
 *
 * @param props - Stack component properties
 * @returns A styled div element with flex layout
 */
export function Stack({
    gap = 'md',
    direction = 'vertical',
    wrap = false,
    className,
    children,
    noBackgroundImage,
    ...props
}: StackProps) {
    return (
        <div
            className={cn(
                styles.stack,
                gapClass[gap],
                directionClass[direction],
                wrap && styles.stack_wrap,
                noBackgroundImage && styles.stack_no_bg_image,
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}
