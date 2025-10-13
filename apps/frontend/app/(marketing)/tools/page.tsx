import { fetchLegacyTools } from '../../../lib/legacyContent';
import { ToolsCatalog } from '../../../components/legacy/ToolsCatalog';
import { absoluteUrl, buildMetadata } from '../../../lib/seo';

export const revalidate = 3600;

export const metadata = buildMetadata({
  title: 'TRON Energy & Analytics Tools | TronRelic Library',
  description: 'Jump into TronRelic’s toolkit for energy estimations, delegation planning, and signature verification while new React-native tools roll out.',
  path: '/tools',
  keywords: ['TRON tools', 'TRON energy calculator', 'TRON delegation planner']
});

export default async function ToolsPage() {
  const tools = await fetchLegacyTools();
  const toolStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: tools.map((tool, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: tool.title,
      url: absoluteUrl(tool.href)
    }))
  };

  return (
    <main>
      <div className="page">
        <section className="page-header">
          <h1 className="page-title">Legacy toolset</h1>
          <p className="page-subtitle">Access the original calculators and helper utilities while they are refactored into the new React-driven UX.</p>
        </section>
        <ToolsCatalog initialTools={tools} />
      </div>
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(toolStructuredData) }}
      />
    </main>
  );
}
