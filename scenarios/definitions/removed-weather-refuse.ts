import type { Definition } from '../types.js';

export default {
  id: 'removed-weather-refuse',
  category: 'endpoint_removed',
  difficulty: 'high',
  description: 'Historical observations removed without replacement',
  callPatterns: ['fetch'],
  path: '/stations/{id}/history',
  operationId: 'getRemovedWeatherRefuse',
  before: {
    days: 30,
  },
  after: {
    days: 30,
  },
  schemaBefore: {
    type: 'object',
    required: ['days'],
    properties: {
      days: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['days'],
    properties: {
      days: {
        type: 'number',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { days: number }\n\nexport async function readValue(id = '42') {\n  const response = await fetch(`https://api.example.test/stations/${id}/history`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return data.days;\n}\n",
  },
  expectedValue: 30,
} satisfies Definition;
