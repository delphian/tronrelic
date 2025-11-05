import type { ISystemLogService } from '@tronrelic/types';

export interface RetryOptions {
    attempts?: number;
    backoffMs?: number;
    backoffMultiplier?: number;
    logger?: ISystemLogService;
    fetcher?: string;
    requestLabel?: string;
    marketGuid?: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Determines if an error is non-retryable (e.g., SSL certificate errors, DNS failures).
 *
 * Non-retryable errors indicate permanent infrastructure failures that won't resolve
 * with retry attempts. These typically require manual intervention (cert renewal, DNS fix).
 *
 * @param error - The error to check
 * @returns True if the error should not be retried
 */
function isNonRetryableError(error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string })?.code;

    // SSL certificate errors - no point retrying
    if (
        errorCode === 'CERT_HAS_EXPIRED' ||
        errorCode === 'CERT_NOT_YET_VALID' ||
        errorCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) {
        return true;
    }

    // DNS resolution failures
    if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') {
        return true;
    }

    // Check message patterns for SSL issues
    if (errorMessage.includes('certificate') && (errorMessage.includes('expired') || errorMessage.includes('invalid'))) {
        return true;
    }

    return false;
}

/**
 * Executes an async operation with exponential backoff retry logic.
 *
 * Automatically skips retries for non-retryable errors (SSL cert issues, DNS failures).
 * Logs retry attempts with increasing delays between each attempt.
 *
 * @param operation - The async operation to execute
 * @param options - Retry configuration including attempts, backoff, and logging context
 * @returns Promise resolving to the operation's result
 * @throws The last error encountered if all retry attempts fail
 */
export async function executeWithRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const { attempts = 3, backoffMs = 500, backoffMultiplier = 2, logger, fetcher, requestLabel, marketGuid } = options;

    let currentAttempt = 0;
    let delay = backoffMs;
    let lastError: unknown;

    while (currentAttempt < attempts) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            currentAttempt += 1;

            // Don't retry for non-retryable errors
            if (isNonRetryableError(error)) {
                logger?.warn(
                    {
                        error,
                        fetcher,
                        requestLabel,
                        errorCode: (error as { code?: string })?.code
                    },
                    'Non-retryable error detected, skipping retries'
                );
                throw error;
            }

            if (currentAttempt >= attempts) {
                throw error;
            }

            logger?.warn(
                {
                    error,
                    attempt: currentAttempt,
                    attempts,
                    fetcher,
                    requestLabel,
                    delay
                },
                'Retrying market request'
            );

            await sleep(delay);
            delay *= backoffMultiplier;
        }
    }

    throw lastError ?? new Error('Retry operation failed');
}
