// TODO: Fix import path for LegacyGridSkeleton component
// import { LegacyGridSkeleton } from '../../../components/legacy/LegacySkeletons';

export default function ArticlesLoading() {
  return (
    <div className="page">
      <section className="page-header">
        <h1 className="page-title">Legacy articles &amp; guides</h1>
        <p className="page-subtitle">Loading historical content…</p>
      </section>
      {/* TODO: Re-enable once LegacyGridSkeleton component is available */}
      {/* <LegacyGridSkeleton count={6} /> */}
      <div>Loading...</div>
    </div>
  );
}
