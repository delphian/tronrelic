/**
 * @fileoverview Name of the request header that carries the routed language.
 *
 * The middleware sets this header on every request it routes, to the language
 * it rewrote the request into. The layouts compare it with the `[lang]` route
 * parameter: a mismatch means the request reached the `[lang]` folder without
 * passing through the middleware's routing, such as a missing file under
 * `/images/`, and the page answers 404 instead of rendering a site page under
 * a made-up language. The middleware always overwrites the header, so a value a
 * visitor sends is never trusted.
 */

/** Request header holding the language the middleware routed to. */
export const LANGUAGE_REQUEST_HEADER = 'x-tronrelic-language';
