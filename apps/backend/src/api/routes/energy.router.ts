import { Router } from 'express';
import { EnergyController } from '../../modules/energy/energy.controller.js';

export function energyRouter() {
  const router = Router();
  const controller = new EnergyController();

  router.post('/account-energy-delegation', controller.accountEnergyDelegation);

  return router;
}
