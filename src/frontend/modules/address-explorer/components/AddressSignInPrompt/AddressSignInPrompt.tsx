'use client';

/**
 * @fileoverview What a signed-out visitor sees in place of the address's activity.
 *
 * The prompt sits inline, under the page header, rather than opening the
 * sign-in dialog by itself. A dialog opened on arrival would cover the
 * Tronscan link in the header, which is meant to work without an account, and
 * closing it would leave an empty page. The button opens the site's shared
 * sign-in dialog; once sign-in succeeds the dialog refreshes the route, the
 * server renders the activity, and this prompt is replaced.
 */

import { LogIn } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { Panel } from '../../../../components/ui/Panel';
import { useSignInDialog } from '../../../user';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import styles from './AddressSignInPrompt.module.scss';

/**
 * Render the sign-in prompt for the address page.
 *
 * @returns A panel explaining what signing in shows, with a button that opens the sign-in dialog.
 */
export function AddressSignInPrompt() {
    const { t } = useTranslation();
    const openSignInDialog = useSignInDialog();
    const message = t(
        'addressExplorer.signIn.dialogMessage',
        'Address activity is available to signed-in accounts. Sign in or create a free account to continue.'
    );
    return (
        <Panel title={t('addressExplorer.signIn.title', 'Sign in to see this address\'s activity')} titleAs="h2">
            <div className={styles.prompt}>
                <p className={styles.text}>
                    {t(
                        'addressExplorer.signIn.body',
                        'Signed-in accounts can see this address\'s totals, counterparties, transfers, energy and bandwidth delegations, and permission changes from the last 21 days.'
                    )}
                </p>
                <Button variant="primary" icon={<LogIn size={18} />} onClick={() => openSignInDialog({ message })}>
                    {t('addressExplorer.signIn.button', 'Sign in')}
                </Button>
            </div>
        </Panel>
    );
}
