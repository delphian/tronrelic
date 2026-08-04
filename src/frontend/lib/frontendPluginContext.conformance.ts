/**
 * Type-level conformance guard for the plugin frontend context.
 *
 * Why this file exists: every component published on `context.ui`,
 * `context.layout`, `context.charts`, and `context.system` has its props
 * declared in the types package and implemented separately in core. The
 * assignment in `frontendPluginContext.tsx` looks like it ties the two
 * together, but it only checks the props the two shapes share. Because React
 * props are nearly always all-optional, a prop that is *declared and never
 * implemented* passes that check silently — plugins then pass it, typecheck
 * green, and watch it get dropped at runtime. That is exactly how
 * `SchedulerMonitor.token` and `Skeleton.width`/`height` shipped broken.
 *
 * This file closes that gap. For each published component it asserts that no
 * declared prop is missing from the implementation. It emits no runtime code
 * — every construct below is a type alias, so the guard costs a compile and
 * nothing else, and it fails `tsc` the moment a declaration drifts.
 *
 * When this file fails to compile, the error names the offending props:
 *
 *     Type '{ PROPS_DECLARED_BUT_NOT_IMPLEMENTED: "token"; }'
 *     does not satisfy the constraint 'true'.
 *
 * Fix it by making the declaration and the implementation agree — preferably
 * by publishing a props interface in the types package and importing it from
 * the component, as `ISchedulerMonitorProps` and `ISkeletonProps` do.
 *
 * Adding a component to the context? Add a matching block here.
 */
import type { ComponentProps } from 'react';
import type { IUIComponents, ILayoutComponents, IChartComponents, ISystemComponents } from '@/types';
import type { Card as Impl_Card } from '../components/ui/Card';
import type { Badge as Impl_Badge } from '../components/ui/Badge';
import type { Skeleton as Impl_Skeleton } from '../components/ui/Skeleton';
import type { StatTile as Impl_StatTile } from '../components/ui/StatTile';
import type { StatGrid as Impl_StatGrid } from '../components/ui/StatTile';
import type { Button as Impl_Button } from '../components/ui/Button';
import type { CopyButton as Impl_CopyButton } from '../components/ui/CopyButton';
import type { IconButton as Impl_IconButton } from '../components/ui/IconButton';
import type { Switch as Impl_Switch } from '../components/ui/Switch';
import type { SegmentedControl as Impl_SegmentedControl } from '../components/ui/SegmentedControl';
import type { Input as Impl_Input } from '../components/ui/Input';
import type { Select as Impl_Select } from '../components/ui/Select';
import type { Textarea as Impl_Textarea } from '../components/ui/Textarea';
import type { ClientTime as Impl_ClientTime } from '../components/ui/ClientTime';
import type { Tooltip as Impl_Tooltip } from '../components/ui/Tooltip';
import type { TronAddress as Impl_TronAddress } from '../components/ui/TronAddress';
import type { LazyIconPickerModal as Impl_IconPickerModal } from '../components/ui/IconPickerModal';
import type { ConfirmDialog as Impl_ConfirmDialog } from '../components/ui/ConfirmDialog';
import type { AccountPicker as Impl_AccountPicker } from '../components/ui/AccountPicker';
import type { AddressSelector as Impl_AddressSelector } from '../components/ui/AddressSelector';
import type { Table as Impl_Table } from '../components/ui/Table';
import type { Thead as Impl_Thead } from '../components/ui/Table';
import type { Tbody as Impl_Tbody } from '../components/ui/Table';
import type { Tr as Impl_Tr } from '../components/ui/Table';
import type { Th as Impl_Th } from '../components/ui/Table';
import type { Td as Impl_Td } from '../components/ui/Table';
import type { Page as Impl_Page } from '../components/layout';
import type { PageHeader as Impl_PageHeader } from '../components/layout';
import type { Stack as Impl_Stack } from '../components/layout';
import type { Grid as Impl_Grid } from '../components/layout';
import type { Section as Impl_Section } from '../components/layout';
import type { SubMenu as Impl_SubMenu } from '../components/layout/MenuNav/SubMenu';
import type { LineChart as Impl_LineChart } from '../features/charts/components/LineChart';
import type { BarChart as Impl_BarChart } from '../features/charts/components/BarChart';
import type { SchedulerMonitor as Impl_SchedulerMonitor } from '../modules/scheduler';
import type { CollectionBrowser as Impl_CollectionBrowser } from '../modules/database';
import type { ClickHouseTableBrowser as Impl_ClickHouseTableBrowser } from '../modules/database';

/**
 * The props a declaration exposes to plugins that the implementation would
 * silently ignore at runtime.
 */
type PhantomProps<TDeclared, TActual> = Exclude<keyof TDeclared, keyof TActual>;

/**
 * Resolves to `true` when a declaration and its implementation agree, and
 * otherwise to an object type carrying the offending prop names. The object
 * form exists purely so the compiler prints those names in the failure — a
 * bare `T extends never` constraint reports an unhelpful `string` instead.
 */
type NoPhantomProps<TDeclared, TActual> = [PhantomProps<TDeclared, TActual>] extends [never]
    ? true
    : { PROPS_DECLARED_BUT_NOT_IMPLEMENTED: PhantomProps<TDeclared, TActual> };

/** Fails compilation unless the conformance check resolved to `true`. */
type AssertConformant<T extends true> = T;

// IUIComponents
type _Conformance_Card = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Card']>, ComponentProps<typeof Impl_Card>>>;
type _Conformance_Badge = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Badge']>, ComponentProps<typeof Impl_Badge>>>;
type _Conformance_Skeleton = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Skeleton']>, ComponentProps<typeof Impl_Skeleton>>>;
type _Conformance_StatTile = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['StatTile']>, ComponentProps<typeof Impl_StatTile>>>;
type _Conformance_StatGrid = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['StatGrid']>, ComponentProps<typeof Impl_StatGrid>>>;
type _Conformance_Button = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Button']>, ComponentProps<typeof Impl_Button>>>;
type _Conformance_CopyButton = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['CopyButton']>, ComponentProps<typeof Impl_CopyButton>>>;
type _Conformance_IconButton = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['IconButton']>, ComponentProps<typeof Impl_IconButton>>>;
type _Conformance_Switch = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Switch']>, ComponentProps<typeof Impl_Switch>>>;
type _Conformance_SegmentedControl = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['SegmentedControl']>, ComponentProps<typeof Impl_SegmentedControl>>>;
type _Conformance_Input = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Input']>, ComponentProps<typeof Impl_Input>>>;
type _Conformance_Select = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Select']>, ComponentProps<typeof Impl_Select>>>;
type _Conformance_Textarea = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Textarea']>, ComponentProps<typeof Impl_Textarea>>>;
type _Conformance_ClientTime = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['ClientTime']>, ComponentProps<typeof Impl_ClientTime>>>;
type _Conformance_Tooltip = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Tooltip']>, ComponentProps<typeof Impl_Tooltip>>>;
type _Conformance_TronAddress = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['TronAddress']>, ComponentProps<typeof Impl_TronAddress>>>;
type _Conformance_IconPickerModal = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['IconPickerModal']>, ComponentProps<typeof Impl_IconPickerModal>>>;
type _Conformance_ConfirmDialog = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['ConfirmDialog']>, ComponentProps<typeof Impl_ConfirmDialog>>>;
type _Conformance_AccountPicker = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['AccountPicker']>, ComponentProps<typeof Impl_AccountPicker>>>;
type _Conformance_AddressSelector = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['AddressSelector']>, ComponentProps<typeof Impl_AddressSelector>>>;
type _Conformance_Table = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Table']>, ComponentProps<typeof Impl_Table>>>;
type _Conformance_Thead = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Thead']>, ComponentProps<typeof Impl_Thead>>>;
type _Conformance_Tbody = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Tbody']>, ComponentProps<typeof Impl_Tbody>>>;
type _Conformance_Tr = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Tr']>, ComponentProps<typeof Impl_Tr>>>;
type _Conformance_Th = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Th']>, ComponentProps<typeof Impl_Th>>>;
type _Conformance_Td = AssertConformant<NoPhantomProps<ComponentProps<IUIComponents['Td']>, ComponentProps<typeof Impl_Td>>>;

// ILayoutComponents
type _Conformance_Page = AssertConformant<NoPhantomProps<ComponentProps<ILayoutComponents['Page']>, ComponentProps<typeof Impl_Page>>>;
type _Conformance_PageHeader = AssertConformant<NoPhantomProps<ComponentProps<ILayoutComponents['PageHeader']>, ComponentProps<typeof Impl_PageHeader>>>;
type _Conformance_Stack = AssertConformant<NoPhantomProps<ComponentProps<ILayoutComponents['Stack']>, ComponentProps<typeof Impl_Stack>>>;
type _Conformance_Grid = AssertConformant<NoPhantomProps<ComponentProps<ILayoutComponents['Grid']>, ComponentProps<typeof Impl_Grid>>>;
type _Conformance_Section = AssertConformant<NoPhantomProps<ComponentProps<ILayoutComponents['Section']>, ComponentProps<typeof Impl_Section>>>;
type _Conformance_SubMenu = AssertConformant<NoPhantomProps<ComponentProps<ILayoutComponents['SubMenu']>, ComponentProps<typeof Impl_SubMenu>>>;

// IChartComponents
type _Conformance_LineChart = AssertConformant<NoPhantomProps<ComponentProps<IChartComponents['LineChart']>, ComponentProps<typeof Impl_LineChart>>>;
type _Conformance_BarChart = AssertConformant<NoPhantomProps<ComponentProps<IChartComponents['BarChart']>, ComponentProps<typeof Impl_BarChart>>>;

// ISystemComponents
type _Conformance_SchedulerMonitor = AssertConformant<NoPhantomProps<ComponentProps<ISystemComponents['SchedulerMonitor']>, ComponentProps<typeof Impl_SchedulerMonitor>>>;
type _Conformance_CollectionBrowser = AssertConformant<NoPhantomProps<ComponentProps<ISystemComponents['CollectionBrowser']>, ComponentProps<typeof Impl_CollectionBrowser>>>;
type _Conformance_ClickHouseTableBrowser = AssertConformant<NoPhantomProps<ComponentProps<ISystemComponents['ClickHouseTableBrowser']>, ComponentProps<typeof Impl_ClickHouseTableBrowser>>>;

export type {};
