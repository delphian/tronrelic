'use client';

/**
 * @fileoverview One ClickHouse account on the admin page: who it is for, its
 * state, what it may read, and its Limits, Activity, Queries, and Changes
 * views.
 *
 * A managed account gets all four views and an Apply again action. An
 * observed account, such as the one the chain writer uses, gets Activity and
 * Queries only: it has no limits to show or change, and its queries cannot be
 * stopped from here, because stopping a chain insert would leave a gap.
 */

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ClickHouseAccountState, IClickHouseAccountSummary } from '@/types';
import { Stack } from '../../../../components/layout';
import { Badge, type BadgeTone } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { useToast } from '../../../../components/ui/ToastProvider';
import { applyClickHouseAccount } from '../../api/client';
import { ActivityView } from '../ActivityView/ActivityView';
import { ChangesView } from '../ChangesView/ChangesView';
import { LimitsView } from '../LimitsView/LimitsView';
import { QueriesView } from '../QueriesView/QueriesView';
import styles from './AccountSection.module.scss';

/** The views an account section can show. */
type AccountView = 'limits' | 'activity' | 'queries' | 'changes';

/** Badge tone and wording for each account state. */
const STATE_BADGE: Record<ClickHouseAccountState, { tone: BadgeTone; label: string }> = {
    active: { tone: 'success', label: 'Active' },
    pending: { tone: 'warning', label: 'Not applied yet' },
    error: { tone: 'danger', label: 'Apply failed' },
    observed: { tone: 'neutral', label: 'Observed only' }
};

/**
 * Props for one account section.
 */
interface IAccountSectionProps {
    /** The account to show. */
    account: IClickHouseAccountSummary;
    /** Called with a fresh summary after a save or apply, so the panel replaces its copy. */
    onUpdated: (account: IClickHouseAccountSummary) => void;
}

/**
 * List the grants ClickHouse reports that differ from the declared ones.
 *
 * Grants are declared in code as `database.*` or `database.table`, and read
 * back from ClickHouse as rows. A difference means someone granted or revoked
 * something by hand, which Apply again reverses.
 *
 * @param account - A managed account's summary.
 * @returns The server's `SELECT` grants in the declared form when they differ
 *   from the declaration, or null when they match or were not read.
 */
function grantDrift(account: IClickHouseAccountSummary): string[] | null {
    let drift: string[] | null = null;
    if (account.managed && account.state === 'active' && account.effectiveGrants.length > 0) {
        const reported = account.effectiveGrants
            .map(grant => grant.accessType === 'SELECT'
                ? `${grant.database ?? '*'}.${grant.table ?? '*'}`
                : `${grant.accessType} on ${grant.database ?? '*'}.${grant.table ?? '*'}`)
            .sort();
        const declared = [...account.declaredGrants].sort();
        if (reported.join('|') !== declared.join('|')) {
            drift = reported;
        }
    }

    return drift;
}

/**
 * Show one account with its header and views.
 *
 * @param props - The account and the update callback.
 * @returns The account's section.
 */
export function AccountSection({ account, onUpdated }: IAccountSectionProps) {
    const { push } = useToast();
    const [view, setView] = useState<AccountView>(account.managed ? 'limits' : 'activity');
    const [applying, setApplying] = useState(false);
    const [changesKey, setChangesKey] = useState(0);
    const badge = STATE_BADGE[account.state];
    const drift = grantDrift(account);
    const viewOptions: ReadonlyArray<{ id: AccountView; label: string }> = account.managed
        ? [
            { id: 'limits', label: 'Limits' },
            { id: 'activity', label: 'Activity' },
            { id: 'queries', label: 'Queries' },
            { id: 'changes', label: 'Changes' }
        ]
        : [
            { id: 'activity', label: 'Activity' },
            { id: 'queries', label: 'Queries' }
        ];

    /**
     * Apply the account to ClickHouse again and report the outcome. The
     * server answers with the account's state either way, so a failed apply
     * shows its error in the section rather than only in a toast.
     */
    const handleApply = async () => {
        setApplying(true);
        try {
            const updated = await applyClickHouseAccount(account.id);
            onUpdated(updated);
            setChangesKey(key => key + 1);
            push(updated.state === 'active'
                ? { tone: 'success', title: 'Account applied', description: `${account.label} matches its settings on ClickHouse.` }
                : { tone: 'danger', title: 'Account not applied', description: updated.error ?? 'ClickHouse refused the account.' });
        } catch (err) {
            push({ tone: 'danger', title: 'Account not applied', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setApplying(false);
        }
    };

    /**
     * Take a saved summary from the Limits view and reload the Changes list,
     * so the admin's own change is there when they open it.
     *
     * @param updated - The summary after the save.
     */
    const handleLimitsSaved = (updated: IClickHouseAccountSummary) => {
        onUpdated(updated);
        setChangesKey(key => key + 1);
    };

    const panelId = `${account.id}-account-panel`;

    return (
        <section className={styles.section} aria-labelledby={`${account.id}-account-title`}>
            <div className={styles.header}>
                <div className={styles.identity}>
                    <h4 id={`${account.id}-account-title`} className={styles.title}>{account.label}</h4>
                    <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                    <code className={styles.user}>{account.clickhouseUser}</code>
                </div>
                {account.managed && (
                    <Button
                        variant="secondary"
                        size="sm"
                        icon={<RefreshCw size={14} aria-hidden="true" />}
                        loading={applying}
                        onClick={() => void handleApply()}
                    >
                        Apply again
                    </Button>
                )}
            </div>

            <p className={styles.description}>{account.description}</p>

            <dl className={styles.facts}>
                <div className={styles.fact}>
                    <dt>Can read</dt>
                    <dd>
                        {account.managed
                            ? account.declaredGrants.map(grant => <code key={grant} className={styles.grant}>{grant}</code>)
                            : 'Everything the server grants it'}
                    </dd>
                </div>
                {account.appliedAt && (
                    <div className={styles.fact}>
                        <dt>Applied</dt>
                        <dd><ClientTime date={account.appliedAt} format="relative" /></dd>
                    </div>
                )}
            </dl>

            {account.state === 'error' && account.error && (
                <p className="alert" role="alert">
                    ClickHouse refused this account, so nothing can connect as it: {account.error}. Fix the cause, then apply it again.
                </p>
            )}
            {drift && (
                <p className="alert" role="status">
                    ClickHouse reports different grants from the ones set in code: {drift.join(', ')}. Apply again to restore them.
                </p>
            )}

            <Stack gap="md">
                <SegmentedControl
                    variant="tablist"
                    label={`${account.label} views`}
                    options={viewOptions.map(option => ({ ...option, controls: panelId }))}
                    value={view}
                    onChange={setView}
                />
                <div id={panelId} role="tabpanel" aria-label={`${account.label} ${view}`}>
                    {view === 'limits' && account.managed && <LimitsView account={account} onUpdated={handleLimitsSaved} />}
                    {view === 'activity' && <ActivityView accountId={account.id} managed={account.managed} />}
                    {view === 'queries' && <QueriesView accountId={account.id} accountLabel={account.label} canKill={account.managed} />}
                    {view === 'changes' && account.managed && <ChangesView accountId={account.id} refreshKey={changesKey} />}
                </div>
            </Stack>
        </section>
    );
}
