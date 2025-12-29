import { Page, PageHeader, Stack, Grid } from '../../components/layout';
import { Skeleton } from '../../components/ui/Skeleton';
import { Card } from '../../components/ui/Card';

export default function DashboardLoading() {
  return (
    <Page>
      <PageHeader
        title={<Skeleton style={{ width: '36%', height: '2.3rem' }} />}
        subtitle={<Skeleton style={{ width: '52%', height: '1.1rem' }} />}
      />
      <Grid columns="responsive">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <Stack>
              <Skeleton style={{ height: '1.3rem' }} />
              <Skeleton style={{ height: '1rem', width: '80%' }} />
              <Skeleton style={{ height: '8rem' }} />
            </Stack>
          </Card>
        ))}
      </Grid>
    </Page>
  );
}
