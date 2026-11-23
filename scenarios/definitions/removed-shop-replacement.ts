import type { Definition } from '../types.js';

export default {
  id: 'removed-shop-replacement',
  category: 'endpoint_removed',
  difficulty: 'high',
  description: 'Invoice endpoint has a documented replacement',
  callPatterns: ['fetch'],
  path: '/orders/{id}/invoice',
  operationId: 'getRemovedShopReplacement',
  before: {
    invoice: 'INV-42',
  },
  after: {
    invoice: 'INV-42',
  },
  schemaBefore: {
    type: 'object',
    required: ['invoice'],
    properties: {
      invoice: {
        type: 'string',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['invoice'],
    properties: {
      invoice: {
        type: 'string',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { invoice: string }\n\nexport async function readValue(id = '42') {\n  const response = await fetch(`https://api.example.test/orders/${id}/invoice`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return data.invoice;\n}\n",
  },
  expectedValue: 'INV-42',
  mapping: {
    kind: 'endpoint_removed',
    method: 'GET',
    path: '/orders/{id}/invoice',
    replacement: {
      method: 'GET',
      path: '/invoices/{id}',
    },
  },
  replacement: '/invoices/{id}',
} satisfies Definition;
