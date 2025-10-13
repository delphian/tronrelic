import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';

interface LegacyGridSkeletonProps {
  count?: number;
}

function LegacyCardSkeleton() {
  return (
    <Card tone="muted" padding="md" className="stack">
      <Skeleton style={{ width: '45%', height: '1.4rem' }} />
      <Skeleton style={{ width: '68%', height: '1rem' }} />
      <Skeleton style={{ width: '90%', height: '1rem' }} />
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Skeleton style={{ width: '90px', height: '0.85rem' }} />
        <Skeleton style={{ width: '80px', height: '0.85rem' }} />
        <Skeleton style={{ width: '70px', height: '0.85rem' }} />
      </div>
    </Card>
  );
}

export function LegacyGridSkeleton({ count = 6 }: LegacyGridSkeletonProps) {
  return (
    <div className="grid grid--responsive">
      {Array.from({ length: count }).map((_, index) => (
        <LegacyCardSkeleton key={`legacy-skeleton-${index}`} />
      ))}
    </div>
  );
}

export function LegacyListSkeleton({ count = 4 }: LegacyGridSkeletonProps) {
  return (
    <div className="stack">
      {Array.from({ length: count }).map((_, index) => (
        <Card tone="muted" padding="sm" key={`legacy-list-skeleton-${index}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <Skeleton style={{ width: '40%', height: '1.2rem' }} />
            <Skeleton style={{ width: '20%', height: '0.95rem' }} />
          </div>
          <Skeleton style={{ width: '65%', height: '0.9rem', marginTop: '0.75rem' }} />
        </Card>
      ))}
    </div>
  );
}
