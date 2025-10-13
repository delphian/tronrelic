import { LegacyGridSkeleton } from '../../../components/legacy/LegacySkeletons';

export default function ArticlesLoading() {
  return (
    <main>
      <div className="page">
        <section className="page-header">
          <h1 className="page-title">Legacy articles &amp; guides</h1>
          <p className="page-subtitle">Loading historical content…</p>
        </section>
        <LegacyGridSkeleton count={6} />
      </div>
    </main>
  );
}
