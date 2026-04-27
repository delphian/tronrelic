/**
 * Layout Components Barrel Export
 *
 * Provides component-first layout primitives for page structure.
 * These components replace CSS utility classes (.page, .stack, .grid)
 * with type-safe React components that provide:
 *
 * - TypeScript safety with props autocomplete
 * - Encapsulated responsive behavior
 * - Consistent gap spacing across the application
 *
 * @example
 * ```tsx
 * import { Page, PageHeader, Stack, Grid, Section } from '../../../components/layout';
 *
 * export function DashboardPage() {
 *   return (
 *     <Page>
 *       <PageHeader title="Dashboard" subtitle="Overview" />
 *       <Section>
 *         <Grid columns="responsive">
 *           <Card>Widget 1</Card>
 *           <Card>Widget 2</Card>
 *         </Grid>
 *       </Section>
 *     </Page>
 *   );
 * }
 * ```
 */

// Layout primitives
export { Page } from './Page';
export { PageHeader } from './PageHeader';
export { Stack } from './Stack';
export { Grid } from './Grid';
export { Section } from './Section';

// Existing layout components
export { BlockTicker } from './BlockTicker';

// MainHeader and MenuNav are intentionally NOT re-exported here.
//
// MenuNavSSR uses next/headers (server-only), and MainHeader transitively
// imports MenuNavSSR. Re-exporting either from a barrel that Client Components
// also consume (e.g. app/global-error.tsx, modules/user/.../GscSettings.tsx)
// drags next/headers into the client bundle and breaks the webpack build —
// even when the Client Component only imports an unrelated primitive like
// <Page>, because tree-shaking can't statically prune through a side-effecting
// barrel chain.
//
// Keep this barrel uniformly client-safe (only leaf layout primitives that
// have no server-only dependencies). Import server-rendered chrome directly:
//   import { MainHeader } from '@/components/layout/MainHeader';
//   import { MenuNavSSR } from '@/components/layout/MenuNav';
