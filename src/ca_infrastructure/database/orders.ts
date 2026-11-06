import { Prisma, PrismaClient } from '@prisma/client';
import type { OrderRepository } from '../../ca_domain/ports';
import type {
  ItemInput,
  Order,
  OrderInput,
  OrderItem,
  OrderUpdate,
  Page,
} from '../../ca_domain/models';
import { conflict, missing } from '../../ca_domain/errors';
import { assertTransition } from '../../ca_application/orders';
import { transaction } from './transactions';

const include = { orderItems: { orderBy: { productId: 'asc' as const } } };
const select = {
  orderId: true,
  customerId: true,
  orderDate: true,
  shippingDate: true,
  status: true,
  comments: true,
  total: true,
  currency: true,
  paid: true,
  deletedAt: true,
  revision: true,
  ...include,
} satisfies Prisma.OrderSelect;
type Tx = Prisma.TransactionClient;

export class PrismaOrders implements OrderRepository {
  constructor(private readonly db: PrismaClient) {}
  async list(page: Page, customerId?: string) {
    const where = { deletedAt: null, ...(customerId ? { customerId } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.order.findMany({
        where,
        select,
        orderBy: { orderId: 'asc' },
        skip: page.offset,
        take: page.limit,
      }),
      this.db.order.count({ where }),
    ]);
    return { items, total, ...page };
  }
  async get(id: string) {
    const order = await this.db.order.findFirst({
      where: { orderId: id, deletedAt: null },
      select,
    });
    if (!order) throw missing('Order');
    return order;
  }
  async create(
    input: OrderInput,
    key: string,
    fingerprint: string,
    currency: string,
  ): Promise<Order> {
    try {
      return await transaction(this.db, async (tx) => {
        const existing = await tx.order.findUnique({ where: { idempotencyKey: key } });
        if (existing) return this.replay(tx, existing, fingerprint);
        // Touch the parent to serialize order creation against customer deletion.
        await tx.customer.update({
          where: { customerCode: input.customerId },
          data: { revision: { increment: 1 } },
        });
        const items = await this.reserve(tx, input.orderItems);
        return tx.order.create({
          data: {
            customerId: input.customerId,
            comments: input.comments,
            shippingDate: input.shippingDate ?? null,
            deletedAt: null,
            currency,
            total: this.total(items),
            idempotencyKey: key,
            requestHash: fingerprint,
            orderItems: { create: items },
          },
          select,
        });
      });
    } catch (error) {
      // A concurrent duplicate key may race with the initial read. Replay only after the winner commits.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.db.order.findUnique({ where: { idempotencyKey: key } });
        if (existing) return this.replay(this.db, existing, fingerprint);
      }
      throw error;
    }
  }
  private async replay(
    tx: Tx,
    existing: { orderId: string; requestHash: string },
    fingerprint: string,
  ) {
    if (existing.requestHash !== fingerprint)
      throw conflict('Idempotency key was used for different input');
    // Tombstones are intentionally replayable; stock is never reserved twice.
    return tx.order.findUniqueOrThrow({ where: { orderId: existing.orderId }, select });
  }
  private total(items: { quantity: number; unitPrice: number }[]): number {
    const result = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    if (!Number.isSafeInteger(result) || result > 2000000000)
      throw conflict('Order total exceeds the supported limit');
    return result;
  }
  private async reserve(tx: Tx, requested: ItemInput[], previous: OrderItem[] = []) {
    const result: {
      productId: string;
      productName: string;
      unitPrice: number;
      quantity: number;
    }[] = [];
    for (const item of [...requested].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const product = await tx.product.findUnique({ where: { productCode: item.productId } });
      if (!product) throw missing('Product');
      const reserved = await tx.product.updateMany({
        where: { productCode: item.productId, quantityInStock: { gte: item.quantity } },
        data: { quantityInStock: { decrement: item.quantity }, revision: { increment: 1 } },
      });
      if (!reserved.count) throw conflict(`Insufficient stock for product ${item.productId}`);
      const snapshot = previous.find((old) => old.productId === item.productId);
      result.push({
        ...item,
        productName: snapshot?.productName ?? product.productName,
        unitPrice: snapshot?.unitPrice ?? product.msrp,
      });
    }
    return result;
  }
  private async release(tx: Tx, items: OrderItem[]) {
    for (const item of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const result = await tx.product.updateMany({
        where: {
          productCode: item.productId,
          quantityInStock: { lte: 2000000000 - item.quantity },
        },
        data: { quantityInStock: { increment: item.quantity }, revision: { increment: 1 } },
      });
      if (!result.count)
        throw conflict('Cannot restore stock; product missing or inventory limit exceeded');
    }
  }
  private async current(tx: Tx, id: string) {
    const order = await tx.order.findFirst({ where: { orderId: id, deletedAt: null }, select });
    if (!order) throw missing('Order');
    // Obtain a write conflict even for disjoint concurrent order changes.
    await tx.order.update({ where: { orderId: id }, data: { revision: { increment: 1 } } });
    return order;
  }
  async update(id: string, input: OrderUpdate): Promise<Order> {
    return transaction(this.db, async (tx) => {
      const order = await this.current(tx, id);
      assertTransition(order, input);
      let total = order.total;
      if (input.orderItems) {
        await this.release(tx, order.orderItems);
        const items = await this.reserve(tx, input.orderItems, order.orderItems);
        total = this.total(items);
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        for (const item of items) await tx.orderItem.create({ data: { ...item, orderId: id } });
      }
      if (input.status === 'cancelled' && order.status === 'pending')
        await this.release(tx, order.orderItems);
      return tx.order.update({
        where: { orderId: id },
        data: {
          total,
          comments: input.comments,
          shippingDate: input.shippingDate,
          status: input.status,
          paid: input.paid,
        },
        select,
      });
    });
  }
  async delete(id: string) {
    await transaction(this.db, async (tx) => {
      const order = await this.current(tx, id);
      if (order.status === 'shipped' || order.paid)
        throw conflict('Only unpaid, unshipped orders may be deleted');
      if (order.status === 'pending') await this.release(tx, order.orderItems);
      await tx.order.update({
        where: { orderId: id },
        data: { status: 'cancelled', deletedAt: new Date() },
      });
    });
  }
}
