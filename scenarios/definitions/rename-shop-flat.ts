import type { Definition } from '../types.js';

export default {
  id: 'rename-shop-flat',
  category: 'field_renamed',
  difficulty: 'low',
  description: 'Flat customer display name',
  callPatterns: ['fetch'],
  path: '/customers/{id}',
  operationId: 'getRenameShopFlat',
  before: {
    customer_name: 'Ada',
  },
  after: {
    full_name: 'Ada',
  },
  schemaBefore: {
    type: 'object',
    required: ['customer_name'],
    properties: {
      customer_name: {
        type: 'string',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['full_name'],
    properties: {
      full_name: {
        type: 'string',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { customer_name: string }\n\nexport async function readValue(id = '42') {\n  const response = await fetch(`https://api.example.test/customers/${id}`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return data.customer_name;\n}\n",
  },
  expectedValue: 'Ada',
  mapping: {
    kind: 'field_renamed',
    method: 'GET',
    path: '/customers/{id}',
    location: 'response',
    old: 'customer_name',
    new: 'full_name',
  },
} satisfies Definition;
