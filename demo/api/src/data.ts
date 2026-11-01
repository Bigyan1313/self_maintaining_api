/** API version served by the demo app. */
export type DemoVersion = 'v1' | 'v2';

/** Order lifecycle status. */
export type OrderStatus = 'open' | 'closed';

/** Internal (version-independent) customer record. */
export interface CustomerRecord {
  id: number;
  name: string;
  email: string;
  phone?: string;
}

/** Internal (version-independent) order record. Amounts are integer cents. */
export interface OrderRecord {
  id: number;
  customerId: number;
  totalCents: number;
  status: OrderStatus;
}

/** Internal invoice record. */
export interface InvoiceRecord {
  orderId: number;
  invoiceNumber: string;
  amountDueCents: number;
  issuedAt: string;
}

/** Mutable in-memory store; each app instance gets its own copy. */
export interface DemoStore {
  customers: Map<number, CustomerRecord>;
  orders: Map<number, OrderRecord>;
  invoices: Map<number, InvoiceRecord>;
}

/**
 * Builds a fresh store with deterministic seed data (so recorded fixtures are stable).
 */
export function seedStore(): DemoStore {
  const customers: CustomerRecord[] = [
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', phone: '+44 20 7946 0001' },
    { id: 2, name: 'Alan Turing', email: 'alan@example.com' },
    { id: 3, name: 'Grace Hopper', email: 'grace@example.com', phone: '+1 202 555 0143' },
  ];
  const orders: OrderRecord[] = [
    { id: 1, customerId: 1, totalCents: 1999, status: 'open' },
    { id: 2, customerId: 2, totalCents: 550, status: 'closed' },
    { id: 3, customerId: 1, totalCents: 4200, status: 'open' },
    { id: 4, customerId: 3, totalCents: 10000, status: 'closed' },
  ];
  const invoices: InvoiceRecord[] = orders.map((o) => ({
    orderId: o.id,
    invoiceNumber: `INV-${String(o.id).padStart(4, '0')}`,
    amountDueCents: o.status === 'open' ? o.totalCents : 0,
    issuedAt: `2026-10-0${o.id}T12:00:00.000Z`,
  }));
  return {
    customers: new Map(customers.map((c) => [c.id, c])),
    orders: new Map(orders.map((o) => [o.id, o])),
    invoices: new Map(invoices.map((i) => [i.orderId, i])),
  };
}
