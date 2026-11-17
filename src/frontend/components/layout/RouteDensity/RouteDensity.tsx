'use client';

/**
 * @fileoverview Render the page's `<main>` element at the page's density.
 *
 * The root layout renders every page inside this component. It stamps the
 * density of the current path onto `<main>`, which is what makes every admin
 * page, core or plugin, render compact without each page asking for it.
 *
 * The attribute sits on `<main>` itself, not on a wrapper inside it, because
 * `<main>` declares the page gutter (`--main-padding-*` in globals.scss). A
 * density token is resolved on the element that uses it, so a gutter set on
 * an element outside the density region kept the public page's width, and
 * an admin page on a phone gave 48 of its 390px to side padding.
 *
 * The site header and footer sit outside `<main>` on purpose. They are the
 * same on every page, and resizing them when a visitor moves between a
 * public page and an admin page would make the page frame jump.
 */

import type { ReactNode } from 'react';
import { useRouteDensity } from './useRouteDensity';

/**
 * Render the page content inside a `<main>` element carrying the current
 * page's density.
 *
 * `data-density` is set only when the page has a density of its own.
 * Without the attribute `<main>` matches no density rule, so a public page
 * inherits the site-wide density from `<html>` unchanged.
 *
 * @param props - Component props.
 * @param props.children - The page content the density applies to.
 * @returns The page's `<main>` element.
 */
export function RouteDensity({ children }: { children: ReactNode }) {
    const density = useRouteDensity();
    return (
        <main data-density={density}>
            {children}
        </main>
    );
}
