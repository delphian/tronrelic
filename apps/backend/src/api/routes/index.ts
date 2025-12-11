import { Router } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { blockchainRouter } from './blockchain.router.js';
import { accountsRouter } from './accounts.router.js';
import { transactionsRouter } from './transactions.router.js';
import { transactionRouter } from './transaction.router.js';
import { notificationsRouter } from './notifications.router.js';
import { toolsRouter } from './tools.router.js';
import { inflowsRouter } from './inflows.router.js';
import { outflowsRouter } from './outflows.router.js';
import { dashboardRouter } from './dashboard.router.js';
import { energyRouter } from './energy.router.js';
import { base58checkRouter } from './base58check.router.js';
import { liveRouter } from './live.router.js';
import { tokensRouter } from './tokens.router.js';
import { systemRouter } from './system.router.js';
import { configRouter } from './config.router.js';
import { widgetRouter } from './widget.router.js';
import pluginsRouter from './plugins.routes.js';
import pluginManagementRouter from './plugin-management.routes.js';
import { PluginApiService } from '../../services/plugin-api.service.js';

/**
 * Create the main API router with all route handlers.
 *
 * Routers that require database access receive the shared coreDatabase instance
 * via dependency injection. This ensures all routers use the same DatabaseService
 * instance with a unified model registry.
 *
 * @param database - Shared database service instance from bootstrap
 * @returns Express router with all API routes mounted
 */
export function createApiRouter(database: IDatabaseService) {
  const router = Router();

  // Routers without database dependency
  router.use('/config', configRouter());
  router.use('/blockchain', blockchainRouter());
  router.use('/energy', energyRouter());
  router.use('/base58check', base58checkRouter());
  router.use('/widgets', widgetRouter());
  router.use('/plugins', pluginsRouter);
  router.use('/plugin-management', pluginManagementRouter);

  // Routers with database dependency - inject shared instance
  router.use('/accounts', accountsRouter(database));
  router.use('/transactions', transactionsRouter(database));
  router.use('/transaction', transactionRouter(database));
  router.use('/inflows', inflowsRouter(database));
  router.use('/outflows', outflowsRouter(database));
  router.use('/notifications', notificationsRouter(database));
  router.use('/tools', toolsRouter(database));
  router.use('/live', liveRouter(database));
  router.use('/tokens', tokensRouter(database));
  router.use('/admin/system', systemRouter(database));
  router.use('/dashboard', dashboardRouter(database));

  // Note: Menu, Pages, and Database (migrations) routers are mounted directly
  // by their respective modules in bootstrap (apps/backend/src/index.ts) to follow
  // the IModule pattern with proper dependency injection and lifecycle management

  // Mount plugin API routes (dynamic plugins)
  const pluginApiService = PluginApiService.getInstance();
  router.use('/plugins', pluginApiService.getRouter());

  return router;
}
