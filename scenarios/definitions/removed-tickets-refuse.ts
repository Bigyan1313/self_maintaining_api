import type { Definition } from '../types.js';

export default {
  id: 'removed-tickets-refuse',
  category: 'endpoint_removed',
  difficulty: 'high',
  description: 'Resale endpoint removed without replacement',
  callPatterns: ['generated_client', 'fetch'],
  path: '/tickets/{id}/resale',
  operationId: 'getRemovedTicketsRefuse',
  before: {
    price: 80,
  },
  after: {
    price: 80,
  },
  schemaBefore: {
    type: 'object',
    required: ['price'],
    properties: {
      price: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['price'],
    properties: {
      price: {
        type: 'number',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import { getRemovedTicketsRefuse } from './generated/client.js';\ninterface Payload { price: number }\n\nexport async function readValue(id = '42') {\n  const data = await getRemovedTicketsRefuse(id);\n  return data.price;\n}\n",
    'src/generated/client.ts':
      'interface Payload { price: number }\nexport async function getRemovedTicketsRefuse(id: string): Promise<Payload> {\n  const response = await fetch(`https://api.example.test/tickets/${id}/resale`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  return await response.json() as Payload;\n}\n',
  },
  expectedValue: 80,
} satisfies Definition;
