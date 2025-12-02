/**
 * Next.js middleware for request processing.
 *
 * Sets custom headers used by server components for request context,
 * including pathname for widget zone routing.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware that sets request context headers for server components.
 *
 * Adds x-pathname header so server components can access the current
 * route without client-side hooks.
 */
export function middleware(request: NextRequest) {
    const response = NextResponse.next();

    // Set pathname header for widget zone routing
    response.headers.set('x-pathname', request.nextUrl.pathname);

    return response;
}

/**
 * Middleware matcher configuration.
 *
 * Excludes API routes, static files, and Next.js internals.
 */
export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']
};
