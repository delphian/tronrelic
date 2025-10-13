'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
    this.resetError = this.resetError.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.onError) {
      this.props.onError(error, info);
    }
  }

  resetError() {
    if (this.state.error) {
      this.setState({ error: null });
      this.props.onReset?.();
    }
  }

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      return fallback ?? <ErrorFallback error={error} onRetry={this.resetError} />;
    }

    return children;
  }
}

export function withErrorBoundary<P>(ComponentWithBoundary: (props: P) => ReactNode, boundaryProps?: Omit<ErrorBoundaryProps, 'children'>) {
  return function ErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary {...boundaryProps}>
        <>{ComponentWithBoundary(props)}</>
      </ErrorBoundary>
    );
  };
}
