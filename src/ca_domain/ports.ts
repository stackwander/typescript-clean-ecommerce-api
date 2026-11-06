import type {
  Customer,
  CustomerInput,
  Order,
  OrderInput,
  OrderUpdate,
  Page,
  PageResult,
  Product,
  ProductInput,
  User,
  UserInput,
} from './models';
export interface CatalogRepository {
  listCustomers(page: Page, name?: string): Promise<PageResult<Customer>>;
  getCustomer(id: string): Promise<Customer>;
  createCustomer(input: CustomerInput): Promise<Customer>;
  updateCustomer(id: string, input: Partial<CustomerInput>): Promise<Customer>;
  deleteCustomer(id: string): Promise<void>;
  listProducts(page: Page, name?: string): Promise<PageResult<Product>>;
  getProduct(id: string): Promise<Product>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(
    id: string,
    input: Partial<Omit<ProductInput, 'quantityInStock'>>,
  ): Promise<Product>;
  adjustStock(id: string, delta: number): Promise<Product>;
  deleteProduct(id: string): Promise<void>;
  listUsers(page: Page, name?: string): Promise<PageResult<User>>;
  getUser(id: string): Promise<User>;
  createUser(input: UserInput): Promise<User>;
  updateUser(id: string, input: Partial<UserInput>): Promise<User>;
  deleteUser(id: string): Promise<void>;
}
export interface OrderRepository {
  list(page: Page, customerId?: string): Promise<PageResult<Order>>;
  get(id: string): Promise<Order>;
  create(input: OrderInput, key: string, fingerprint: string, currency: string): Promise<Order>;
  update(id: string, input: OrderUpdate): Promise<Order>;
  delete(id: string): Promise<void>;
}
