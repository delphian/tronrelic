import type { NextFunction, Request, Response } from 'express';

/**
 * Async handler wrapper for Express route handlers.
 *
 * Catches any errors thrown in async route handlers and passes them to Express error middleware.
 * Without this wrapper, unhandled promise rejections can crash the Node.js process.
 *
 * @param fn - Async route handler function to wrap
 * @returns Wrapped function that catches errors and passes them to next()
 *
 * @example
 * router.post('/endpoint', asyncHandler(async (req, res) => {
 *   const data = await someAsyncOperation();
 *   res.json(data);
 * }));
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
