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
     * Page title text
     */
    title: string;
    /**
     * Optional subtitle/description text
     */
    subtitle?: string;
    /**
     * Optional additional content (badges, buttons, etc.)
     */
    children?: ReactNode;
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
export function PageHeader({ title, subtitle, children, className, ...props }: PageHeaderProps) {
    return (
        <section className={cn(styles.page_header, className)} {...props}>
            <div className={styles.title_row}>
                <h1 className={styles.title}>{title}</h1>
                {children}
            </div>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </section>
    );
}
