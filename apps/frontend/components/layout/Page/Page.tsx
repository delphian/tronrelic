import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Page.module.scss';

/**
 * PageProps interface defines properties for the Page layout component.
 *
 * Extends standard div attributes to support children and className passthrough.
 * The Page component provides consistent page-level grid layout with responsive
 * gap that reduces on mobile viewports.
 */
interface PageProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * Page content
     */
    children: ReactNode;
}

/**
 * Page Component
 *
 * A layout component that provides consistent page-level structure with
 * responsive gap spacing. Uses CSS grid to stack children vertically with
 * appropriate spacing that automatically reduces on mobile viewports.
 *
 * This component replaces the `.page` CSS utility class with a type-safe
 * React component following the component-first layout architecture.
 *
 * @example
 * ```tsx
 * <Page>
 *   <PageHeader title="Dashboard" subtitle="Overview" />
 *   <Card>Content</Card>
 * </Page>
 * ```
 *
 * @param props - Page component properties
 * @returns A styled div element with page layout
 */
export function Page({ className, children, ...props }: PageProps) {
    return (
        <div className={cn(styles.page, className)} {...props}>
            {children}
        </div>
    );
}
