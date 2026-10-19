/**
 * @fileoverview Detect a browser that reports it is under automation control.
 *
 * @module lib/isAutomatedBrowser
 */

/**
 * Report whether the browser says it is under automation control.
 *
 * Headless browser fleets run JavaScript and send a stock browser
 * User-Agent, so the server cannot tell them from a visitor, and they get
 * counted in visitor figures and click counts. Browsers set
 * `navigator.webdriver` to true while WebDriver, Puppeteer, or Playwright
 * drives them, which gives the backend a signal the request headers do not
 * carry. Every analytics beacon sends it so each counter can leave such
 * traffic out the same way.
 *
 * @returns True only when the flag is exactly `true`; false when it is
 *   absent or the navigator object is unavailable.
 */
export function isAutomatedBrowser(): boolean {
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
}
