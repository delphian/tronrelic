/**
 * @fileoverview Public API of the frontend MCP module: the admin page's API client.
 */

export {
    MCP_APPS_PAGE_SIZE,
    getMcpStatus,
    setMcpEnabled,
    listMcpTools,
    setMcpToolExposure,
    listMcpApps,
    revokeMcpApp
} from './api/client';
