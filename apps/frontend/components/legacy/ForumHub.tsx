"use client";

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { LegacyForumSpace, toggleLegacyForumSubscription } from '../../lib/legacyContent';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface ForumHubProps {
  initialSpaces: LegacyForumSpace[];
}

const dateFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function formatRelativeTime(value: string) {
  const now = Date.now();
  const timestamp = new Date(value).getTime();
  const diff = timestamp - now;
  const minutes = Math.round(diff / (1000 * 60));
  if (Math.abs(minutes) < 60) {
    return dateFormatter.format(minutes, 'minute');
  }
  const hours = Math.round(diff / (1000 * 60 * 60));
  if (Math.abs(hours) < 48) {
    return dateFormatter.format(hours, 'hour');
  }
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  return dateFormatter.format(days, 'day');
}

export function ForumHub({ initialSpaces }: ForumHubProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [subscriptions, applyOptimisticSubscription] = useOptimistic<string[], { slug: string; subscribed: boolean }>([], (state, update) => {
    if (update.subscribed) {
      return state.includes(update.slug) ? state : [...state, update.slug];
    }
    return state.filter(slug => slug !== update.slug);
  });
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filteredSpaces = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    const ranked = [...initialSpaces].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
    if (!normalized) {
      return ranked;
    }
    return ranked.filter(space => space.title.toLowerCase().includes(normalized) || space.description.toLowerCase().includes(normalized));
  }, [initialSpaces, searchTerm]);

  const handleToggleSubscription = (space: LegacyForumSpace) => {
    const currentlySubscribed = subscriptions.includes(space.slug);
    const nextSubscribed = !currentlySubscribed;
    applyOptimisticSubscription({ slug: space.slug, subscribed: nextSubscribed });
    setPendingSlug(space.slug);

    startTransition(async () => {
      try {
        await toggleLegacyForumSubscription(space.slug, nextSubscribed);
      } catch (error) {
        console.error(error);
        applyOptimisticSubscription({ slug: space.slug, subscribed: currentlySubscribed });
      } finally {
        setPendingSlug(value => (value === space.slug ? null : value));
      }
    });
  };

  return (
    <div className="stack stack--lg">
      <header className="stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Signed forum spaces</h2>
            <p className="text-subtle" style={{ margin: 0 }}>Wallet-authenticated rooms preserved from the classic TronRelic community.</p>
          </div>
          <div className="text-subtle" style={{ fontSize: '0.85rem' }} aria-live="polite">
            {subscriptions.length ? `${subscriptions.length} subscription${subscriptions.length > 1 ? 's' : ''} active` : 'No forum subscriptions yet'}
          </div>
        </div>
        <label className="input-group" style={{ width: '100%', maxWidth: '420px' }}>
          <span className="text-subtle" style={{ fontSize: '0.85rem' }}>Search forums</span>
          <input
            type="search"
            className="input input--ghost"
            placeholder="Find a forum room"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            aria-label="Search forum rooms"
          />
        </label>
      </header>

      <section className="stack">
        {filteredSpaces.map(space => {
          const isSubscribed = subscriptions.includes(space.slug);
          return (
            <Card key={space.slug} padding="md" className="stack">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1.25rem', flexWrap: 'wrap' }}>
                <div className="stack stack--sm" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {space.pinned && <Badge tone="success">Pinned</Badge>}
                    <Badge tone={space.moderationLevel === 'curated' ? 'warning' : 'neutral'}>
                      {space.moderationLevel === 'curated' ? 'Curated' : 'Open access'}
                    </Badge>
                    <span className="text-subtle" style={{ fontSize: '0.8rem' }}>
                      Last activity {formatRelativeTime(space.lastActiveAt)}
                    </span>
                  </div>
                  <h3 style={{ margin: 0 }}>{space.title}</h3>
                  <p className="text-subtle" style={{ margin: 0 }}>{space.description}</p>
                </div>
                <div className="stack stack--sm" style={{ minWidth: '180px', alignItems: 'flex-end' }}>
                  <div className="text-subtle" style={{ fontSize: '0.82rem' }}>
                    {space.memberCount.toLocaleString()} members · {space.topicCount.toLocaleString()} topics
                  </div>
                  <Button
                    variant={isSubscribed ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => handleToggleSubscription(space)}
                    loading={pendingSlug === space.slug}
                    aria-pressed={isSubscribed}
                    aria-label={`${isSubscribed ? 'Unfollow' : 'Follow'} ${space.title}`}
                  >
                    {isSubscribed ? 'Following' : 'Follow updates'}
                  </Button>
                  <a href={space.href} className="chip" aria-label={`Open ${space.title} forum`}>
                    Enter forum
                  </a>
                </div>
              </div>
            </Card>
          );
        })}
        {!filteredSpaces.length && (
          <Card tone="muted" padding="lg">
            <p className="text-subtle" style={{ margin: 0 }}>No forums match that search term. Try a different keyword.</p>
          </Card>
        )}
      </section>
    </div>
  );
}
