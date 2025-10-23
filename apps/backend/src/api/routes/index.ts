import { Router } from 'express';
import { marketsRouter } from './markets.router.js';
import { blockchainRouter } from './blockchain.router.js';
import { accountsRouter } from './accounts.router.js';
import { transactionsRouter } from './transactions.router.js';
import { transactionRouter } from './transaction.router.js';
import { notificationsRouter } from './notifications.router.js';
import { toolsRouter } from './tools.router.js';
import { adminMarketsRouter } from './admin-markets.router.js';
import { inflowsRouter } from './inflows.router.js';
import { outflowsRouter } from './outflows.router.js';
import { dashboardRouter } from './dashboard.router.js';
import { energyRouter } from './energy.router.js';
import { base58checkRouter } from './base58check.router.js';
import { liveRouter } from './live.router.js';
import { tokensRouter } from './tokens.router.js';
import { systemRouter } from './system.router.js';
import { menuRouter } from './menu.router.js';
import pluginsRouter from './plugins.routes.js';
import pluginManagementRouter from './plugin-management.routes.js';
import { PluginApiService } from '../../services/plugin-api.service.js';

export function createApiRouter() {
  const router = Router();

  router.use('/markets', marketsRouter());
  router.use('/blockchain', blockchainRouter());
  router.use('/accounts', accountsRouter());
  router.use('/transactions', transactionsRouter());
  router.use('/transaction', transactionRouter());
  router.use('/inflows', inflowsRouter());
  router.use('/outflows', outflowsRouter());
  router.use('/notifications', notificationsRouter());
  router.use('/tools', toolsRouter());
  router.use('/energy', energyRouter());
  router.use('/base58check', base58checkRouter());
  router.use('/live', liveRouter());
  router.use('/tokens', tokensRouter());
  router.use('/admin/markets', adminMarketsRouter());
  router.use('/admin/system', systemRouter());
  router.use('/dashboard', dashboardRouter());
  router.use('/menu', menuRouter());
  router.use('/plugins', pluginsRouter);
  router.use('/plugin-management', pluginManagementRouter);

  // Mount plugin API routes (dynamic plugins)
  const pluginApiService = PluginApiService.getInstance();
  router.use('/plugins', pluginApiService.getRouter());

  return router;
}
