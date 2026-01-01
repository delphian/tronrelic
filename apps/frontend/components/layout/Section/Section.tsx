import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Section.module.scss';

/**
 * Gap size options for Section component.
 * Maps to semantic tokens for consistent spacing.
 */
type GapSize = 'sm' | 'md' | 'lg';

/**
 * SectionProps interface defines properties for the Section layout component.
 *
 * Extends standard section attributes to support gap sizing.
 * The Section component provides semantic grouping with consistent spacing.
 */
interface SectionProps extends HTMLAttributes<HTMLElement> {
    /**
     * Gap size between section children
     * @default 'md'
     */
    gap?: GapSize;
    /**
     * Section content
     */
    children: ReactNode;
    /**
     * Disables the background image watermark for this section.
     */
    noBackgroundImage?: boolean;
}

/**
 * Maps gap prop values to their corresponding CSS Module class names.
 */
const gapClass: Record<GapSize, string> = {
    sm: styles.section_gap_sm,
    md: styles.section_gap_md,
    lg: styles.section_gap_lg
};

/**
 * Section Component
 *
 * A layout component that provides semantic grouping with consistent
 * gap spacing. Uses the HTML section element for proper document
 * structure and accessibility.
 *
 * Use Section to group related content within a Page. Each Section
 * creates a logical division that can contain headings, grids, cards,
 * or other content.
 *
 * @example
 * ```tsx
 * <Page>
 *   <PageHeader title="Dashboard" />
 *   <Section gap="md">
 *     <Grid columns="responsive">
 *       <Card>Widget 1</Card>
 *       <Card>Widget 2</Card>
 *     </Grid>
 *   </Section>
 *   <Section gap="lg">
 *     <Card>Full-width content</Card>
 *   </Section>
 * </Page>
 * ```
 *
 * @param props - Section component properties
 * @returns A styled section element
 */
export function Section({
    gap = 'md',
    className,
    children,
    noBackgroundImage,
    ...props
}: SectionProps) {
    return (
        <section
            className={cn(
                styles.section,
                gapClass[gap],
                noBackgroundImage && styles.section_no_bg_image,
                className
            )}
            {...props}
        >
            {children}
        </section>
    );
}
