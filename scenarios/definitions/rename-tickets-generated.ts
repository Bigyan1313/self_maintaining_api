import type { Definition } from '../types.js';

export default {
  id: 'rename-tickets-generated',
  category: 'field_renamed',
  difficulty: 'low',
  description: 'Event name through a generated client',
  callPatterns: ['generated_client', 'fetch'],
  path: '/tickets/{id}',
  operationId: 'getRenameTicketsGenerated',
  before: {
    event_name: 'Concert',
  },
  after: {
    title: 'Concert',
  },
  schemaBefore: {
    type: 'object',
    required: ['event_name'],
    properties: {
      event_name: {
        type: 'string',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['title'],
    properties: {
      title: {
        type: 'string',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import { getRenameTicketsGenerated } from './generated/client.js';\ninterface Payload { event_name: string }\n\nexport async function readValue(id = '42') {\n  const data = await getRenameTicketsGenerated(id);\n  return data.event_name;\n}\n",
    'src/generated/client.ts':
      'interface Payload { event_name: string }\nexport async function getRenameTicketsGenerated(id: string): Promise<Payload> {\n  const response = await fetch(`https://api.example.test/tickets/${id}`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  return await response.json() as Payload;\n}\n',
  },
  expectedValue: 'Concert',
  mapping: {
    kind: 'field_renamed',
    method: 'GET',
    path: '/tickets/{id}',
    location: 'response',
    old: 'event_name',
    new: 'title',
  },
} satisfies Definition;
