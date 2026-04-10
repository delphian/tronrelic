/**
 * @fileoverview Auto-generated category landing page for menu container nodes.
 *
 * Server component that renders a card grid of child menu items with icon,
 * title, and description. Receives SSR-fetched data as props from the
 * catch-all route so the page renders immediately without loading spinners.
 * Used by every container node in the menu system unless a plugin or custom
 * page claims the URL.
 */

import Link from 'next/link';
import { Page, PageHeader, Grid } from '../../../../components/layout';
import { resolveIcon } from './iconResolver';
import styles from './CategoryLandingPage.module.scss';

/**
 * Serializable menu node data passed from the server component.
 */
interface ICategoryNode {
    label: string;
    description?: string;
}

/**
 * Serializable child menu item data passed from the server component.
 */
interface ICategoryChild {
    _id?: string;
    label: string;
    description?: string;
    url: string;
    icon?: string;
}

/**
 * Props for CategoryLandingPage.
 */
interface ICategoryLandingPageProps {
    /** The parent container node with label and description. */
    node: ICategoryNode;
    /** Direct children of the container, sorted by order. */
    items: ICategoryChild[];
}

/**
 * Auto-generated category landing page component.
 *
 * Displays a responsive grid of cards linking to each child menu item.
 * Each card shows the item's lucide-react icon, title, and description.
 * Follows the SSR + Live Updates pattern: data arrives as props from
 * the server component in the catch-all route.
 *
 * @param props.node - Parent container node providing page title and subtitle
 * @param props.items - Child menu items to render as linked cards
 */
export function CategoryLandingPage({ node, items }: ICategoryLandingPageProps) {
    return (
        <Page>
            <PageHeader
                title={node.label}
                subtitle={node.description}
            />
            <Grid columns="responsive" gap="md">
                {items.map(item => {
                    const IconComponent = item.icon ? resolveIcon(item.icon) : undefined;

                    return (
                        <Link key={item.url} href={item.url} className={styles.card}>
                            {IconComponent && (
                                <div className={styles.card__icon}>
                                    <IconComponent size={24} />
                                </div>
                            )}
                            <h3 className={styles.card__title}>{item.label}</h3>
                            {item.description && (
                                <p className={styles.card__description}>{item.description}</p>
                            )}
                        </Link>
                    );
                })}
            </Grid>
        </Page>
    );
}
