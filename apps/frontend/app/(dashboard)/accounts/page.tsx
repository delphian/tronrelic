'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { BookmarkPanel } from '../../../features/accounts';

export default function AccountsLandingPage() {
  const [address, setAddress] = useState('');
  const router = useRouter();

  const submit = () => {
    if (!address.startsWith('T')) {
      return;
    }
    router.push(`/accounts/${address}`);
  };

  return (
    <main>
      <div className="page">
        <section className="page-header">
          <h1 className="page-title">Account analytics</h1>
          <p className="page-subtitle">Inspect TRON addresses for delegation history, memo activity, and performance insights.</p>
        </section>
        <Card>
          <div className="stack">
            <h2 style={{ margin: 0 }}>Jump to an address</h2>
            <p className="text-subtle" style={{ margin: 0 }}>Paste a TRON base58 wallet to view resource usage and recent transactions.</p>
            <div className="input-group">
              <Input
                value={address}
                onChange={event => setAddress(event.target.value)}
                placeholder="Enter TRON address"
              />
              <Button onClick={submit} disabled={!address.startsWith('T')}>
                Analyze
              </Button>
            </div>
            <p className="text-subtle" style={{ fontSize: '0.8rem' }}>
              Tip: Bookmark wallets below to keep quick access to treasuries, whales, and contracts you care about.
            </p>
          </div>
        </Card>
        <BookmarkPanel />
      </div>
    </main>
  );
}
