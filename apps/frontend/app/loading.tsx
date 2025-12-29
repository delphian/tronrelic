import { Page, PageHeader, Stack } from '../components/layout';
import { Skeleton } from '../components/ui/Skeleton';
import { Card } from '../components/ui/Card';

export default function RootLoading() {
  return (
    <Page>
      <PageHeader
        title={<Skeleton style={{ width: '48%', height: '2.6rem' }} />}
        subtitle={<Skeleton style={{ width: '60%', height: '1.2rem' }} />}
      />
      <Card>
        <Stack>
          <Skeleton style={{ height: '1.4rem' }} />
          <Skeleton style={{ height: '1.4rem', width: '90%' }} />
          <Skeleton style={{ height: '1.4rem', width: '80%' }} />
          <Skeleton style={{ height: '1.4rem', width: '70%' }} />
        </Stack>
      </Card>
    </Page>
  );
}
