/**
 * @fileoverview Name of the request header that carries the page's CSP nonce.
 *
 * The middleware generates a fresh nonce for every page request and passes it
 * to server rendering in this header. The root layout reads it and stamps it on
 * the inline scripts it writes itself, so they match the `script-src` nonce in
 * the Content-Security-Policy. The middleware always overwrites the header, so a
 * value a visitor sends is never used.
 */

/** Request header holding the nonce the middleware generated for this page. */
export const CSP_NONCE_HEADER = 'x-nonce';
