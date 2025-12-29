import type { Metadata } from 'next';
import type { TronTransactionDocument } from '@tronrelic/shared';
import { Page, PageHeader, Stack, Grid } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { getApiUrl } from '../../../../lib/config';

interface AccountSnapshotSummary {
  totalSent: number;
  totalReceived: number;
  lastActive: string | null;
}

interface AccountSnapshot {
  summary: AccountSnapshotSummary;
  recentTransactions: TronTransactionDocument[];
}

interface AccountSnapshotResponse {
  success: boolean;
  snapshot: AccountSnapshot;
}

interface AccountPageProps {
  params: Promise<{
    address: string;
  }>;
}

async function fetchAccount(address: string): Promise<AccountSnapshotResponse> {
  const response = await fetch(getApiUrl(`/accounts/snapshot?address=${address}`), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load account');
  }
  return response.json();
}

export async function generateMetadata({ params }: AccountPageProps): Promise<Metadata> {
  const { address } = await params;
  return {
    title: `Account ${address}`
  };
}

export default async function AccountPage({ params }: AccountPageProps): Promise<JSX.Element> {
  const { address } = await params;
  const data = await fetchAccount(address);
  const snapshot: AccountSnapshot = data.snapshot ?? {
    summary: {
      totalSent: 0,
      totalReceived: 0,
      lastActive: null
    },
    recentTransactions: []
  };

  const normalizedAddress = address.toLowerCase();
  const totalTransactions = snapshot.recentTransactions.length;
  const flowAggregates = snapshot.recentTransactions.reduce(
    (acc, transaction) => {
      const amount = transaction.amountTRX ?? 0;
      const isInbound = transaction.to?.address?.toLowerCase() === normalizedAddress;
      if (isInbound) {
        acc.inboundCount += 1;
        acc.inboundTotal += amount;
        if (transaction.from?.address) {
          acc.counterparties.add(transaction.from.address);
        }
      } else {
        acc.outboundCount += 1;
        acc.outboundTotal += amount;
        if (transaction.to?.address) {
          acc.counterparties.add(transaction.to.address);
        }
      }
      acc.totalAmount += amount;
      acc.maxAmount = Math.max(acc.maxAmount, amount);
      return acc;
    },
    {
      inboundCount: 0,
      outboundCount: 0,
      inboundTotal: 0,
      outboundTotal: 0,
      totalAmount: 0,
      maxAmount: 0,
      counterparties: new Set<string>()
    }
  );

  const averageAmount = totalTransactions ? flowAggregates.totalAmount / totalTransactions : 0;
  const inboundRatio = totalTransactions ? flowAggregates.inboundCount / totalTransactions : 0;
  const netFlow = snapshot.summary.totalReceived - snapshot.summary.totalSent;
  const netFlowTone: 'success' | 'danger' | 'neutral' = netFlow === 0 ? 'neutral' : netFlow > 0 ? 'success' : 'danger';
  const flowLabel = netFlow > 0 ? 'Net receiver' : netFlow < 0 ? 'Net sender' : 'Balanced';
  const lastActiveDate = snapshot.summary.lastActive ? new Date(snapshot.summary.lastActive) : null;
  const lastActiveText = lastActiveDate ? lastActiveDate.toLocaleString() : 'Unknown';

  return (
    <Page>
      <PageHeader
        title={address}
        subtitle="Summary of TRX flows and recent transactions for this wallet."
      />
        <Card>
          <header style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <h2 style={{ margin: 0 }}>Snapshot</h2>
              <p className="text-subtle" style={{ margin: 0 }}>Aggregated resource posture since first observation.</p>
            </div>
            <Badge tone={netFlowTone}>{flowLabel}</Badge>
          </header>
          <div className="stat-grid" style={{ marginTop: '1.5rem' }}>
            <Card tone="muted" padding="sm">
              <div className="stat-card__label">Total sent</div>
              <div className="stat-card__value">{snapshot.summary.totalSent.toLocaleString()} TRX</div>
            </Card>
            <Card tone="muted" padding="sm">
              <div className="stat-card__label">Total received</div>
              <div className="stat-card__value">{snapshot.summary.totalReceived.toLocaleString()} TRX</div>
            </Card>
            <Card tone="muted" padding="sm">
              <div className="stat-card__label">Last active</div>
              <div className="stat-card__value">{lastActiveText}</div>
            </Card>
            <Card tone="muted" padding="sm">
              <div className="stat-card__label">Transactions tracked</div>
              <div className="stat-card__value">{totalTransactions.toLocaleString()}</div>
            </Card>
          </div>
        </Card>

        <Grid columns={2} gap="lg" style={{ marginTop: '2rem' }}>
          <Card tone="accent" padding="lg">
            <header style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Flow analytics</h2>
              <Badge tone={netFlowTone}>
                {netFlow.toLocaleString(undefined, { maximumFractionDigits: 2 })} TRX
              </Badge>
            </header>
            <p className="text-subtle" style={{ margin: 0 }}>Net difference between received and sent TRX based on captured history.</p>
            <section className="stat-grid" style={{ marginTop: '1rem' }}>
              <Card tone="muted" padding="sm">
                <div className="stat-card__label">Inbound share</div>
                <div className="stat-card__value">{Math.round(inboundRatio * 100)}%</div>
                <div className="meter" role="presentation" aria-hidden="true">
                  <div className="meter__value" style={{ width: `${Math.round(inboundRatio * 100)}%` }} />
                </div>
              </Card>
              <Card tone="muted" padding="sm">
                <div className="stat-card__label">Average transfer</div>
                <div className="stat-card__value">{averageAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} TRX</div>
                <div className="stat-card__delta">Across {totalTransactions.toLocaleString()} tx</div>
              </Card>
              <Card tone="muted" padding="sm">
                <div className="stat-card__label">Max transfer observed</div>
                <div className="stat-card__value">{flowAggregates.maxAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} TRX</div>
                <div className="stat-card__delta">From historical snapshot</div>
              </Card>
              <Card tone="muted" padding="sm">
                <div className="stat-card__label">Unique counterparties</div>
                <div className="stat-card__value">{flowAggregates.counterparties.size.toLocaleString()}</div>
                <div className="stat-card__delta">Inbound {flowAggregates.inboundCount.toLocaleString()} · Outbound {flowAggregates.outboundCount.toLocaleString()}</div>
              </Card>
            </section>
          </Card>

          <Card padding="lg">
            <Stack>
            <h2 style={{ margin: 0 }}>Last observed activity</h2>
            <Stack gap="sm">
              <div className="text-subtle" style={{ fontSize: '0.9rem' }}>Recent counterparties</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {snapshot.recentTransactions.slice(0, 6).map(tx => {
                  const isInbound = tx.to?.address?.toLowerCase() === normalizedAddress;
                  const counterparty = isInbound ? tx.from?.address : tx.to?.address;
                  if (!counterparty) {
                    return null;
                  }
                  return (
                    <Badge key={`${tx.txId}-${counterparty}`} tone="neutral">
                      {counterparty.slice(0, 6)}…{counterparty.slice(-4)}
                    </Badge>
                  );
                })}
                {!snapshot.recentTransactions.length && <span className="text-subtle">No counterparties recorded.</span>}
              </div>
            </Stack>
            <Stack gap="sm">
              <div className="text-subtle" style={{ fontSize: '0.9rem' }}>Activity cadence</div>
              <p className="text-subtle" style={{ margin: 0 }}>
                {flowAggregates.inboundCount.toLocaleString()} inbound and {flowAggregates.outboundCount.toLocaleString()} outbound transactions captured in the current cache window.
              </p>
            </Stack>
            </Stack>
          </Card>
        </Grid>

        <Card style={{ marginTop: '2rem' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ marginTop: 0 }}>Recent transactions</h2>
              <p className="text-subtle" style={{ margin: 0 }}>
                Latest activity recorded for this wallet, including transfers, staking operations, and delegations.
              </p>
            </div>
            <Badge tone="neutral">{totalTransactions} entries</Badge>
          </header>
          {snapshot.recentTransactions.length ? (
            <div className="table-scroll" style={{ marginTop: '1.5rem' }}>
              <table className="table" aria-label="Recent transactions">
                <thead>
                  <tr>
                    <th scope="col">Direction</th>
                    <th scope="col">Type</th>
                    <th scope="col">Amount (TRX)</th>
                    <th scope="col">Counterparty</th>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.recentTransactions.map(tx => {
                    const isInbound = tx.to?.address?.toLowerCase() === normalizedAddress;
                    const counterparty = isInbound ? tx.from?.address : tx.to?.address;
                    return (
                      <tr key={tx.txId}>
                        <td>
                          <Badge tone={isInbound ? 'success' : 'warning'}>{isInbound ? 'Inbound' : 'Outbound'}</Badge>
                        </td>
                        <td>{tx.type}</td>
                        <td>
                          {(tx.amountTRX ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          {typeof tx.amountUSD === 'number' && (
                            <span className="text-subtle" style={{ display: 'block', fontSize: '0.75rem' }}>
                              ≈ ${tx.amountUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>
                          )}
                        </td>
                        <td>
                          {counterparty ? (
                            <span title={counterparty}>{counterparty.slice(0, 8)}…{counterparty.slice(-6)}</span>
                          ) : (
                            <span className="text-subtle">Unknown</span>
                          )}
                        </td>
                        <td>{new Date(tx.timestamp).toLocaleString()}</td>
                        <td>
                          {tx.memo ? (
                            <span title={tx.memo}>{tx.memo.slice(0, 32)}{tx.memo.length > 32 ? '…' : ''}</span>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-subtle" style={{ marginTop: '1.5rem' }}>No recent transactions recorded.</p>
          )}
        </Card>
    </Page>
  );
}
