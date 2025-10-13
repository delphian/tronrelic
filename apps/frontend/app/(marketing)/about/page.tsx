import { buildMetadata } from '../../../lib/seo';

export const revalidate = 3600;

export const metadata = buildMetadata({
  title: 'About TronRelic | Mission, Infrastructure & Wallet Security',
  description: 'Learn how TronRelic blends MongoDB, WebSockets, and wallet-native authentication to deliver real-time TRON energy intelligence.',
  path: '/about',
  keywords: ['TronRelic team', 'TRON analytics platform', 'TRON energy tools']
});

export default function AboutPage() {
  const items = [
    {
      title: 'Realtime Market Intelligence',
      description: 'Comparative metrics for 13+ TRON energy rental platforms refreshed every five minutes.'
    },
    {
      title: 'Full-Stack Migration',
      description: 'MongoDB persistence, WebSocket delivery, and a modern React UI replace the legacy serverless stack.'
    },
    {
      title: 'Wallet-Native Interactions',
      description: 'Comments, chat, and preferences remain protected through signature-based authentication.'
    }
  ];

  return (
    <main>
      <section>
        <h1>About TronRelic</h1>
        <p style={{ maxWidth: '640px', opacity: 0.7 }}>
          TronRelic 2.0 advances the platform with real-time infrastructure, improved observability, and an extensible microservices-inspired domain model that mirrors Section 4 of the migration SPEC.
        </p>
      </section>
      <section style={{ marginTop: '2rem', display: 'grid', gap: '1.25rem' }}>
        {items.map(item => (
          <article key={item.title} className="card">
            <h2>{item.title}</h2>
            <p style={{ opacity: 0.8 }}>{item.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
