import { Router } from 'express';
import { Base58Controller } from '../../modules/tools/base58.controller.js';

export function base58checkRouter() {
  const router = Router();
  const controller = new Base58Controller();

  router.post('/hex-to-base58check', controller.hexToBase58);

  return router;
}
