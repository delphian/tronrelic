'use client';

/**
 * @fileoverview The "Privacy choices" link in the site footer.
 *
 * Consent must be as easy to withdraw as to give, so every visitor needs a
 * way back to the choices after the banner is gone. The root layout renders
 * this in the footer on every page, outside any widget an operator could
 * remove, and it shows whenever the consent module's main switch is on —
 * in every region, because a visitor anywhere may opt out.
 *
 * It is a button styled as a link because it opens the choices on the
 * current page rather than navigating anywhere.
 *
 * @module modules/consent/components/PrivacyChoicesButton
 */

import { useTranslation } from '../../../localization/hooks/useTranslation';
import { useConsent } from '../../hooks/useConsent';
import styles from './PrivacyChoicesButton.module.scss';

/**
 * The footer "Privacy choices" button.
 *
 * @returns The button, or null while the main switch is off.
 */
export function PrivacyChoicesButton() {
    const { config, openSettings } = useConsent();
    const { t } = useTranslation();

    return config.enabled ? (
        <div className={styles.row}>
            <button type="button" className={styles.button} onClick={openSettings}>
                {t('consent.footer.privacy_choices', 'Privacy choices')}
            </button>
        </div>
    ) : null;
}
