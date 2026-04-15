/**
 * Framework-agnostic HTTP response interface.
 *
 * This abstraction decouples plugins from Express-specific response methods,
 * providing a clean contract for sending HTTP responses. Plugins use this
 * interface instead of importing Express directly.
 *
 * Why this abstraction exists:
 * - Plugins remain framework-independent
 * - Backend can swap HTTP libraries without breaking plugins
 * - Easier testing with mock response objects
 * - Type-safe response methods
 */
export interface IHttpResponse {
    /**
     * Send a JSON response.
     *
     * Automatically sets Content-Type to application/json and serializes the
     * provided data. This is the primary way to send API responses.
     *
     * @param data - Any JSON-serializable data
     * @returns The response object for chaining
     *
     * @example
     * ```typescript
     * res.json({ success: true, data: items });
     * res.json({ error: 'Not found' });
     * ```
     */
    json(data: any): IHttpResponse;

    /**
     * Send a plain text response.
     *
     * Sets Content-Type to text/plain and sends the string directly.
     *
     * @param text - Plain text content
     * @returns The response object for chaining
     *
     * @example
     * ```typescript
     * res.send('OK');
     * res.send('Error: Invalid request');
     * ```
     */
    send(text: string): IHttpResponse;

    /**
     * Set the HTTP status code.
     *
     * Should be called before sending the response body. Returns the response
     * object for method chaining.
     *
     * @param code - HTTP status code (200, 201, 400, 404, 500, etc.)
     * @returns The response object for chaining
     *
     * @example
     * ```typescript
     * res.status(404).json({ error: 'Not found' });
     * res.status(201).json({ success: true });
     * res.status(400).send('Bad request');
     * ```
     */
    status(code: number): IHttpResponse;

    /**
     * Set a response header.
     *
     * Can be called multiple times to set different headers. Must be called
     * before sending the response body.
     *
     * @param name - Header name
     * @param value - Header value
     * @returns The response object for chaining
     *
     * @example
     * ```typescript
     * res.setHeader('Content-Type', 'application/pdf');
     * res.setHeader('Cache-Control', 'no-cache');
     * res.setHeader('X-Custom-Header', 'value');
     * ```
     */
    setHeader(name: string, value: string | string[]): IHttpResponse;

    /**
     * Get the current value of a response header.
     *
     * Returns the header value or undefined if not set.
     *
     * @param name - Header name (case-insensitive)
     * @returns Header value or undefined
     *
     * @example
     * ```typescript
     * const contentType = res.getHeader('Content-Type');
     * ```
     */
    getHeader(name: string): string | string[] | undefined;

    /**
     * Set a cookie on the response.
     *
     * Optionally accepts options for expiration, domain, path, secure, httpOnly, etc.
     *
     * @param name - Cookie name
     * @param value - Cookie value
     * @param options - Cookie options (maxAge, domain, path, secure, httpOnly, etc.)
     * @returns The response object for chaining
     *
     * @example
     * ```typescript
     * res.cookie('sessionId', 'abc123', {
     *     maxAge: 86400000, // 1 day
     *     httpOnly: true,
     *     secure: true
     * });
     * ```
     */
    cookie(name: string, value: string, options?: {
        maxAge?: number;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
        sameSite?: 'strict' | 'lax' | 'none';
    }): IHttpResponse;

    /**
     * Redirect to a different URL.
     *
     * Sends a 302 redirect by default, or a custom status code if provided.
     *
     * @param url - Target URL
     * @param status - HTTP status code (default: 302)
     *
     * @example
     * ```typescript
     * res.redirect('/login');
     * res.redirect('/dashboard', 301); // Permanent redirect
     * ```
     */
    redirect(url: string, status?: number): void;

    /**
     * End the response without sending any data.
     *
     * Useful for responding to HEAD requests or when the status code is enough.
     *
     * @example
     * ```typescript
     * res.status(204).end(); // No content
     * res.status(304).end(); // Not modified
     * ```
     */
    end(): void;

    /**
     * Current HTTP status code.
     *
     * Read-only property that reflects the status code set via status().
     */
    readonly statusCode: number;
}
