export type Page = { offset: number; limit: number };
export type PageResult<T> = Page & { items: T[]; total: number };
export type CustomerInput = {
  customerName: string;
  cemail: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
};
export type Customer = CustomerInput & {
  customerCode: string;
  creationDate: Date;
  modificationDate: Date;
};
export type ProductInput = {
  productName: string;
  productvendor: string;
  productDescription: string;
  quantityInStock: number;
  buyPrice: number;
  msrp: number;
};
export type Product = ProductInput & {
  productCode: string;
  creationDate: Date;
  modificationDate: Date;
};
export type UserInput = {
  username: string;
  email: string;
  role: 'operator' | 'admin';
  status: 'active' | 'disabled';
  firstName?: string;
  lastName?: string;
};
export type User = Omit<UserInput, 'firstName' | 'lastName'> & {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type OrderStatus = 'pending' | 'shipped' | 'cancelled';
export type ItemInput = { productId: string; quantity: number };
export type OrderInput = {
  customerId: string;
  comments: string;
  shippingDate?: Date;
  orderItems: ItemInput[];
};
export type OrderUpdate = {
  comments?: string;
  shippingDate?: Date;
  orderItems?: ItemInput[];
  status?: OrderStatus;
  paid?: boolean;
};
export type OrderItem = ItemInput & {
  orderitemId: string;
  orderId: string;
  productName: string;
  unitPrice: number;
};
export type Order = {
  orderId: string;
  customerId: string;
  orderDate: Date;
  shippingDate: Date | null;
  status: OrderStatus;
  comments: string;
  total: number;
  currency: string;
  paid: boolean;
  deletedAt: Date | null;
  revision: number;
  orderItems: OrderItem[];
};
