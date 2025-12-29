import { Page, PageHeader } from '../../../components/layout';

// TODO: Fix import path for LegacyGridSkeleton component
// import { LegacyGridSkeleton } from '../../../components/legacy/LegacySkeletons';

export default function ArticlesLoading() {
  return (
    <Page>
      <PageHeader
        title="Legacy articles & guides"
        subtitle="Loading historical content…"
      />
      {/* TODO: Re-enable once LegacyGridSkeleton component is available */}
      {/* <LegacyGridSkeleton count={6} /> */}
      <div>Loading...</div>
    </Page>
  );
}
