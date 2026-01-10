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
export { MainHeader, MainHeaderControls } from './MainHeader';
export { MenuNavSSR, MenuNavClient } from './MenuNav';
