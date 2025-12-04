import type { Metadata } from 'next';
import { CurrentBlock } from '../features/blockchain/components';
import { buildMetadata } from '../lib/seo';
import { getServerConfig } from '../lib/serverConfig';
import { getApiUrl } from '../lib/config';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { siteUrl } = await getServerConfig();

  return buildMetadata({
    siteUrl,
    title: 'Live TRON Blockchain Activity & Energy Tools | TronRelic',
    description: 'Explore live TRON network activity and discover the best way to rent energy. Powered by real-time graphs, alerts, and deep market data.',
    path: '/',
    keywords: [
      'TRON analytics',
      'TRON energy market',
      'TRX staking tools',
      'TRON blockchain monitoring',
      'TRON delegation alerts'
    ]
  });
}

export default async function HomePage(): Promise<JSX.Element> {
  // Fetch initial block data for SSR - component renders fully without loading flash
  let initialBlock = null;
  try {
    const response = await fetch(getApiUrl('/blockchain/latest'), { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      initialBlock = data.block;
    }
  } catch (error) {
    console.error('Failed to fetch initial block for SSR:', error);
    // SSR fetch failed - component will show loading state until WebSocket connects
  }

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Where can I find the cheapest TRON energy rental rates?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Use a real-time comparison tool to monitor TRON energy desks. TronRelic provides live pricing intel across rental marketplaces so you can source the lowest rates.'
        }
      },
      {
        '@type': 'Question',
        name: 'What is TRON energy and why do I need to rent it?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'TRON energy powers smart contract execution without paying network fees. Renting energy keeps transaction costs predictable for builders and high-volume wallet operators.'
        }
      },
      {
        '@type': 'Question',
        name: 'How does TronRelic help with TRON energy rentals?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'TronRelic compares live market depth, availability, and effective pricing so you can rent TRON energy confidently with data-backed decisions.'
        }
      },
      {
        '@type': 'Question',
        name: 'How do I set up TRON energy rental permissions?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Configure TronScan active permissions to authorize delegation desks. TronRelic includes migration guides that walk through multisig safety and permission scoping.'
        }
      },
      {
        '@type': 'Question',
        name: 'What is TRON TRX staking and what are its benefits?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Staking TRX supports TRON consensus and earns energy or bandwidth rewards. TronRelic visualizes staking yields, delegation ROI, and historical churn to inform your strategy.'
        }
      }
    ]
  } as const;

  return (
    <div className="page">
      <section>
        <CurrentBlock initialBlock={initialBlock} />
      </section>
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </div>
  );
}
