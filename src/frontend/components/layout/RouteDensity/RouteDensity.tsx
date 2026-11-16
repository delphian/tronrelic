'use client';

/**
 * @fileoverview Apply a page's interface density to its content.
 *
 * The root layout wraps every page in this component. It stamps the density
 * of the current path onto a wrapper, which is what makes every admin page,
 * core or plugin, render compact without each page asking for it.
 *
 * The site header and footer sit outside the wrapper on purpose. They are
 * the same on every page, and resizing them when a visitor moves between a
 * public page and an admin page would make the page frame jump.
 */

import type { ReactNode } from 'react';
import { useRouteDensity } from './useRouteDensity';
import styles from './RouteDensity.module.scss';

/**
 * Wrap page content in an element carrying the current page's density.
 *
 * The wrapper sets `data-density` only when the page has a density of its
 * own. Without the attribute it matches no density rule, so a public page
 * inherits the site-wide density from `<html>` unchanged.
 *
 * @param props - Component props.
 * @param props.children - The page content the density applies to.
 * @returns The page content inside the density wrapper.
 */
export function RouteDensity({ children }: { children: ReactNode }) {
    const density = useRouteDensity();
    return (
        <div className={styles.scope} data-density={density}>
            {children}
        </div>
    );
}
