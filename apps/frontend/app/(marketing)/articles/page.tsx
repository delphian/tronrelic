import { fetchLegacyArticles } from '../../../lib/legacyContent';
import { ArticlesList } from '../../../components/legacy/ArticlesList';
import { buildArticleListStructuredData, buildMetadata } from '../../../lib/seo';

export const revalidate = 3600;

export const metadata = buildMetadata({
  title: 'TRON Articles & Guides | TronRelic Knowledge Base',
  description: 'Browse curated research on TRON staking, delegation flows, and resource markets migrated from the original TronRelic launch.',
  path: '/articles',
  type: 'article',
  keywords: ['TRON guides', 'TRON research', 'TRON staking articles']
});

export default async function ArticlesPage() {
  const articles = await fetchLegacyArticles();
  const structuredData = buildArticleListStructuredData(articles);

  return (
    <div className="page">
      <section className="page-header">
        <h1 className="page-title">Legacy articles &amp; guides</h1>
        <p className="page-subtitle">Browse the classic Eleventy-powered knowledge base while the Next.js migration rolls out in phases.</p>
      </section>
      <ArticlesList initialArticles={articles} />
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </div>
  );
}
