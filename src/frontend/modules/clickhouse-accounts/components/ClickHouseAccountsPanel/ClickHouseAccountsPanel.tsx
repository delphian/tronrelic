'use client';

/**
 * @fileoverview The Accounts panel on the ClickHouse tab of /system/system:
 * every declared ClickHouse account, one section each.
 *
 * Accounts are declared in code, so there is no "add account" control here.
 * An admin tunes a managed account's limits, applies it again, watches its
 * activity and queries, and reads who changed what. The list loads when the
 * ClickHouse tab opens, as every panel on that page does, since the page only
 * mounts a tab's panels while the tab is selected.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { IClickHouseAccountSummary } from '@/types';
import { Stack } from '../../../../components/layout';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { listClickHouseAccounts } from '../../api/client';
import { AccountSection } from '../AccountSection/AccountSection';
import styles from './ClickHouseAccountsPanel.module.scss';

/**
 * Load and show every declared ClickHouse account.
 *
 * @returns The Accounts panel body, meant to sit inside a card.
 */
export function ClickHouseAccountsPanel() {
    const [accounts, setAccounts] = useState<IClickHouseAccountSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    /**
     * Load the account list.
     */
    const load = useCallback(async () => {
        try {
            setAccounts(await listClickHouseAccounts());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Replace one account in the list with a fresh summary after a save or
     * apply, leaving the others as they are.
     *
     * @param updated - The account's new summary.
     */
    const handleUpdated = useCallback((updated: IClickHouseAccountSummary) => {
        setAccounts(current => current?.map(account => (account.id === updated.id ? updated : account)) ?? current);
    }, []);

    return (
        <Stack gap="md">
            <div className={styles.intro}>
                <h3 className={styles.title}>Accounts</h3>
                <p className={styles.lede}>
                    Each account is a ClickHouse user whose limits ClickHouse itself enforces. Accounts and what they can
                    read are set in code; limits can be tuned here up to the ceiling code allows, and every change is recorded.
                </p>
            </div>

            {error && <p className="alert" role="alert">{error}</p>}
            {accounts === null && !error && <Skeleton className={styles.placeholder} />}

            {accounts?.map((account, index) => (
                <Fragment key={account.id}>
                    {index > 0 && <hr className={styles.divider} />}
                    <AccountSection account={account} onUpdated={handleUpdated} />
                </Fragment>
            ))}
        </Stack>
    );
}
