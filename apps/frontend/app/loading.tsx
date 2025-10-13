import { Skeleton } from '../components/ui/Skeleton';
import { Card } from '../components/ui/Card';

export default function RootLoading() {
  return (
    <main>
      <div className="page">
        <section className="page-header">
          <Skeleton style={{ width: '48%', height: '2.6rem' }} />
          <Skeleton style={{ width: '60%', height: '1.2rem' }} />
        </section>
        <Card>
          <div className="stack">
            <Skeleton style={{ height: '1.4rem' }} />
            <Skeleton style={{ height: '1.4rem', width: '90%' }} />
            <Skeleton style={{ height: '1.4rem', width: '80%' }} />
            <Skeleton style={{ height: '1.4rem', width: '70%' }} />
          </div>
        </Card>
      </div>
    </main>
  );
}
