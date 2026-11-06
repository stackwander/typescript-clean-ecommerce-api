import { Router } from 'express';
import type { CatalogRepository } from '../../ca_domain/ports';
import * as s from '../schemas';
import { route, id } from './shared';
import { authorize } from '../security';
export function createCatalogRouter(catalog: CatalogRepository) {
  const router = Router();
  router.get('/customer/name/:name', route('/api/customer/name/:name'), async (req, res) => {
    res.json(
      await catalog.listCustomers(
        s.pagination.parse(req.query),
        s.nameParam.parse(req.params.name),
      ),
    );
  });
  router.get('/customer', route('/api/customer'), async (req, res) => {
    res.json(await catalog.listCustomers(s.pagination.parse(req.query)));
  });
  router.get('/customer/:id', route('/api/customer/:id'), async (req, res) => {
    res.json(await catalog.getCustomer(id(req.params.id)));
  });
  router.post('/customer', route('/api/customer'), authorize('write'), async (req, res) => {
    res.status(201).json(await catalog.createCustomer(s.customerCreate.parse(req.body)));
  });
  router.put('/customer/:id', route('/api/customer/:id'), authorize('write'), async (req, res) => {
    res.json(await catalog.updateCustomer(id(req.params.id), s.customerUpdate.parse(req.body)));
  });
  router.delete(
    '/customer/:id',
    route('/api/customer/:id'),
    authorize('write'),
    async (req, res) => {
      await catalog.deleteCustomer(id(req.params.id));
      res.sendStatus(204);
    },
  );

  router.get('/product/name/:name', route('/api/product/name/:name'), async (req, res) => {
    res.json(
      await catalog.listProducts(s.pagination.parse(req.query), s.nameParam.parse(req.params.name)),
    );
  });
  router.get('/product', route('/api/product'), async (req, res) => {
    res.json(await catalog.listProducts(s.pagination.parse(req.query)));
  });
  router.get('/product/:id', route('/api/product/:id'), async (req, res) => {
    res.json(await catalog.getProduct(id(req.params.id)));
  });
  router.post('/product', route('/api/product'), authorize('write'), async (req, res) => {
    res.status(201).json(await catalog.createProduct(s.productCreate.parse(req.body)));
  });
  router.put('/product/:id', route('/api/product/:id'), authorize('write'), async (req, res) => {
    res.json(await catalog.updateProduct(id(req.params.id), s.productUpdate.parse(req.body)));
  });
  router.post(
    '/product/:id/stock',
    route('/api/product/:id/stock'),
    authorize('write'),
    async (req, res) => {
      res.json(
        await catalog.adjustStock(id(req.params.id), s.stockAdjustment.parse(req.body).delta),
      );
    },
  );
  router.delete('/product/:id', route('/api/product/:id'), authorize('write'), async (req, res) => {
    await catalog.deleteProduct(id(req.params.id));
    res.sendStatus(204);
  });

  return router;
}
