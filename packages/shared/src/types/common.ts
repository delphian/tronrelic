export type Environment = 'development' | 'staging' | 'production';

export interface Pagination {
  limit: number;
  skip: number;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: number;
  message?: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: unknown;
}

export interface CacheEntry<T> {
  key: string;
  value: T;
  expiresAt?: Date;
  tags?: string[];
}

export type NotificationChannel = 'websocket' | 'email';

export interface AddressMetadata {
  address: string;
  name?: string | null;
  type?: string | null;
  labels?: string[];
  description?: string | null;
}
