import { z } from 'zod';
export const objectId = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/)
  .transform((id) => id.toLowerCase());
const text = z.string().trim().min(1).max(200);
const integer = z.number().int().min(0).max(2000000000);
export const pagination = z
  .object({
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const customerCreate = z
  .object({
    customerName: text,
    cemail: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    phone: text,
    address: text,
    city: text,
    postalCode: text,
    country: text,
  })
  .strict();
export const productCreate = z
  .object({
    productName: text,
    productvendor: text,
    productDescription: z.string().trim().max(2000),
    quantityInStock: integer,
    buyPrice: integer,
    msrp: integer,
  })
  .strict();
export const userCreate = z
  .object({
    username: z.string().trim().min(1).max(100),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    role: z.enum(['operator', 'admin']),
    status: z.enum(['active', 'disabled']),
    firstName: text.optional(),
    lastName: text.optional(),
  })
  .strict();
const nonempty = (value: object) => Object.keys(value).length > 0;
export const customerUpdate = customerCreate
  .partial()
  .refine(nonempty, 'Provide at least one field');
export const productUpdate = productCreate
  .omit({ quantityInStock: true })
  .partial()
  .refine(nonempty, 'Provide at least one field');
export const userUpdate = userCreate.partial().refine(nonempty, 'Provide at least one field');
export const stockAdjustment = z
  .object({
    delta: z
      .number()
      .int()
      .min(-2000000000)
      .max(2000000000)
      .refine((value) => value !== 0),
  })
  .strict();
const items = z
  .array(z.object({ productId: objectId, quantity: z.number().int().min(1).max(10000) }).strict())
  .min(1)
  .max(100)
  .refine(
    (value) => new Set(value.map((item) => item.productId)).size === value.length,
    'Products must be distinct',
  );
const shippingDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
export const orderCreate = z
  .object({
    customerId: objectId,
    comments: z.string().trim().max(2000).default(''),
    shippingDate: shippingDate.optional(),
    orderItems: items,
  })
  .strict();
export const orderUpdate = z
  .object({
    comments: z.string().trim().max(2000).optional(),
    shippingDate: shippingDate.optional(),
    orderItems: items.optional(),
    status: z.enum(['pending', 'shipped', 'cancelled']).optional(),
    paid: z.boolean().optional(),
  })
  .strict()
  .refine(nonempty, 'Provide at least one field');
export const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const nameParam = text;
