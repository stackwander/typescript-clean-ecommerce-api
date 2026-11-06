import { Router } from 'express';
import type { OrderService } from '../../ca_application/orders';
import * as s from '../schemas';
import { route, id } from './shared';
import { authorize, hasAccess } from '../security';
import { AppError } from '../../ca_domain/errors';
export function createOrdersRouter(orders: OrderService) {
  const router = Router();
  router.get(
    '/order/customer/:customerId',
    route('/api/order/customer/:customerId'),
    async (req, res) => {
      res.json(await orders.list(s.pagination.parse(req.query), id(req.params.customerId)));
    },
  );
  router.get('/order', route('/api/order'), async (req, res) => {
    res.json(await orders.list(s.pagination.parse(req.query)));
  });
  router.get('/order/:id', route('/api/order/:id'), async (req, res) => {
    res.json(await orders.get(id(req.params.id)));
  });
  router.post('/order', route('/api/order'), authorize('write'), async (req, res) => {
    res
      .status(201)
      .json(
        await orders.create(
          s.orderCreate.parse(req.body),
          s.idempotencyKey.parse(req.get('Idempotency-Key')),
        ),
      );
  });
  router.put('/order/:id', route('/api/order/:id'), authorize('write'), async (req, res) => {
    const input = s.orderUpdate.parse(req.body);
    if ((input.paid !== undefined || input.status === 'shipped') && !hasAccess(res, 'admin'))
      throw new AppError(
        403,
        'FORBIDDEN',
        'Payment confirmation and shipping require admin access',
      );
    res.json(await orders.update(id(req.params.id), input));
  });
  router.delete('/order/:id', route('/api/order/:id'), authorize('write'), async (req, res) => {
    await orders.delete(id(req.params.id));
    res.sendStatus(204);
  });

  return router;
}
