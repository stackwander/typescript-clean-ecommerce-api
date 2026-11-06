import { Prisma, PrismaClient } from '@prisma/client';
import type { CatalogRepository } from '../../ca_domain/ports';
import type { CustomerInput, Page, ProductInput, UserInput } from '../../ca_domain/models';
import { conflict, missing } from '../../ca_domain/errors';
import { transaction } from './transactions';

// Explicit projections also exclude password fields left in legacy MongoDB records.
const userSelect = {
  userId: true,
  username: true,
  email: true,
  role: true,
  status: true,
  firstName: true,
  lastName: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
export class PrismaCatalog implements CatalogRepository {
  constructor(private readonly db: PrismaClient) {}
  async listCustomers(page: Page, name?: string) {
    const where = name ? { customerName: name } : {};
    const [items, total] = await this.db.$transaction([
      this.db.customer.findMany({
        where,
        orderBy: { customerCode: 'asc' },
        skip: page.offset,
        take: page.limit,
      }),
      this.db.customer.count({ where }),
    ]);
    return { items, total, ...page };
  }
  async getCustomer(id: string) {
    const value = await this.db.customer.findUnique({ where: { customerCode: id } });
    if (!value) throw missing('Customer');
    return value;
  }
  createCustomer(input: CustomerInput) {
    return this.db.customer.create({ data: input });
  }
  updateCustomer(id: string, input: Partial<CustomerInput>) {
    return this.db.customer.update({ where: { customerCode: id }, data: input });
  }
  async deleteCustomer(id: string) {
    await transaction(this.db, async (tx) => {
      await tx.customer.update({
        where: { customerCode: id },
        data: { revision: { increment: 1 } },
      });
      if (await tx.order.count({ where: { customerId: id } }))
        throw conflict('Customer is referenced by order history');
      await tx.customer.delete({ where: { customerCode: id } });
    });
  }
  async listProducts(page: Page, name?: string) {
    const where = name ? { productName: name } : {};
    const [items, total] = await this.db.$transaction([
      this.db.product.findMany({
        where,
        orderBy: { productCode: 'asc' },
        skip: page.offset,
        take: page.limit,
      }),
      this.db.product.count({ where }),
    ]);
    return { items, total, ...page };
  }
  async getProduct(id: string) {
    const value = await this.db.product.findUnique({ where: { productCode: id } });
    if (!value) throw missing('Product');
    return value;
  }
  createProduct(input: ProductInput) {
    return this.db.product.create({ data: input });
  }
  updateProduct(id: string, input: Partial<Omit<ProductInput, 'quantityInStock'>>) {
    return this.db.product.update({
      where: { productCode: id },
      data: { ...input, revision: { increment: 1 } },
    });
  }
  async adjustStock(id: string, delta: number) {
    return transaction(this.db, async (tx) => {
      const result = await tx.product.updateMany({
        where: {
          productCode: id,
          quantityInStock: {
            gte: Math.max(0, -delta),
            lte: Math.min(2000000000, 2000000000 - delta),
          },
        },
        data: { quantityInStock: { increment: delta }, revision: { increment: 1 } },
      });
      if (!result.count) {
        if (!(await tx.product.findUnique({ where: { productCode: id } })))
          throw missing('Product');
        throw conflict('Stock adjustment exceeds available inventory or stock limit');
      }
      return tx.product.findUniqueOrThrow({ where: { productCode: id } });
    });
  }
  async deleteProduct(id: string) {
    await transaction(this.db, async (tx) => {
      await tx.product.update({ where: { productCode: id }, data: { revision: { increment: 1 } } });
      if (await tx.orderItem.count({ where: { productId: id } }))
        throw conflict('Product is referenced by order history');
      await tx.product.delete({ where: { productCode: id } });
    });
  }
  async listUsers(page: Page, name?: string) {
    const where = name ? { username: name } : {};
    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: userSelect,
        orderBy: { userId: 'asc' },
        skip: page.offset,
        take: page.limit,
      }),
      this.db.user.count({ where }),
    ]);
    return { items, total, ...page };
  }
  async getUser(id: string) {
    const value = await this.db.user.findUnique({ where: { userId: id }, select: userSelect });
    if (!value) throw missing('User');
    return value;
  }
  createUser(input: UserInput) {
    return this.db.user.create({ data: input, select: userSelect });
  }
  updateUser(id: string, input: Partial<UserInput>) {
    return this.db.user.update({ where: { userId: id }, data: input, select: userSelect });
  }
  async deleteUser(id: string) {
    await this.db.user.delete({ where: { userId: id } });
  }
}
