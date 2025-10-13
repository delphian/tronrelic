import { Skeleton } from '../../components/ui/Skeleton';
import { Card } from '../../components/ui/Card';

export default function DashboardLoading() {
  return (
    <div className="page">
      <section className="page-header">
        <Skeleton style={{ width: '36%', height: '2.3rem' }} />
        <Skeleton style={{ width: '52%', height: '1.1rem' }} />
      </section>
      <div className="grid grid--responsive">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <div className="stack">
              <Skeleton style={{ height: '1.3rem' }} />
              <Skeleton style={{ height: '1rem', width: '80%' }} />
              <Skeleton style={{ height: '8rem' }} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
