import { Router } from 'express';
import type { CatalogRepository } from '../../ca_domain/ports';
import * as s from '../schemas';
import { route, id } from './shared';
import { authorize } from '../security';
export function createUsersRouter(catalog: CatalogRepository) {
  const router = Router();
  router.use('/user', authorize('admin'));
  router.get('/user/name/:name', route('/api/user/name/:name'), async (req, res) => {
    res.json(
      await catalog.listUsers(s.pagination.parse(req.query), s.nameParam.parse(req.params.name)),
    );
  });
  router.get('/user', route('/api/user'), async (req, res) => {
    res.json(await catalog.listUsers(s.pagination.parse(req.query)));
  });
  router.get('/user/id/:id', route('/api/user/id/:id'), async (req, res) => {
    res.json(await catalog.getUser(id(req.params.id)));
  });
  router.post('/user', route('/api/user'), async (req, res) => {
    res.status(201).json(await catalog.createUser(s.userCreate.parse(req.body)));
  });
  router.put('/user/:id', route('/api/user/:id'), async (req, res) => {
    res.json(await catalog.updateUser(id(req.params.id), s.userUpdate.parse(req.body)));
  });
  router.delete('/user/:id', route('/api/user/:id'), async (req, res) => {
    await catalog.deleteUser(id(req.params.id));
    res.sendStatus(204);
  });
  return router;
}
