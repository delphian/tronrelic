import { LegacyListSkeleton } from '../../../components/legacy/LegacySkeletons';

export default function ForumLoading() {
  return (
    <main>
      <div className="page">
        <section className="page-header">
          <h1 className="page-title">Signed forum</h1>
          <p className="page-subtitle">Loading forum spaces…</p>
        </section>
        <LegacyListSkeleton count={4} />
      </div>
    </main>
  );
}
