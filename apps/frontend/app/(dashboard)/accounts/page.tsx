'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Page, PageHeader, Stack } from '../../../components/layout';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';

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
    <Page>
      <PageHeader
        title="Account analytics"
        subtitle="Inspect TRON addresses for delegation history, memo activity, and performance insights."
      />
      <Card>
        <Stack>
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
        </Stack>
      </Card>
    </Page>
  );
}
