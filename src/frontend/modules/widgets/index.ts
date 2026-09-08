/**
 * @fileoverview Public API of the widgets admin module: the `/system/widgets`
 * shell, the placement editor it hosts, and the types the server entry
 * hands them. Server-only helpers live in `./server`.
 *
 * @module modules/widgets
 */

export { WidgetsAdminClient } from './components/WidgetsAdminClient';
export { PlacementsWorkbench } from './components/PlacementsWorkbench';
export type { IWidgetsAdminData, IPageOption, EditorTarget } from './types';
