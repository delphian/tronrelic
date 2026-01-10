export class TronRelicError extends Error {
  constructor(public readonly message: string, public readonly code = 'INTERNAL_ERROR', public readonly details?: unknown) {
    super(message);
    this.name = 'TronRelicError';
  }
}

export class NotFoundError extends TronRelicError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 'NOT_FOUND', details);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends TronRelicError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends TronRelicError {
  constructor(message = 'Rate limit exceeded', details?: unknown) {
    super(message, 'RATE_LIMIT', details);
    this.name = 'RateLimitError';
  }
}
