export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  factor?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    delayMs = 500,
    factor = 2,
    onRetry
  } = options;

  let attempt = 0;
  let lastError: unknown;
  let delay = delayMs;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      onRetry?.(attempt + 1, error);
      await sleep(delay);
      delay *= factor;
      attempt += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
