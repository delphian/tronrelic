import { LegacyGridSkeleton } from '../../../components/legacy/LegacySkeletons';

export default function ToolsLoading() {
  return (
    <main>
      <div className="page">
        <section className="page-header">
          <h1 className="page-title">Legacy toolset</h1>
          <p className="page-subtitle">Preparing calculators…</p>
        </section>
        <LegacyGridSkeleton count={4} />
      </div>
    </main>
  );
}
