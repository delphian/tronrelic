'use client';

/**
 * @fileoverview The ClickHouse accounts module's own schedule, storage, and
 * logs, shown beside its Accounts panel.
 *
 * Every module that owns a scheduler job or storage has to show them on its
 * admin surface, so an operator diagnosing it does not have to leave for
 * /system/scheduler, /system/database, or /system/logs and pick its rows out of
 * everything else. This module's admin surface is the ClickHouse tab, so they
 * live here, built from the same core components those pages use and scoped
 * to this module.
 */

import { useState } from 'react';
import { Stack } from '../../../../components/layout';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { ClickHouseTableBrowser, CollectionBrowser } from '../../../database';
import { SystemLogsMonitor } from '../../../logs';
import { SchedulerMonitor, type SchedulerJob } from '../../../scheduler';

/** Which record the section shows. */
type RecordView = 'schedule' | 'storage' | 'logs';

const RECORD_OPTIONS: ReadonlyArray<{ id: RecordView; label: string }> = [
    { id: 'schedule', label: 'Schedule' },
    { id: 'storage', label: 'Storage' },
    { id: 'logs', label: 'Logs' }
];

/** Job name prefix shared by every job the module registers; mirrors the backend constant. */
const JOB_PREFIX = 'clickhouse-accounts:';

/** Collection prefix the module's MongoDB collections share. */
const COLLECTION_PREFIX = 'module_clickhouse-accounts_';

/** The module's ClickHouse tables, named exactly, since module tables share no prefix. */
const TABLES = ['clickhouse_account_usage_daily'];

/** Log service name the module's logger records under. */
const LOG_SERVICE = 'tronrelic:clickhouse-accounts';

/**
 * Select the jobs this module registers, by prefix, so a job added later
 * appears without a change here.
 *
 * @param job - One scheduler job.
 * @returns True for `clickhouse-accounts:*` jobs.
 */
const isAccountsJob = (job: SchedulerJob): boolean => job.name.startsWith(JOB_PREFIX);

/**
 * Show the module's schedule, storage, or logs, one at a time.
 *
 * @returns The section body, meant to sit inside a card.
 */
export function AccountsModuleRecords() {
    const [view, setView] = useState<RecordView>('schedule');
    const panelId = 'clickhouse-accounts-records-panel';

    return (
        <Stack gap="md">
            <SegmentedControl
                variant="tablist"
                label="Account records"
                options={RECORD_OPTIONS.map(option => ({ ...option, controls: panelId }))}
                value={view}
                onChange={setView}
            />
            <div id={panelId} role="tabpanel" aria-label={`Account ${view}`}>
                {view === 'schedule' && <SchedulerMonitor jobFilter={isAccountsJob} title="Account usage rollup" hideStats />}
                {view === 'storage' && (
                    <Stack gap="md">
                        {/* Read-only: limits change only through the Accounts panel, which
                          * applies them to ClickHouse and records who changed them. An edit
                          * or delete here would bypass both, and deleting audit entries
                          * would erase the accountability record. */}
                        <CollectionBrowser prefix={COLLECTION_PREFIX} title="Stored limits and changes" allowEdit={false} allowDelete={false} />
                        <ClickHouseTableBrowser tables={TABLES} title="Daily usage" />
                    </Stack>
                )}
                {view === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} title="Account logs" />}
            </div>
        </Stack>
    );
}
