import type { Definition } from '../types.js';

export default {
  id: 'param-shop-query',
  category: 'required_param_added',
  difficulty: 'moderate',
  description: 'Required status query with a documented default',
  callPatterns: ['fetch'],
  path: '/orders',
  operationId: 'getParamShopQuery',
  before: {
    count: 3,
  },
  after: {
    count: 3,
  },
  schemaBefore: {
    type: 'object',
    required: ['count'],
    properties: {
      count: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['count'],
    properties: {
      count: {
        type: 'number',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { count: number }\n\nexport async function readValue(id = '42') {\n  void id;\n  const response = await fetch(`https://api.example.test/orders`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return data.count;\n}\n",
  },
  expectedValue: 3,
  mapping: {
    kind: 'required_param_added',
    method: 'GET',
    path: '/orders',
    param: 'status',
    in: 'query',
    default_value: 'all',
  },
  parameter: {
    name: 'status',
    in: 'query',
    value: 'all',
    enum: ['all', 'open'],
  },
} satisfies Definition;
