"use client";

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { LegacyTool, toggleLegacyToolFavorite } from '../../lib/legacyContent';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface ToolsCatalogProps {
  initialTools: LegacyTool[];
}

const availabilityTone: Record<NonNullable<LegacyTool['availability']>, 'success' | 'warning'> = {
  stable: 'success',
  preview: 'warning'
};

export function ToolsCatalog({ initialTools }: ToolsCatalogProps) {
  const categories = useMemo(() => ['All', ...Array.from(new Set(initialTools.flatMap(tool => tool.categories)))], [initialTools]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [favorites, applyOptimisticFavorite] = useOptimistic<string[], { slug: string; favorite: boolean }>([], (state, update) => {
    if (update.favorite) {
      return state.includes(update.slug) ? state : [...state, update.slug];
    }
    return state.filter(slug => slug !== update.slug);
  });
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filteredTools = useMemo(() => {
    if (selectedCategory === 'All') {
      return initialTools;
    }
    return initialTools.filter(tool => tool.categories.includes(selectedCategory as ToolsCatalogProps['initialTools'][number]['categories'][number]));
  }, [initialTools, selectedCategory]);

  const handleToggleFavorite = (tool: LegacyTool) => {
    const currentlyFavorite = favorites.includes(tool.slug);
    const nextFavorite = !currentlyFavorite;
    applyOptimisticFavorite({ slug: tool.slug, favorite: nextFavorite });
    setPendingSlug(tool.slug);

    startTransition(async () => {
      try {
        await toggleLegacyToolFavorite(tool.slug, nextFavorite);
      } catch (error) {
        console.error(error);
        applyOptimisticFavorite({ slug: tool.slug, favorite: currentlyFavorite });
      } finally {
        setPendingSlug(value => (value === tool.slug ? null : value));
      }
    });
  };

  return (
    <div className="stack stack--lg">
      <header className="stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Tools directory</h2>
            <p className="text-subtle" style={{ margin: 0 }}>Launch the legacy calculators while we migrate their logic into the unified Node.js services.</p>
          </div>
          <div aria-live="polite" className="text-subtle" style={{ fontSize: '0.85rem' }}>
            {favorites.length ? `${favorites.length} tool${favorites.length > 1 ? 's' : ''} marked as favorites` : 'No favorites selected yet'}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {categories.map(category => (
            <Button
              key={category}
              size="sm"
              variant={selectedCategory === category ? 'primary' : 'ghost'}
              onClick={() => setSelectedCategory(category)}
              aria-pressed={selectedCategory === category}
            >
              {category}
            </Button>
          ))}
        </div>
      </header>

      <section className="grid grid--responsive">
        {filteredTools.map(tool => {
          const isFavorite = favorites.includes(tool.slug);
          return (
            <Card key={tool.slug} padding="md" className="stack">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div className="stack stack--sm">
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {tool.categories.map(category => (
                      <Badge key={`${tool.slug}-${category}`} tone="neutral">{category}</Badge>
                    ))}
                    {tool.availability && (
                      <Badge tone={availabilityTone[tool.availability]}>{tool.availability === 'preview' ? 'Preview' : 'Stable'}</Badge>
                    )}
                  </div>
                  <h3 style={{ margin: 0 }}>{tool.title}</h3>
                  <p className="text-subtle" style={{ margin: 0 }}>{tool.description}</p>
                </div>
                <div className="stack stack--sm" style={{ minWidth: '180px', alignItems: 'flex-end' }}>
                  {typeof tool.latencyMs === 'number' && (
                    <span className="text-subtle" style={{ fontSize: '0.82rem' }}>Median latency {tool.latencyMs}ms</span>
                  )}
                  <Button
                    variant={isFavorite ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => handleToggleFavorite(tool)}
                    loading={pendingSlug === tool.slug}
                    aria-pressed={isFavorite}
                    aria-label={`${isFavorite ? 'Remove' : 'Add'} ${tool.title} ${isFavorite ? 'from' : 'to'} your favorites`}
                  >
                    {isFavorite ? 'Favorited' : 'Add to favorites'}
                  </Button>
                  <a href={tool.href} className="chip" aria-label={`Open ${tool.title}`} target="_blank" rel="noreferrer">
                    Launch tool
                  </a>
                </div>
              </div>
            </Card>
          );
        })}
        {!filteredTools.length && (
          <Card tone="muted" padding="lg">
            <p className="text-subtle" style={{ margin: 0 }}>No tools are available for the selected category yet.</p>
          </Card>
        )}
      </section>
    </div>
  );
}
