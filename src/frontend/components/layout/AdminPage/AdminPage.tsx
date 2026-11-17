/**
 * @fileoverview The shell every admin page renders in.
 *
 * An admin page is a header, usually a tab row, and the active panel. Pages
 * that placed those parts directly in `<Page>` were spaced by the page gap,
 * which is meant for separating page sections, so their header sat 36px from
 * its own tabs while pages that wrapped the parts in a `<Stack>` used 12px.
 * This shell holds the header and the children in one stack, so every admin
 * page, core or plugin, joins its header to its tabs the same way. Plugins
 * receive it as `context.layout.AdminPage`.
 */

import type { IAdminPageProps } from '@/types';
import { Page } from '../Page';
import { PageHeader } from '../PageHeader';
import { Stack } from '../Stack';

/**
 * Render an admin page's header and then its content, one stack gap apart.
 *
 * @param props - The page title and subtitle, any controls placed beside the
 *   title, and the content under the header, as described on `IAdminPageProps`.
 * @returns The page.
 */
export function AdminPage({ title, subtitle, actions, children }: IAdminPageProps) {
    return (
        <Page>
            <Stack gap="md">
                <PageHeader title={title} subtitle={subtitle}>
                    {actions}
                </PageHeader>
                {children}
            </Stack>
        </Page>
    );
}
