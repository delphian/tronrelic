import { fetchLegacyForumSpaces } from '../../../lib/legacyContent';
import { ForumHub } from '../../../components/legacy/ForumHub';
import { buildMetadata } from '../../../lib/seo';

export const revalidate = 3600;

export const metadata = buildMetadata({
  title: 'Signed TRON Forum | TronRelic Community Discussions',
  description: 'Explore wallet-authenticated TRON community spaces covering infrastructure ops, market desks, and builder Q&A.',
  path: '/forum',
  keywords: ['TRON forum', 'TRON community', 'wallet signed forum']
});

export default async function ForumPage() {
  const spaces = await fetchLegacyForumSpaces();

  return (
    <div className="page">
      <section className="page-header">
        <h1 className="page-title">Signed forum</h1>
        <p className="page-subtitle">Wallet-authenticated discussions continue to live here until the Socket.io powered replacement ships.</p>
      </section>
      <ForumHub initialSpaces={spaces} />
    </div>
  );
}
