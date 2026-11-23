import type { Definition } from '../types.js';

export default {
  id: 'type-weather-timestamp',
  category: 'field_type_changed',
  difficulty: 'moderate',
  description: 'Unix seconds become an ISO timestamp',
  callPatterns: ['fetch'],
  path: '/forecasts/{id}',
  operationId: 'getTypeWeatherTimestamp',
  before: {
    observed_at: 1700000000,
  },
  after: {
    observed_at: '2023-11-14T22:13:20.000Z',
  },
  schemaBefore: {
    type: 'object',
    required: ['observed_at'],
    properties: {
      observed_at: {
        type: 'integer',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['observed_at'],
    properties: {
      observed_at: {
        type: 'string',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { observed_at: number }\n\nexport async function readValue(id = '42') {\n  const response = await fetch(`https://api.example.test/forecasts/${id}`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return new Date(data.observed_at * 1000).toISOString();\n}\n",
  },
  expectedValue: '2023-11-14T22:13:20.000Z',
  mapping: {
    kind: 'field_type_changed',
    method: 'GET',
    path: '/forecasts/{id}',
    field: 'observed_at',
    old_type: 'integer',
    new_type: 'string',
    conversion: 'Date.parse(value) / 1000',
  },
} satisfies Definition;
