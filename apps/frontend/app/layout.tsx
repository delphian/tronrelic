import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { config } from '../lib/config';
import { buildMetadata, SITE_NAME } from '../lib/seo';
import './globals.css';
import { Providers } from './providers';
import { NavBar } from '../components/layout/NavBar';
import { BlockTicker } from '../components/layout/BlockTicker';

const rootMetadata = buildMetadata({
  title: 'Live TRON Blockchain Stats – Track Activity & Rent Energy | TronRelic',
  description: 'Explore live TRON blockchain metrics on TronRelic, including recent large stakes, energy delegations, and new token creations. Compare real-time TRON energy rental rates to optimize your transactions.',
  path: '/',
  keywords: [
    'TRON energy',
    'TRX staking',
    'TRON delegation',
    'TRON resource market',
    'TRON blockchain analytics'
  ]
});

export const metadata: Metadata = {
  ...rootMetadata,
  metadataBase: new URL(config.siteUrl),
  applicationName: SITE_NAME,
  category: 'Technology',
  openGraph: {
    ...rootMetadata.openGraph,
    locale: 'en_US'
  },
  twitter: {
    ...rootMetadata.twitter,
    creator: '@TronRelic'
  },
  robots: {
    index: true,
    follow: true
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <NavBar />
          <BlockTicker />
          <main>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
