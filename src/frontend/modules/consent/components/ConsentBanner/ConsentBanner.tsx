'use client';

/**
 * @fileoverview The cookie consent banner and the detailed choices behind
 * "Privacy choices".
 *
 * Shown to a visitor in the EEA, the UK, or Switzerland who has not answered
 * the current version of the request, and to any visitor who opens "Privacy
 * choices" from the footer. It sits at the bottom of the screen without
 * blocking the page, because EU rules require consent to be freely given and
 * a page hidden behind the banner would pressure the visitor into accepting.
 *
 * "Accept all" and "Reject all" are the same size and style on the first
 * screen. European regulators require refusing to be as easy as accepting,
 * and a smaller or greyed-out reject button is the most common reason a
 * banner is found unlawful.
 *
 * Rendered from the server-resolved seed, so a visitor who must answer sees
 * the banner in the server HTML and the first browser render matches it.
 *
 * @module modules/consent/components/ConsentBanner
 */

import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { IconButton } from '../../../../components/ui/IconButton';
import { Switch } from '../../../../components/ui/Switch';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { useLocalizedHref } from '../../../localization/hooks/useLocalizedHref';
import { useConsent } from '../../hooks/useConsent';
import styles from './ConsentBanner.module.scss';

/** The site's Privacy Policy, which the banner links to for the full detail. */
const PRIVACY_POLICY_PATH = '/privacy';

/**
 * The consent banner.
 *
 * @returns The banner, or null when the visitor has nothing to answer.
 */
export function ConsentBanner() {
    const { config, state, settingsOpen, closeSettings, save } = useConsent();
    const { t } = useTranslation();
    const localize = useLocalizedHref();
    const titleId = useId();
    const textId = useId();
    const [customizing, setCustomizing] = useState(false);
    const [analytics, setAnalytics] = useState(state.analytics);
    const [ads, setAds] = useState(state.ads);

    // Opening "Privacy choices" starts the switches from what the visitor
    // allows now, so saving without touching them changes nothing.
    useEffect(() => {
        if (settingsOpen) {
            setAnalytics(state.analytics);
            setAds(state.ads);
        }
    }, [settingsOpen, state.analytics, state.ads]);

    const mustAnswer = state.required && !state.decided;
    const visible = config.enabled && (mustAnswer || settingsOpen);
    const detailed = customizing || settingsOpen;
    // The advertising choice only exists once a Google Ads tag is configured;
    // asking about cookies the site does not set would be misleading.
    const offersAds = config.googleAdsId !== null;

    return visible ? (
        <div className={styles.banner} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={textId}>
            <div className={styles.inner}>
                <div className={styles.header}>
                    <h2 id={titleId} className={styles.title}>{t('consent.banner.title', 'Your privacy choices')}</h2>
                    {settingsOpen && (
                        <IconButton aria-label={t('consent.banner.close', 'Close without saving')} onClick={closeSettings}>
                            <X size={18} aria-hidden="true" />
                        </IconButton>
                    )}
                </div>
                <p id={textId} className={styles.text}>
                    {offersAds
                        ? t(
                            'consent.banner.text_ads',
                            'We use a first-party cookie to count visits, and Google Ads cookies to measure which of our ads bring visitors. Neither is set unless you allow it. You can change your mind at any time from "Privacy choices" at the bottom of every page.'
                        )
                        : t(
                            'consent.banner.text',
                            'We use a first-party cookie to count visits. It is not set unless you allow it. You can change your mind at any time from "Privacy choices" at the bottom of every page.'
                        )}{' '}
                    <a href={localize(PRIVACY_POLICY_PATH)} className={styles.link}>{t('consent.banner.policy', 'Privacy Policy')}</a>
                </p>

                {detailed && (
                    <ul className={styles.choices}>
                        <li className={styles.choice}>
                            <div className={styles.choice_text}>
                                <span className={styles.choice_label}>{t('consent.choice.necessary', 'Strictly necessary')}</span>
                                <span className={styles.choice_hint}>
                                    {t('consent.choice.necessary_hint', 'Keep you signed in and remember these choices. Always on.')}
                                </span>
                            </div>
                            <Switch on disabled aria-label={t('consent.choice.necessary', 'Strictly necessary')} onChange={noopChange} />
                        </li>
                        <li className={styles.choice}>
                            <div className={styles.choice_text}>
                                <span className={styles.choice_label}>{t('consent.choice.analytics', 'Analytics')}</span>
                                <span className={styles.choice_hint}>
                                    {t('consent.choice.analytics_hint', 'Our own cookie for counting visits and pages. Never shared.')}
                                </span>
                            </div>
                            <Switch on={analytics} aria-label={t('consent.choice.analytics', 'Analytics')} onChange={setAnalytics} />
                        </li>
                        {offersAds && (
                            <li className={styles.choice}>
                                <div className={styles.choice_text}>
                                    <span className={styles.choice_label}>{t('consent.choice.ads', 'Advertising measurement')}</span>
                                    <span className={styles.choice_hint}>
                                        {t('consent.choice.ads_hint', 'Google Ads cookies that tell us when a visit from our ads leads to a provider link being followed. No ad personalization.')}
                                    </span>
                                </div>
                                <Switch on={ads} aria-label={t('consent.choice.ads', 'Advertising measurement')} onChange={setAds} />
                            </li>
                        )}
                    </ul>
                )}

                <div className={styles.actions}>
                    <Button variant="secondary" size="sm" onClick={() => save({ analytics: false, ads: false })}>
                        {t('consent.action.reject', 'Reject all')}
                    </Button>
                    {/* "Accept all" grants only the categories the banner showed. With no
                        Google Ads id the advertising choice is hidden, so storing ads: true
                        would record consent the visitor never gave, and the tag would start
                        loading for them as soon as an administrator adds an id. */}
                    <Button variant="secondary" size="sm" onClick={() => save({ analytics: true, ads: offersAds })}>
                        {t('consent.action.accept', 'Accept all')}
                    </Button>
                    {detailed ? (
                        <Button variant="primary" size="sm" onClick={() => save({ analytics, ads: offersAds && ads })}>
                            {t('consent.action.save', 'Save choices')}
                        </Button>
                    ) : (
                        <Button variant="ghost" size="sm" onClick={() => setCustomizing(true)}>
                            {t('consent.action.customize', 'Customize')}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    ) : null;
}

/**
 * Ignore a change. The strictly-necessary switch is disabled and always on,
 * but `Switch` requires a handler.
 */
function noopChange(): void {
    /* always on */
}
