/**
 * "Demo Shop" REST API, served at v1 or v2. Test material for the evaluation (SRS 2.2, 5.2).
 *
 * @packageDocumentation
 */
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  seedStore,
  type CustomerRecord,
  type DemoStore,
  type DemoVersion,
  type InvoiceRecord,
  type OrderRecord,
} from './data.js';

/** Allowed values for the `status` query parameter of GET /orders. */
export const ORDER_STATUS_FILTERS = ['open', 'closed', 'all'] as const;

/** Error body returned for 400/404 responses. */
export interface ErrorBody {
  error: string;
}

type IdParams = { id: string };
type OrderIdParams = { orderId: string };
type OrdersQuery = { status?: string };

const cents = (value: number): number => value / 100;
const decimal = (value: number): string => (value / 100).toFixed(2);

function parseId(raw: string): number | undefined {
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : undefined;
}

function notFound(reply: FastifyReply, what: string): FastifyReply {
  return reply.code(404).send({ error: `${what} not found` } satisfies ErrorBody);
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message } satisfies ErrorBody);
}

function customerBody(c: CustomerRecord, version: DemoVersion): Record<string, unknown> {
  if (version === 'v1') return { id: c.id, customer_name: c.name, email: c.email };
  return { id: c.id, full_name: c.name, email: c.email, ...(c.phone ? { phone: c.phone } : {}) };
}

function orderBody(o: OrderRecord, version: DemoVersion): Record<string, unknown> {
  return {
    id: o.id,
    customerId: o.customerId,
    total: version === 'v1' ? cents(o.totalCents) : decimal(o.totalCents),
    status: o.status,
  };
}

function orderSummaryBody(o: OrderRecord): Record<string, unknown> {
  return { id: o.id, customerId: o.customerId, status: o.status };
}

function invoiceBody(i: InvoiceRecord): Record<string, unknown> {
  return {
    orderId: i.orderId,
    invoiceNumber: i.invoiceNumber,
    amountDue: cents(i.amountDueCents),
    issuedAt: i.issuedAt,
  };
}

function registerInvoiceRoute(
  app: FastifyInstance,
  store: DemoStore,
  url: string,
  paramName: 'id' | 'orderId',
): void {
  app.get<{ Params: IdParams & OrderIdParams }>(url, async (req, reply) => {
    const id = parseId(req.params[paramName]);
    const invoice = id === undefined ? undefined : store.invoices.get(id);
    if (!invoice || !store.orders.has(invoice.orderId)) return notFound(reply, 'Invoice');
    return invoiceBody(invoice);
  });
}

/**
 * Builds the demo app for one API version, with its own freshly seeded in-memory store.
 * Does not open a port, so tests can call `app.inject()`.
 *
 * @param version - `'v1'` or `'v2'`.
 * @param store - Optional store (defaults to fresh seed data).
 */
export function buildDemoApp(
  version: DemoVersion,
  store: DemoStore = seedStore(),
): FastifyInstance {
  const app = Fastify();

  app.get<{ Params: IdParams }>('/customers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const customer = id === undefined ? undefined : store.customers.get(id);
    if (!customer) return notFound(reply, 'Customer');
    return customerBody(customer, version);
  });

  app.get<{ Querystring: OrdersQuery }>('/orders', async (req, reply) => {
    const status = req.query.status;
    if (status === undefined && version === 'v2') {
      return badRequest(reply, 'Missing required query parameter: status');
    }
    const filter = status ?? 'all';
    if (!(ORDER_STATUS_FILTERS as readonly string[]).includes(filter)) {
      return badRequest(reply, `Invalid status: ${filter}`);
    }
    return [...store.orders.values()]
      .filter((o) => filter === 'all' || o.status === filter)
      .map(orderSummaryBody);
  });

  app.get<{ Params: IdParams }>('/orders/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const order = id === undefined ? undefined : store.orders.get(id);
    if (!order) return notFound(reply, 'Order');
    return orderBody(order, version);
  });

  if (version === 'v1') {
    registerInvoiceRoute(app, store, '/orders/:id/invoice', 'id');

    app.delete<{ Params: IdParams }>('/orders/:id', async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === undefined || !store.orders.delete(id)) return notFound(reply, 'Order');
      return reply.code(204).send();
    });
  } else {
    registerInvoiceRoute(app, store, '/invoices/:orderId', 'orderId');
  }

  return app;
}
