'use client';

/**
 * Recent Whale Activity Widget.
 *
 * Displays the most recent large TRX transactions in a compact card format.
 * Rendered via the widget zone system on the homepage.
 */

/**
 * Data structure for the recent whales widget.
 * Matches the data returned by the backend widget fetchData.
 */
interface RecentWhalesData {
    transactions: Array<{
        txId: string;
        fromAddress: string;
        toAddress: string;
        amountTRX: number;
        timestamp: string;
        pattern: string;
    }>;
    count: number;
}

/**
 * Format a TRON address for display.
 * Shows first 6 and last 4 characters with ellipsis.
 */
function formatAddress(address: string): string {
    if (!address || address.length < 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format TRX amount with appropriate units.
 */
function formatAmount(amountTRX: number): string {
    if (amountTRX >= 1_000_000) {
        return `${(amountTRX / 1_000_000).toFixed(2)}M TRX`;
    }
    if (amountTRX >= 1_000) {
        return `${(amountTRX / 1_000).toFixed(1)}K TRX`;
    }
    return `${amountTRX.toLocaleString()} TRX`;
}

/**
 * Get pattern badge color class.
 */
function getPatternColor(pattern: string): string {
    switch (pattern) {
        case 'exchange-deposit':
            return 'badge--warning';
        case 'exchange-withdrawal':
            return 'badge--success';
        case 'whale-to-whale':
            return 'badge--primary';
        default:
            return 'badge--secondary';
    }
}

/**
 * Format pattern for display.
 */
function formatPattern(pattern: string): string {
    return pattern
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Format a date as relative time (e.g., "5 minutes ago").
 */
function formatTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
        return `${diffDays}d ago`;
    }
    if (diffHours > 0) {
        return `${diffHours}h ago`;
    }
    if (diffMins > 0) {
        return `${diffMins}m ago`;
    }
    return 'just now';
}

/**
 * Recent Whale Activity widget component.
 *
 * @param data - Pre-fetched widget data from SSR
 */
export function RecentWhalesWidget({ data }: { data: unknown }) {
    const whaleData = data as RecentWhalesData;

    if (!whaleData?.transactions || whaleData.transactions.length === 0) {
        return (
            <div className="surface surface--padding-md text-center">
                <p className="text-muted">No recent whale activity detected</p>
            </div>
        );
    }

    return (
        <div className="surface">
            <div className="stack">
                {whaleData.transactions.map((tx) => (
                    <div
                        key={tx.txId}
                        className="surface--padding-sm border-b border-border last:border-b-0"
                    >
                        <div className="flex justify-between items-start gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-lg">
                                        {formatAmount(tx.amountTRX)}
                                    </span>
                                    <span className={`badge ${getPatternColor(tx.pattern)}`}>
                                        {formatPattern(tx.pattern)}
                                    </span>
                                </div>
                                <div className="text-sm text-muted">
                                    <span className="font-mono">{formatAddress(tx.fromAddress)}</span>
                                    <span className="mx-2">→</span>
                                    <span className="font-mono">{formatAddress(tx.toAddress)}</span>
                                </div>
                            </div>
                            <div className="text-sm text-muted whitespace-nowrap">
                                {formatTimeAgo(tx.timestamp)}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="surface--padding-sm border-t border-border">
                <a
                    href="/whales"
                    className="text-sm text-primary hover:underline"
                >
                    View all whale activity →
                </a>
            </div>
        </div>
    );
}
