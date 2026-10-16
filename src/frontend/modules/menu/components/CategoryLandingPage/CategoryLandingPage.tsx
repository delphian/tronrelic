/**
 * @fileoverview Auto-generated category landing page for menu container nodes.
 *
 * Server component that renders a card grid of child menu items with icon,
 * title, and description. Receives SSR-fetched data as props from the
 * catch-all route so the page renders immediately without loading spinners.
 * Used by every container node in the menu system unless a plugin or custom
 * page claims the URL.
 *
 * Labels and descriptions are operator-written English, so every one renders
 * through the translator the route hands in. The keys are the same ones the
 * navigation uses for a label (see `menuTranslationKey`), so translating a
 * menu item once covers both its link in the menu and its card here.
 */

import Link from 'next/link';
import type { ITranslator } from '@/types';
import { Page, PageHeader, Grid } from '../../../../components/layout';
import { menuTranslationKey } from '../../lib/menuTranslationKey';
import { resolveIcon } from './iconResolver';
import styles from './CategoryLandingPage.module.scss';

/**
 * Serializable menu node data passed from the server component.
 */
interface ICategoryNode {
    label: string;
    description?: string;
    /** The container's own URL, which identifies its translation keys. */
    url: string;
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
    /** Menu namespace the container belongs to, which scopes its translation keys. */
    namespace: string;
    /**
     * Translator for the page's language. Passed in because this is a server
     * component and cannot call `useTranslation`; the route builds it with
     * `getServerTranslator`.
     */
    t: ITranslator['t'];
    /**
     * Rewrites a stored, unprefixed link for the page's language, so a card
     * on a translated page leads to the translated page where one exists.
     * Passed in for the same reason as `t`; the route builds it with
     * `localizeHref` from the request's localization seed.
     */
    localizeHref: (href: string) => string;
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
 * @param props.namespace - Menu namespace used to build each item's translation keys
 * @param props.t - Translator for the page's language
 * @param props.localizeHref - Link rewriter for the page's language
 */
export function CategoryLandingPage({ node, items, namespace, t, localizeHref }: ICategoryLandingPageProps) {
    return (
        <Page>
            <PageHeader
                title={t(menuTranslationKey(namespace, node), node.label)}
                subtitle={node.description
                    ? t(menuTranslationKey(namespace, node, 'description'), node.description)
                    : undefined}
            />
            <Grid columns="responsive" gap="md">
                {items.map(item => {
                    const IconComponent = item.icon ? resolveIcon(item.icon) : undefined;

                    return (
                        <Link key={item.url} href={localizeHref(item.url)} className={styles.card}>
                            {IconComponent && (
                                <div className={styles.card__icon}>
                                    <IconComponent size={24} />
                                </div>
                            )}
                            <h3 className={styles.card__title}>{t(menuTranslationKey(namespace, item), item.label)}</h3>
                            {item.description && (
                                <p className={styles.card__description}>
                                    {t(menuTranslationKey(namespace, item, 'description'), item.description)}
                                </p>
                            )}
                        </Link>
                    );
                })}
            </Grid>
        </Page>
    );
}
