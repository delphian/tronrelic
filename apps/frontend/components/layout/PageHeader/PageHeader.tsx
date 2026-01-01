import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import styles from './PageHeader.module.scss';

/**
 * PageHeaderProps interface defines properties for the PageHeader layout component.
 *
 * Provides a consistent page header with title and optional subtitle.
 * Supports children for additional elements like badges or action buttons.
 */
interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
    /**
     * Page title - can be string or ReactNode (e.g., for skeleton loading states)
     */
    title: ReactNode;
    /**
     * Optional subtitle/description - can be string or ReactNode
     */
    subtitle?: ReactNode;
    /**
     * Optional additional content (badges, buttons, etc.)
     */
    children?: ReactNode;
    /**
     * Disables the background image watermark for this header.
     */
    noBackgroundImage?: boolean;
}

/**
 * PageHeader Component
 *
 * A layout component that provides consistent page header structure with
 * title, optional subtitle, and optional children for additional elements.
 *
 * This component replaces the `.page-header`, `.page-title`, and `.page-subtitle`
 * CSS utility classes with a type-safe React component.
 *
 * @example
 * ```tsx
 * <PageHeader title="Dashboard" subtitle="Overview of activity" />
 * ```
 *
 * @example
 * ```tsx
 * <PageHeader title="Users">
 *   <Badge tone="success">12 active</Badge>
 * </PageHeader>
 * ```
 *
 * @param props - PageHeader component properties
 * @returns A styled section element with page header
 */
export function PageHeader({ title, subtitle, children, className, noBackgroundImage, ...props }: PageHeaderProps) {
    // Determine if title is a string (for h1) or ReactNode (for div wrapper like skeletons)
    const titleElement = typeof title === 'string'
        ? <h1 className={styles.title}>{title}</h1>
        : <div className={styles.title}>{title}</div>;

    // Determine if subtitle is a string (for p) or ReactNode (for div wrapper like skeletons)
    const subtitleElement = subtitle
        ? typeof subtitle === 'string'
            ? <p className={styles.subtitle}>{subtitle}</p>
            : <div className={styles.subtitle}>{subtitle}</div>
        : null;

    return (
        <section
            className={cn(
                styles.page_header,
                noBackgroundImage && styles.page_header_no_bg_image,
                className
            )}
            {...props}
        >
            <div className={styles.title_row}>
                {titleElement}
                {children}
            </div>
            {subtitleElement}
        </section>
    );
}
