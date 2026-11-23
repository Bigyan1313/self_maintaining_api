import type { Definition } from '../types.js';

export default {
  id: 'type-tickets-boolean-enum',
  category: 'field_type_changed',
  difficulty: 'moderate',
  description: 'Availability boolean becomes an enum',
  callPatterns: ['generated_client', 'fetch'],
  path: '/tickets/{id}',
  operationId: 'getTypeTicketsBooleanEnum',
  before: {
    available: false,
  },
  after: {
    available: 'unavailable',
  },
  schemaBefore: {
    type: 'object',
    required: ['available'],
    properties: {
      available: {
        type: 'boolean',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['available'],
    properties: {
      available: {
        type: 'string',
        enum: ['available', 'unavailable'],
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import { getTypeTicketsBooleanEnum } from './generated/client.js';\ninterface Payload { available: boolean }\n\nexport async function readValue(id = '42') {\n  const data = await getTypeTicketsBooleanEnum(id);\n  return data.available ? 'Book now' : 'Sold out';\n}\n",
    'src/generated/client.ts':
      'interface Payload { available: boolean }\nexport async function getTypeTicketsBooleanEnum(id: string): Promise<Payload> {\n  const response = await fetch(`https://api.example.test/tickets/${id}`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  return await response.json() as Payload;\n}\n',
  },
  expectedValue: 'Sold out',
  mapping: {
    kind: 'field_type_changed',
    method: 'GET',
    path: '/tickets/{id}',
    field: 'available',
    old_type: 'boolean',
    new_type: 'string',
    conversion: "value === 'available'",
  },
} satisfies Definition;
