'use client';

/**
 * @fileoverview The Sign-ups tab of `/system/users`: the site-wide cap on new
 * accounts, the email domain rules, and the report an admin reads to set them.
 *
 * Every panel works from one `ISignupProtectionReport`. Each change answers
 * with a fresh report, which replaces the one held here, so the reading, the
 * rules, and the domain list never disagree after a save. Fetches its data on
 * mount, as every `/system` manager does; the page is admin-only and not
 * public, so the SSR + Live Updates rule does not apply.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ISignupProtectionReport } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Panel } from '../../../../../components/ui/Panel';
import { Button } from '../../../../../components/ui/Button';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { fetchSignupReport } from '../../../api/sign-up-protection.api';
import { SignupCapPanel } from './SignupCapPanel';
import { DomainRulesPanel } from './DomainRulesPanel';
import { SignupActivityPanel } from './SignupActivityPanel';

/**
 * The Sign-ups tab.
 *
 * @returns The tab content.
 */
export function SignupProtectionTab() {
    const [report, setReport] = useState<ISignupProtectionReport | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const { push } = useToast();

    /**
     * Load the report. A failed first load shows a retry panel; a failed
     * reload keeps the report already shown and says so in a toast.
     */
    const load = useCallback(async () => {
        setLoading(true);
        try {
            setReport(await fetchSignupReport());
            setLoadError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLoadError(message);
            push({ tone: 'danger', title: 'Could not load the sign-up report', description: message });
        } finally {
            setLoading(false);
        }
    }, [push]);

    /** Load the report when the tab opens. */
    useEffect(() => {
        void load();
    }, [load]);

    return (
        <Stack gap="md">
            {!report && (
                <Panel
                    title="Sign-ups"
                    actions={loadError && <Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}
                >
                    <p className="text-muted">{loading ? 'Loading the sign-up report…' : `The sign-up report could not be loaded: ${loadError}`}</p>
                </Panel>
            )}
            {report && (
                <>
                    <SignupCapPanel report={report} onReport={setReport} onRefresh={() => void load()} refreshing={loading} />
                    <DomainRulesPanel report={report} onReport={setReport} />
                    <SignupActivityPanel report={report} onReport={setReport} />
                </>
            )}
        </Stack>
    );
}
