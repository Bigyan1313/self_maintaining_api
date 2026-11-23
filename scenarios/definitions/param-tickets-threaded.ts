import type { Definition } from '../types.js';

export default {
  id: 'param-tickets-threaded',
  category: 'required_param_added',
  difficulty: 'moderate',
  description: 'Region supplied by the caller must reach the request',
  callPatterns: ['fetch'],
  path: '/events/{id}/tickets',
  operationId: 'getParamTicketsThreaded',
  before: {
    count: 6,
  },
  after: {
    count: 6,
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
      "interface Payload { count: number }\n\nexport async function readValue(id = '42', region = 'us') {\n  const response = await fetch(`https://api.example.test/events/${id}/tickets`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  void region; // v1 did not need region; v2 requires forwarding this caller value.\n  return data.count;\n}\n",
  },
  expectedValue: 6,
  cases: [
    { id: '42', before: { count: 6 }, after: { count: 6 }, parameters: { region: 'us' } },
    { id: '43', before: { count: 9 }, after: { count: 9 }, parameters: { region: 'eu' } },
  ],
  mapping: {
    kind: 'required_param_added',
    method: 'GET',
    path: '/events/{id}/tickets',
    param: 'region',
    in: 'query',
    default_value: 'us',
  },
  parameter: {
    name: 'region',
    in: 'query',
    value: 'us',
    enum: ['us', 'eu'],
  },
} satisfies Definition;
