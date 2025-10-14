'use client';

import { useEffect, useState } from 'react';
import {
    SystemOverview,
    BlockchainMonitor,
    SchedulerMonitor,
    MarketMonitor,
    SystemHealthMonitor,
    ConfigurationPanel
} from '../../../features/system';

export default function SystemMonitoringPage() {
  const [token, setToken] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'blockchain' | 'scheduler' | 'markets' | 'health' | 'config'>('overview');

  useEffect(() => {
    const savedToken = localStorage.getItem('admin_token');
    if (savedToken) {
      setToken(savedToken);
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      localStorage.setItem('admin_token', token);
      setIsAuthenticated(true);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setToken('');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return (
      <div className="page" style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem' }}>
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          <header>
            <h1>System Monitoring</h1>
            <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>
              Enter your admin token to access system monitoring tools
            </p>
          </header>
          <form onSubmit={handleLogin} style={{ display: 'grid', gap: '1rem' }}>
            <label style={{ display: 'grid', gap: '0.5rem' }}>
              <span>Admin Token</span>
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Enter admin API token"
                style={{ padding: '0.75rem', fontSize: '1rem' }}
                required
              />
            </label>
            <button type="submit" style={{ padding: '0.75rem', fontSize: '1rem' }}>
              Access System Monitor
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ padding: '2rem' }}>
      <div style={{ display: 'grid', gap: '2rem' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>System Monitoring Dashboard</h1>
            <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>
              Real-time visibility into blockchain sync, jobs, markets, and system health
            </p>
          </div>
          <button onClick={handleLogout} style={{ padding: '0.5rem 1rem' }}>
            Logout
          </button>
        </header>

        <nav style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
          {(['overview', 'blockchain', 'scheduler', 'markets', 'health', 'config'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '0.5rem 1rem',
                background: activeTab === tab ? 'rgba(255,255,255,0.1)' : 'transparent',
                border: activeTab === tab ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent',
                borderRadius: '4px',
                textTransform: 'capitalize'
              }}
            >
              {tab}
            </button>
          ))}
          <a
            href="/system/plugins"
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: '4px',
              textTransform: 'capitalize',
              textDecoration: 'none',
              color: 'inherit'
            }}
          >
            Plugins
          </a>
        </nav>

        <section>
          {activeTab === 'overview' && <SystemOverview token={token} />}
          {activeTab === 'blockchain' && <BlockchainMonitor token={token} />}
          {activeTab === 'scheduler' && <SchedulerMonitor token={token} />}
          {activeTab === 'markets' && <MarketMonitor token={token} />}
          {activeTab === 'health' && <SystemHealthMonitor token={token} />}
          {activeTab === 'config' && <ConfigurationPanel token={token} />}
        </section>
      </div>
    </div>
  );
}
