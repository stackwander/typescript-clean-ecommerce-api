import { createHash } from 'node:crypto';
import type { OrderInput, OrderUpdate, Page } from '../ca_domain/models';
import type { OrderRepository } from '../ca_domain/ports';
import { conflict } from '../ca_domain/errors';
export function assertTransition(
  current: { status: string; paid: boolean },
  update: OrderUpdate,
): void {
  const nextStatus = update.status ?? current.status;
  const nextPaid = update.paid ?? current.paid;
  if (update.orderItems && nextPaid)
    throw conflict('Confirm any refund before changing paid order items');
  if (
    current.status !== 'pending' &&
    (update.orderItems ||
      (update.status && update.status !== current.status) ||
      (update.paid !== undefined && update.paid !== current.paid))
  ) {
    throw conflict('Shipped and cancelled orders cannot change items, payment or status');
  }
  if (nextStatus === 'shipped' && !nextPaid) throw conflict('Confirm payment before shipping');
  if (nextStatus === 'cancelled' && nextPaid)
    throw conflict('Confirm any refund before cancellation');
  if (nextStatus !== 'pending' && update.orderItems)
    throw conflict('Change items before shipping or cancellation');
}
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly currency: string,
  ) {}
  list(page: Page, customerId?: string) {
    return this.orders.list(page, customerId);
  }
  get(id: string) {
    return this.orders.get(id);
  }
  create(input: OrderInput, key: string) {
    const normalized = {
      customerId: input.customerId,
      comments: input.comments,
      shippingDate: input.shippingDate,
      orderItems: [...input.orderItems].sort((a, b) => a.productId.localeCompare(b.productId)),
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return this.orders.create(normalized, key, fingerprint, this.currency);
  }
  update(id: string, input: OrderUpdate) {
    return this.orders.update(id, input);
  }
  delete(id: string) {
    return this.orders.delete(id);
  }
}
