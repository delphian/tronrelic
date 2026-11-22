/**
 * @fileoverview The stake calculator as a whole page, with its heading.
 *
 * The fixed `/tools/stake-calculator` route renders this when no CMS page is
 * served at that address in the visitor's language: before a curator approves
 * the proposed page, and in any language the page has no published
 * translation into. The form itself lives in `StakeCalculatorForm`, which the
 * CMS page embeds as a widget.
 */
'use client';

import { Page, PageHeader } from '../../../../components/layout';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { StakeCalculatorForm } from './StakeCalculatorForm';

/**
 * Stake calculator page with its translated title and subtitle above the form.
 */
export function StakeCalculator() {
    const { t } = useTranslation();

    return (
        <Page>
            <PageHeader
                title={t('tools.stakeCalculator.title', 'Stake Calculator')}
                subtitle={t('tools.stakeCalculator.subtitle', 'Calculate energy from TRX or TRX from energy using live network parameters')}
            />
            <StakeCalculatorForm />
        </Page>
    );
}
