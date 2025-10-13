"use client";

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { LegacyArticle, toggleLegacyArticleSave } from '../../lib/legacyContent';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface ArticlesListProps {
  initialArticles: LegacyArticle[];
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export function ArticlesList({ initialArticles }: ArticlesListProps) {
  const categories = useMemo(() => ['All', ...Array.from(new Set(initialArticles.map(item => item.category)))], [initialArticles]);
  const tags = useMemo(() => Array.from(new Set(initialArticles.flatMap(item => item.tags))).sort(), [initialArticles]);

  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [saved, applyOptimisticSave] = useOptimistic<string[], { slug: string; saved: boolean }>([], (state, update) => {
    if (update.saved) {
      return state.includes(update.slug) ? state : [...state, update.slug];
    }
    return state.filter(slug => slug !== update.slug);
  });
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filteredArticles = useMemo(() => {
    return initialArticles.filter(item => {
      const categoryMatch = selectedCategory === 'All' || item.category === selectedCategory;
      const tagMatch = !selectedTag || item.tags.includes(selectedTag);
      return categoryMatch && tagMatch;
    });
  }, [initialArticles, selectedCategory, selectedTag]);

  const handleToggleSave = (article: LegacyArticle) => {
    const currentlySaved = saved.includes(article.slug);
    const nextSaved = !currentlySaved;
    applyOptimisticSave({ slug: article.slug, saved: nextSaved });
    setPendingSlug(article.slug);

    startTransition(async () => {
      try {
        await toggleLegacyArticleSave(article.slug, nextSaved);
      } catch (error) {
        console.error(error);
        applyOptimisticSave({ slug: article.slug, saved: currentlySaved });
      } finally {
        setPendingSlug(value => (value === article.slug ? null : value));
      }
    });
  };

  return (
    <div className="stack stack--lg">
      <section className="stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Knowledge base</h2>
            <p className="text-subtle" style={{ margin: 0 }}>Migrated long-form content from the original TronRelic release, refreshed for the React experience.</p>
          </div>
          <div className="stack stack--sm" style={{ minWidth: '220px' }}>
            <label className="text-subtle" htmlFor="article-category-filter">Filter by category</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }} id="article-category-filter">
              {categories.map(category => (
                <Button
                  key={category}
                  size="sm"
                  variant={selectedCategory === category ? 'primary' : 'ghost'}
                  aria-pressed={selectedCategory === category}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="stack stack--sm" aria-live="polite">
            <span className="text-subtle" style={{ fontSize: '0.85rem' }}>Popular tags</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              <Button
                size="sm"
                variant={!selectedTag ? 'secondary' : 'ghost'}
                aria-pressed={!selectedTag}
                onClick={() => setSelectedTag(null)}
              >
                All tags
              </Button>
              {tags.map(tag => (
                <Button
                  key={tag}
                  size="sm"
                  variant={selectedTag === tag ? 'secondary' : 'ghost'}
                  aria-pressed={selectedTag === tag}
                  onClick={() => setSelectedTag(tag)}
                >
                  #{tag}
                </Button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="grid grid--responsive">
        {filteredArticles.map(article => {
          const isSaved = saved.includes(article.slug);
          return (
            <Card key={article.slug} padding="md" className="stack" elevated={article.featured}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div className="stack stack--sm">
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Badge tone={article.featured ? 'success' : 'neutral'}>{article.category}</Badge>
                    <span className="text-subtle" style={{ fontSize: '0.8rem' }}>
                      Updated {dateFormatter.format(new Date(article.updatedAt))}
                    </span>
                  </div>
                  <h3 style={{ margin: 0 }}>{article.title}</h3>
                  <p className="text-subtle" style={{ margin: 0 }}>{article.excerpt}</p>
                </div>
                <div className="stack stack--sm" style={{ minWidth: '160px', alignItems: 'flex-end' }}>
                  <Badge tone="neutral">~{article.readingTimeMinutes} min read</Badge>
                  <Button
                    variant={isSaved ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => handleToggleSave(article)}
                    loading={pendingSlug === article.slug}
                    aria-pressed={isSaved}
                    aria-label={`${isSaved ? 'Remove' : 'Save'} ${article.title} to your reading list`}
                  >
                    {isSaved ? 'Saved' : 'Save for later'}
                  </Button>
                  <a
                    href={article.href}
                    className="chip"
                    aria-label={`Open ${article.title}`}
                  >
                    View legacy page
                  </a>
                </div>
              </div>
              <footer style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {article.tags.map(tag => (
                  <Badge key={`${article.slug}-${tag}`} tone="neutral">#{tag}</Badge>
                ))}
              </footer>
            </Card>
          );
        })}
        {!filteredArticles.length && (
          <Card tone="muted" padding="lg">
            <p className="text-subtle" style={{ margin: 0 }}>Nothing matches your current filters. Try selecting a different category or tag.</p>
          </Card>
        )}
      </section>
    </div>
  );
}
