/**
 * @fileoverview Server-only barrel for the widgets admin module.
 *
 * Separate from `index.ts` because these helpers import `next/headers`,
 * which cannot be bundled into a client component. Import from here only
 * in server components such as `app/(core)/system/widgets/page.tsx`.
 *
 * @module modules/widgets/server
 */

export { fetchWidgetsAdminData, fetchMenuNamespace } from './lib/fetchWidgetsAdminData';
