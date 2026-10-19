/**
 * @fileoverview One click on the language switcher, as the browser reports it.
 */

/**
 * The body the language switcher posts to `POST /api/localization/switches`
 * when a visitor clicks a language other than the one they are reading.
 *
 * The switcher is made of plain links that cause a full page load, so the
 * click is the only point where the visitor's choice is visible. The page view
 * that follows shows where they landed but not that they chose to go there.
 */
export interface ILanguageSwitch {
    /** Unprefixed path of the page the visitor was on, e.g. `/markets`. */
    path: string;

    /** Language the visitor was reading when they clicked. */
    from: string;

    /** Language the visitor clicked. */
    to: string;

    /**
     * True when the browser reports it is driven by automation
     * (`navigator.webdriver`). The backend counts nothing for such a click.
     */
    automated?: boolean;
}
