import type { Definition } from '../types.js';

export default {
  id: 'type-shop-number-string',
  category: 'field_type_changed',
  difficulty: 'moderate',
  description: 'Price becomes a decimal string',
  callPatterns: ['fetch'],
  path: '/orders/{id}',
  operationId: 'getTypeShopNumberString',
  before: {
    total: 12.5,
  },
  after: {
    total: '12.5',
  },
  schemaBefore: {
    type: 'object',
    required: ['total'],
    properties: {
      total: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['total'],
    properties: {
      total: {
        type: 'string',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { total: number }\n\nexport async function readValue(id = '42') {\n  const response = await fetch(`https://api.example.test/orders/${id}`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return data.total.toFixed(2);\n}\n",
  },
  expectedValue: '12.50',
  mapping: {
    kind: 'field_type_changed',
    method: 'GET',
    path: '/orders/{id}',
    field: 'total',
    old_type: 'number',
    new_type: 'string',
    conversion: 'Number(value)',
  },
} satisfies Definition;
