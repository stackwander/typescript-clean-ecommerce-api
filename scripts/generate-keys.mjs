import { randomBytes } from 'node:crypto';
for (const name of ['API_READ_KEY', 'API_WRITE_KEY', 'API_ADMIN_KEY', 'GRAFANA_ADMIN_PASSWORD']) {
  console.log(`${name}=${randomBytes(32).toString('hex')}`);
}
